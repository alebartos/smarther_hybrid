"""Climate entity combining a HomeKit (local) and a Netatmo (cloud) Smarther entity.

State and setpoint come from HomeKit, which pushes changes locally.
Presets come from Netatmo, the only source that knows about schedules.
Commands are sent only when the user acts; the two sources are never
reconciled automatically.
"""

from __future__ import annotations

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
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from .const import (
    CONF_HOMEKIT_ENTITY,
    CONF_HUMIDITY_ENTITY,
    CONF_NETATMO_ENTITY,
    DEFAULT_MAX_TEMP,
    DEFAULT_MIN_TEMP,
    NETATMO_ATTR_SELECTED_SCHEDULE,
    SETTABLE_PRESETS,
    TEMP_STEP,
)

ATTR_CURRENT_TEMPERATURE = "current_temperature"


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


class SmartherHybridClimate(ClimateEntity):
    """Smarther thermostat: HomeKit for state and setpoint, Netatmo for presets."""

    _attr_should_poll = False
    _attr_translation_key = "smarther"
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_target_temperature_step = TEMP_STEP
    _attr_hvac_modes = [HVACMode.HEAT, HVACMode.OFF]
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
        self._attr_name = entry.title
        self._attr_unique_id = entry.entry_id

    async def async_added_to_hass(self) -> None:
        """Follow the source entities instead of polling."""
        sources = [self._homekit_id, self._netatmo_id]
        if self._humidity_id:
            sources.append(self._humidity_id)

        @callback
        def _source_changed(event: Event[EventStateChangedData]) -> None:
            self.async_write_ha_state()

        self.async_on_remove(
            async_track_state_change_event(self.hass, sources, _source_changed)
        )

    @property
    def _homekit(self) -> State | None:
        return self.hass.states.get(self._homekit_id)

    @property
    def _netatmo(self) -> State | None:
        return self.hass.states.get(self._netatmo_id)

    @property
    def available(self) -> bool:
        """Available as long as the local HomeKit entity is."""
        return _usable(self._homekit)

    @property
    def hvac_mode(self) -> HVACMode | None:
        """Heat or off, as reported by HomeKit."""
        state = self._homekit
        if not _usable(state):
            return None
        return HVACMode.OFF if state.state == HVACMode.OFF else HVACMode.HEAT

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
        state = self._netatmo
        if not _usable(state):
            return None
        return state.attributes.get(ATTR_PRESET_MODE)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the active schedule and where each value comes from."""
        netatmo = self._netatmo
        return {
            NETATMO_ATTR_SELECTED_SCHEDULE: (
                netatmo.attributes.get(NETATMO_ATTR_SELECTED_SCHEDULE)
                if _usable(netatmo)
                else None
            ),
            "netatmo_available": _usable(netatmo),
            "homekit_entity": self._homekit_id,
            "netatmo_entity": self._netatmo_id,
        }

    async def _call(self, service: str, entity_id: str, **data: Any) -> None:
        await self.hass.services.async_call(
            CLIMATE_DOMAIN,
            service,
            {ATTR_ENTITY_ID: entity_id, **data},
            blocking=True,
            context=self._context,
        )

    async def async_set_temperature(self, **kwargs: Any) -> None:
        """Set the heating setpoint locally through HomeKit."""
        if (hvac_mode := kwargs.get("hvac_mode")) is not None:
            await self.async_set_hvac_mode(hvac_mode)
        if (temperature := kwargs.get(ATTR_TEMPERATURE)) is not None:
            await self._call(
                SERVICE_SET_TEMPERATURE, self._homekit_id, temperature=temperature
            )

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Heat or off through HomeKit.

        Off is the thermostat's real off, which the Smarther treats as frost
        protection (7 °C). It is only sent when explicitly requested.
        """
        if hvac_mode not in self._attr_hvac_modes:
            raise HomeAssistantError(f"Unsupported HVAC mode: {hvac_mode}")
        await self._call(SERVICE_SET_HVAC_MODE, self._homekit_id, hvac_mode=hvac_mode)

    async def async_turn_on(self) -> None:
        """Turn on (heat)."""
        await self.async_set_hvac_mode(HVACMode.HEAT)

    async def async_turn_off(self) -> None:
        """Turn off (frost protection)."""
        await self.async_set_hvac_mode(HVACMode.OFF)

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set a preset through Netatmo (needs the cloud)."""
        if not _usable(self._netatmo):
            raise HomeAssistantError(
                "Netatmo is unavailable: presets need the Netatmo cloud"
            )
        await self._call(
            SERVICE_SET_PRESET_MODE, self._netatmo_id, preset_mode=preset_mode
        )
