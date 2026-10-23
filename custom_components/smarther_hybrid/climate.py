"""Climate entity combining a HomeKit (local) and a Netatmo (cloud) Smarther entity.

State and setpoint come from HomeKit, which pushes changes locally.
Presets and the schedule come from Netatmo, the only source that knows them.

Modes:
- Auto: Netatmo is in charge. Choosing Auto re-sends the last preset chosen
  (schedule, away, boost or frost guard; schedule at first), so the
  thermostat gets it again. Presets can be changed while in Auto.
- Heat: hold. The setpoint chosen here is kept against the schedule: it is
  re-sent when the thermostat falls back to the schedule and, as a safety
  net, every few hours. A change made on the thermostat or in the app is
  adopted instead of overridden.
- Off: the thermostat's real off, which the Smarther treats as frost
  protection (7 °C). Only sent when explicitly requested.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.components.climate import (
    ATTR_HVAC_ACTION,
    ATTR_MAX_TEMP,
    ATTR_MIN_TEMP,
    ATTR_PRESET_MODE,
    DOMAIN as CLIMATE_DOMAIN,
    SERVICE_SET_HVAC_MODE,
    SERVICE_SET_PRESET_MODE,
    SERVICE_SET_TEMPERATURE,
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_TEMPERATURE,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
    UnitOfTemperature,
)
from homeassistant.core import (
    CALLBACK_TYPE,
    Event,
    EventStateChangedData,
    HomeAssistant,
    State,
    callback,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.util import dt as dt_util

from .const import (
    ATTR_HOLD_ACTIVE,
    ATTR_HOLD_TEMPERATURE,
    ATTR_LAST_PRESET,
    CONF_HOLD_REFRESH_HOURS,
    CONF_HOMEKIT_ENTITY,
    CONF_HUMIDITY_ENTITY,
    CONF_NETATMO_ENTITY,
    DEFAULT_HOLD_REFRESH_HOURS,
    DEFAULT_MAX_TEMP,
    DEFAULT_MIN_TEMP,
    FROST_GUARD_TEMP,
    HOLD_MIN_REAPPLY_SECONDS,
    HOLD_SETTLE_SECONDS,
    NETATMO_ATTR_SELECTED_SCHEDULE,
    NETATMO_COMMAND_INTERVAL,
    PRESET_AWAY,
    PRESET_BOOST,
    PRESET_FROST_GUARD,
    PRESET_SCHEDULE,
    SETTABLE_PRESETS,
    TEMP_STEP,
    TURN_ON_SETTLE_SECONDS,
)

_LOGGER = logging.getLogger(__name__)

ATTR_CURRENT_TEMPERATURE = "current_temperature"

# Netatmo presets that end a hold when chosen elsewhere (app, thermostat).
HOLD_BREAKING_PRESETS = {PRESET_AWAY, PRESET_BOOST, PRESET_FROST_GUARD}


def _usable(state: State | None) -> bool:
    return state is not None and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the hybrid climate entity."""
    async_add_entities([SmartherHybridClimate(entry)])


class SmartherHybridClimate(ClimateEntity, RestoreEntity):
    """Smarther thermostat: HomeKit for state and setpoint, Netatmo for presets."""

    _attr_should_poll = False
    _attr_translation_key = "smarther"
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_target_temperature_step = TEMP_STEP
    _attr_hvac_modes = [HVACMode.AUTO, HVACMode.HEAT, HVACMode.OFF]
    _attr_preset_modes = SETTABLE_PRESETS
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.PRESET_MODE
        | ClimateEntityFeature.TURN_ON
        | ClimateEntityFeature.TURN_OFF
    )

    def __init__(self, entry: ConfigEntry) -> None:
        """Initialize from the config entry."""
        self._homekit_id: str = entry.data[CONF_HOMEKIT_ENTITY]
        self._netatmo_id: str = entry.data[CONF_NETATMO_ENTITY]
        self._humidity_id: str | None = entry.data.get(CONF_HUMIDITY_ENTITY)
        self._refresh_hours = float(
            entry.options.get(CONF_HOLD_REFRESH_HOURS, DEFAULT_HOLD_REFRESH_HOURS)
        )
        self._attr_name = entry.title
        self._attr_unique_id = entry.entry_id

        self._hold_temperature: float | None = None
        self._last_preset: str = PRESET_SCHEDULE
        self._last_reapply: datetime | None = None
        self._unsub_settle: CALLBACK_TYPE | None = None
        self._netatmo_last_sent: datetime | None = None
        self._netatmo_pending: str | None = None
        self._unsub_netatmo: CALLBACK_TYPE | None = None

    # -- lifecycle -----------------------------------------------------------

    async def async_added_to_hass(self) -> None:
        """Restore hold and last preset, then follow the sources instead of polling."""
        if (last := await self.async_get_last_state()) is not None:
            if last.attributes.get(ATTR_HOLD_ACTIVE):
                self._hold_temperature = _as_float(
                    last.attributes.get(ATTR_HOLD_TEMPERATURE)
                )
            if last.attributes.get(ATTR_LAST_PRESET) in SETTABLE_PRESETS:
                self._last_preset = last.attributes[ATTR_LAST_PRESET]

        self.async_on_remove(
            async_track_state_change_event(
                self.hass, [self._homekit_id], self._homekit_changed
            )
        )
        self.async_on_remove(
            async_track_state_change_event(
                self.hass, [self._netatmo_id], self._netatmo_changed
            )
        )
        if self._humidity_id:
            self.async_on_remove(
                async_track_state_change_event(
                    self.hass, [self._humidity_id], self._source_changed
                )
            )
        if self._refresh_hours > 0:
            self.async_on_remove(
                async_track_time_interval(
                    self.hass,
                    self._periodic_refresh,
                    timedelta(hours=self._refresh_hours),
                )
            )
        self.async_on_remove(self._cancel_settle)
        self.async_on_remove(self._cancel_netatmo_queue)

        # Catch up on anything that happened while Home Assistant was down.
        if self._hold_temperature is not None:
            self._schedule_settle()

    # -- source helpers ------------------------------------------------------

    @property
    def _homekit(self) -> State | None:
        return self.hass.states.get(self._homekit_id)

    @property
    def _netatmo(self) -> State | None:
        return self.hass.states.get(self._netatmo_id)

    def _homekit_on(self) -> bool:
        state = self._homekit
        return _usable(state) and state.state != HVACMode.OFF

    def _netatmo_preset(self) -> str | None:
        state = self._netatmo
        return state.attributes.get(ATTR_PRESET_MODE) if _usable(state) else None

    # -- state ---------------------------------------------------------------

    @property
    def available(self) -> bool:
        """Available as long as the local HomeKit entity is."""
        return _usable(self._homekit)

    @property
    def hvac_mode(self) -> HVACMode | None:
        """Off from HomeKit, Heat while holding, otherwise Auto (Netatmo in charge)."""
        if not _usable(self._homekit):
            return None
        if not self._homekit_on():
            return HVACMode.OFF
        return HVACMode.HEAT if self._hold_temperature is not None else HVACMode.AUTO

    @property
    def hvac_action(self) -> HVACAction | None:
        """Heating or idle, as reported by HomeKit."""
        state = self._homekit
        if not _usable(state):
            return None
        if state.state == HVACMode.OFF:
            return HVACAction.OFF
        action = state.attributes.get(ATTR_HVAC_ACTION)
        return HVACAction.HEATING if action == HVACAction.HEATING else HVACAction.IDLE

    @property
    def current_temperature(self) -> float | None:
        """Measured temperature from HomeKit."""
        state = self._homekit
        if not _usable(state):
            return None
        return _as_float(state.attributes.get(ATTR_CURRENT_TEMPERATURE))

    @property
    def target_temperature(self) -> float | None:
        """Heating setpoint from HomeKit."""
        state = self._homekit
        if not _usable(state):
            return None
        return _as_float(state.attributes.get(ATTR_TEMPERATURE))

    @property
    def current_humidity(self) -> float | None:
        """Humidity from the optional sensor."""
        if not self._humidity_id:
            return None
        state = self.hass.states.get(self._humidity_id)
        return _as_float(state.state) if _usable(state) else None

    @property
    def min_temp(self) -> float:
        """Lower setpoint limit advertised by HomeKit."""
        state = self._homekit
        value = _as_float(state.attributes.get(ATTR_MIN_TEMP)) if state else None
        return value if value is not None else DEFAULT_MIN_TEMP

    @property
    def max_temp(self) -> float:
        """Upper setpoint limit advertised by HomeKit."""
        state = self._homekit
        value = _as_float(state.attributes.get(ATTR_MAX_TEMP)) if state else None
        return value if value is not None else DEFAULT_MAX_TEMP

    @property
    def preset_mode(self) -> str | None:
        """Current Netatmo preset, including the read-only "manual"."""
        return self._netatmo_preset()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the hold, the active schedule and the source entities."""
        netatmo = self._netatmo
        return {
            ATTR_HOLD_ACTIVE: self._hold_temperature is not None,
            ATTR_HOLD_TEMPERATURE: self._hold_temperature,
            ATTR_LAST_PRESET: self._last_preset,
            NETATMO_ATTR_SELECTED_SCHEDULE: (
                netatmo.attributes.get(NETATMO_ATTR_SELECTED_SCHEDULE)
                if _usable(netatmo)
                else None
            ),
            "netatmo_available": _usable(netatmo),
            "homekit_entity": self._homekit_id,
            "netatmo_entity": self._netatmo_id,
        }

    # -- hold ----------------------------------------------------------------

    def _stop_hold(self) -> None:
        self._hold_temperature = None
        self._cancel_settle()

    @callback
    def _cancel_settle(self) -> None:
        if self._unsub_settle is not None:
            self._unsub_settle()
            self._unsub_settle = None

    @callback
    def _schedule_settle(self) -> None:
        """Decide after Netatmo has had time to explain a setpoint change."""
        self._cancel_settle()
        self._unsub_settle = async_call_later(
            self.hass, HOLD_SETTLE_SECONDS, self._settle
        )

    async def _settle(self, _now: Any) -> None:
        self._unsub_settle = None
        if self._hold_temperature is None or not self._homekit_on():
            return
        target = self.target_temperature
        if target is None or target == self._hold_temperature:
            return
        if target <= FROST_GUARD_TEMP:
            # Frost protection was chosen somewhere else: never hold it.
            self._stop_hold()
            self.async_write_ha_state()
        elif self._netatmo_preset() == PRESET_SCHEDULE:
            # The manual change expired and the schedule took over.
            await self._reapply_hold()
        else:
            # Changed on the thermostat or in the app (or Netatmo can't
            # tell us): respect the person and keep their value instead.
            self._hold_temperature = target
            self.async_write_ha_state()

    async def _reapply_hold(self) -> None:
        now = dt_util.utcnow()
        if (
            self._last_reapply is not None
            and (now - self._last_reapply).total_seconds() < HOLD_MIN_REAPPLY_SECONDS
        ):
            return
        self._last_reapply = now
        await self._call(
            SERVICE_SET_TEMPERATURE, self._homekit_id, temperature=self._hold_temperature
        )

    async def _periodic_refresh(self, _now: Any) -> None:
        """Re-send the held setpoint so the manual change never expires."""
        if self._hold_temperature is not None and self._homekit_on():
            await self._reapply_hold()

    # -- source events -------------------------------------------------------

    @callback
    def _source_changed(self, event: Event[EventStateChangedData]) -> None:
        self.async_write_ha_state()

    @callback
    def _homekit_changed(self, event: Event[EventStateChangedData]) -> None:
        if self._hold_temperature is not None:
            if not self._homekit_on():
                # Turned off somewhere else: the hold no longer applies.
                if _usable(self._homekit):
                    self._stop_hold()
            elif self.target_temperature != self._hold_temperature:
                self._schedule_settle()
        self.async_write_ha_state()

    @callback
    def _netatmo_changed(self, event: Event[EventStateChangedData]) -> None:
        preset = self._netatmo_preset()
        # Remember presets chosen in the app too, but not the schedule
        # fallback that a hold is fighting.
        if preset in SETTABLE_PRESETS and not (
            self._hold_temperature is not None and preset == PRESET_SCHEDULE
        ):
            self._last_preset = preset
        if self._hold_temperature is not None:
            if self._netatmo_preset() in HOLD_BREAKING_PRESETS:
                self._stop_hold()
            elif (
                self._netatmo_preset() == PRESET_SCHEDULE
                and self.target_temperature != self._hold_temperature
            ):
                self._schedule_settle()
        self.async_write_ha_state()

    # -- Netatmo command queue ----------------------------------------------

    @callback
    def _cancel_netatmo_queue(self) -> None:
        if self._unsub_netatmo is not None:
            self._unsub_netatmo()
            self._unsub_netatmo = None
        self._netatmo_pending = None

    async def _send_netatmo_preset(self, preset_mode: str) -> None:
        """Send now, or queue it if the previous command went out too recently.

        Only the latest queued preset is sent.
        """
        now = dt_util.utcnow()
        wait = (
            0.0
            if self._netatmo_last_sent is None
            else NETATMO_COMMAND_INTERVAL
            - (now - self._netatmo_last_sent).total_seconds()
        )
        if wait <= 0 and self._unsub_netatmo is None:
            self._netatmo_last_sent = now
            await self._call(
                SERVICE_SET_PRESET_MODE, self._netatmo_id, preset_mode=preset_mode
            )
            return
        self._netatmo_pending = preset_mode
        if self._unsub_netatmo is None:
            self._unsub_netatmo = async_call_later(
                self.hass, max(wait, 0.0), self._flush_netatmo
            )

    async def _flush_netatmo(self, _now: Any) -> None:
        self._unsub_netatmo = None
        preset_mode, self._netatmo_pending = self._netatmo_pending, None
        if preset_mode is None:
            return
        self._netatmo_last_sent = dt_util.utcnow()
        try:
            await self._call(
                SERVICE_SET_PRESET_MODE, self._netatmo_id, preset_mode=preset_mode
            )
        except HomeAssistantError as err:
            _LOGGER.error("Queued Netatmo preset %s failed: %s", preset_mode, err)

    # -- commands ------------------------------------------------------------

    async def _call(self, service: str, entity_id: str, **data: Any) -> None:
        await self.hass.services.async_call(
            CLIMATE_DOMAIN,
            service,
            {ATTR_ENTITY_ID: entity_id, **data},
            blocking=True,
            context=self._context,
        )

    async def _ensure_homekit_on(self) -> bool:
        """Turn the thermostat on if needed; return True if it was off."""
        if self._homekit_on():
            return False
        await self._call(
            SERVICE_SET_HVAC_MODE, self._homekit_id, hvac_mode=HVACMode.HEAT
        )
        return True

    async def async_set_temperature(self, **kwargs: Any) -> None:
        """Set the setpoint locally through HomeKit.

        In Heat the new value becomes the held one. In Auto it is a normal
        manual change that expires as configured in the Netatmo app.
        """
        if (hvac_mode := kwargs.get("hvac_mode")) is not None:
            await self.async_set_hvac_mode(hvac_mode)
        if (temperature := kwargs.get(ATTR_TEMPERATURE)) is None:
            return
        if self._hold_temperature is not None:
            self._hold_temperature = float(temperature)
            self._cancel_settle()
        await self._call(
            SERVICE_SET_TEMPERATURE, self._homekit_id, temperature=temperature
        )
        self.async_write_ha_state()

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Auto (last preset, via Netatmo), Heat (hold) or Off (frost protection)."""
        if hvac_mode == HVACMode.OFF:
            self._stop_hold()
            self._cancel_netatmo_queue()
            await self._call(
                SERVICE_SET_HVAC_MODE, self._homekit_id, hvac_mode=HVACMode.OFF
            )
        elif hvac_mode == HVACMode.AUTO:
            if not _usable(self._netatmo):
                raise HomeAssistantError(
                    "Netatmo is unavailable: Auto needs the Netatmo cloud"
                )
            self._stop_hold()
            await self._ensure_homekit_on()
            # Always re-send, so the thermostat gets the preset again.
            await self._send_netatmo_preset(self._last_preset)
        elif hvac_mode == HVACMode.HEAT:
            self._cancel_netatmo_queue()
            if await self._ensure_homekit_on():
                # Coming from off, HomeKit still reports the frost setpoint.
                await asyncio.sleep(TURN_ON_SETTLE_SECONDS)
            target = self.target_temperature
            if target is not None and target > FROST_GUARD_TEMP:
                self._hold_temperature = target
                # Turn the current value into a manual change.
                await self._call(
                    SERVICE_SET_TEMPERATURE, self._homekit_id, temperature=target
                )
        else:
            raise HomeAssistantError(f"Unsupported HVAC mode: {hvac_mode}")
        self.async_write_ha_state()

    async def async_turn_on(self) -> None:
        """Turn on (heat, keeping the current setpoint)."""
        await self.async_set_hvac_mode(HVACMode.HEAT)

    async def async_turn_off(self) -> None:
        """Turn off (frost protection)."""
        await self.async_set_hvac_mode(HVACMode.OFF)

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set a preset through Netatmo (needs the cloud). Ends any hold."""
        if not _usable(self._netatmo):
            raise HomeAssistantError(
                "Netatmo is unavailable: presets need the Netatmo cloud"
            )
        self._stop_hold()
        self._last_preset = preset_mode
        await self._ensure_homekit_on()
        await self._send_netatmo_preset(preset_mode)
        self.async_write_ha_state()
