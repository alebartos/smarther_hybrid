"""Tests for the Smarther Hybrid climate entity.

The HomeKit and Netatmo source entities are plain states; commands the
hybrid entity sends to them are captured by patching its `_call` method.
"""

from datetime import timedelta
from unittest.mock import AsyncMock, call, patch

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from homeassistant.components.climate import HVACMode
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from custom_components.smarther_hybrid.const import (
    CONF_HOLD_REFRESH_HOURS,
    CONF_HOMEKIT_ENTITY,
    CONF_HUMIDITY_ENTITY,
    CONF_NETATMO_ENTITY,
    DOMAIN,
    HOLD_SETTLE_SECONDS,
)

HK = "climate.hk"
NA = "climate.na"
HUM = "sensor.hum"
ENTITY = "climate.smarther_soggiorno"


def set_homekit(hass, state="heat", temperature=20.0, current=21.5, action="idle"):
    hass.states.async_set(
        HK,
        state,
        {
            "temperature": temperature,
            "current_temperature": current,
            "hvac_action": action,
            "min_temp": 5,
            "max_temp": 30,
        },
    )


def set_netatmo(hass, preset="schedule", state="auto"):
    hass.states.async_set(
        NA, state, {"preset_mode": preset, "selected_schedule": "Inverno"}
    )


@pytest.fixture
def calls():
    """Capture service calls to the source entities."""
    with patch(
        "custom_components.smarther_hybrid.climate.SmartherHybridClimate._call",
        new_callable=AsyncMock,
    ) as mock, patch(
        "custom_components.smarther_hybrid.climate.TURN_ON_SETTLE_SECONDS", 0
    ), patch(
        "custom_components.smarther_hybrid.climate.NETATMO_COMMAND_INTERVAL", 0
    ):
        yield mock


async def setup(hass: HomeAssistant, options=None) -> MockConfigEntry:
    set_homekit(hass)
    set_netatmo(hass)
    hass.states.async_set(HUM, "68")
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Smarther Soggiorno",
        data={CONF_HOMEKIT_ENTITY: HK, CONF_NETATMO_ENTITY: NA, CONF_HUMIDITY_ENTITY: HUM},
        options=options or {},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def service(hass, name, **data):
    await hass.services.async_call(
        "climate", name, {"entity_id": ENTITY, **data}, blocking=True
    )


async def advance(hass, seconds):
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    await hass.async_block_till_done()


async def test_state_combines_sources(hass, calls):
    await setup(hass)
    state = hass.states.get(ENTITY)
    assert state.state == HVACMode.AUTO
    assert state.attributes["current_temperature"] == 21.5
    assert state.attributes["temperature"] == 20.0
    assert state.attributes["current_humidity"] == 68
    assert state.attributes["preset_mode"] == "schedule"
    assert state.attributes["selected_schedule"] == "Inverno"
    assert state.attributes["hold_active"] is False

    # Without a hold Netatmo is in charge: any preset keeps the mode on Auto.
    set_netatmo(hass, preset="manual", state="heat")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).state == HVACMode.AUTO
    assert hass.states.get(ENTITY).attributes["preset_mode"] == "manual"

    set_homekit(hass, state="off", temperature=7.0)
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).state == HVACMode.OFF
    assert hass.states.get(ENTITY).attributes["hvac_action"] == "off"


async def test_unavailable_without_homekit(hass, calls):
    await setup(hass)
    hass.states.async_set(HK, "unavailable")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).state == "unavailable"


async def test_set_temperature_goes_to_homekit(hass, calls):
    await setup(hass)
    await service(hass, "set_temperature", temperature=21.5)
    calls.assert_awaited_once_with("set_temperature", HK, temperature=21.5)


async def test_off_is_explicit_homekit_off(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="off")
    calls.assert_awaited_once_with("set_hvac_mode", HK, hvac_mode=HVACMode.OFF)


async def test_auto_selects_schedule_on_netatmo(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="auto")
    # Home mode to schedule, then cancel the room's manual change.
    assert calls.await_args_list == [
        call("set_preset_mode", NA, preset_mode="schedule"),
        call("clear_temperature_setting", NA, domain="netatmo"),
    ]


async def test_auto_needs_netatmo(hass, calls):
    await setup(hass)
    hass.states.async_set(NA, "unavailable")
    await hass.async_block_till_done()
    with pytest.raises(HomeAssistantError):
        await service(hass, "set_hvac_mode", hvac_mode="auto")
    calls.assert_not_awaited()


async def test_preset_goes_to_netatmo(hass, calls):
    await setup(hass)
    await service(hass, "set_preset_mode", preset_mode="away")
    calls.assert_awaited_once_with("set_preset_mode", NA, preset_mode="away")


async def test_heat_starts_hold_on_current_setpoint(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    calls.assert_awaited_once_with("set_temperature", HK, temperature=20.0)
    state = hass.states.get(ENTITY)
    assert state.state == HVACMode.HEAT
    assert state.attributes["hold_active"] is True
    assert state.attributes["hold_temperature"] == 20.0


async def test_hold_reapplied_when_schedule_takes_over(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    calls.reset_mock()

    # Manual change expired: the schedule moves the setpoint.
    set_homekit(hass, temperature=17.0)
    set_netatmo(hass, preset="schedule")
    await hass.async_block_till_done()
    calls.assert_not_awaited()  # waits for Netatmo to settle first

    await advance(hass, HOLD_SETTLE_SECONDS + 1)
    calls.assert_awaited_once_with("set_temperature", HK, temperature=20.0)


async def test_hold_adopts_change_made_by_a_person(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    calls.reset_mock()

    # Changed on the thermostat: Netatmo reports a manual setpoint.
    set_netatmo(hass, preset="manual", state="heat")
    set_homekit(hass, temperature=22.0)
    await hass.async_block_till_done()
    await advance(hass, HOLD_SETTLE_SECONDS + 1)

    calls.assert_not_awaited()
    assert hass.states.get(ENTITY).attributes["hold_temperature"] == 22.0


async def test_hold_follows_setpoint_set_here(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    await service(hass, "set_temperature", temperature=21.0)
    assert hass.states.get(ENTITY).attributes["hold_temperature"] == 21.0


async def test_hold_ends_on_off_preset_or_auto(hass, calls):
    await setup(hass)
    for command in (
        {"name": "set_hvac_mode", "hvac_mode": "off"},
        {"name": "set_hvac_mode", "hvac_mode": "auto"},
        {"name": "set_preset_mode", "preset_mode": "boost"},
    ):
        set_homekit(hass)
        await service(hass, "set_hvac_mode", hvac_mode="heat")
        assert hass.states.get(ENTITY).attributes["hold_active"] is True
        name = command.pop("name")
        await service(hass, name, **command)
        assert hass.states.get(ENTITY).attributes["hold_active"] is False


async def test_hold_ends_when_away_chosen_in_app(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    set_netatmo(hass, preset="away", state="auto")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).attributes["hold_active"] is False


async def test_heat_from_off_never_holds_frost_setpoint(hass, calls):
    await setup(hass)
    set_homekit(hass, state="off", temperature=7.0)
    await hass.async_block_till_done()

    await service(hass, "set_hvac_mode", hvac_mode="heat")
    assert calls.await_args_list == [call("set_hvac_mode", HK, hvac_mode=HVACMode.HEAT)]
    assert hass.states.get(ENTITY).attributes["hold_active"] is False


async def test_periodic_refresh(hass, calls):
    await setup(hass, options={CONF_HOLD_REFRESH_HOURS: 3})
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    calls.reset_mock()

    await advance(hass, 3 * 3600 + 1)
    calls.assert_awaited_once_with("set_temperature", HK, temperature=20.0)


async def test_no_periodic_refresh_without_hold(hass, calls):
    await setup(hass, options={CONF_HOLD_REFRESH_HOURS: 3})
    await advance(hass, 3 * 3600 + 1)
    calls.assert_not_awaited()


async def test_preset_keeps_auto_and_is_shown(hass, calls):
    await setup(hass)
    await service(hass, "set_preset_mode", preset_mode="away")
    set_netatmo(hass, preset="away", state="auto")
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY)
    assert state.state == HVACMode.AUTO
    assert state.attributes["preset_mode"] == "away"


async def test_auto_resends_last_preset(hass, calls):
    await setup(hass)
    await service(hass, "set_preset_mode", preset_mode="away")
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    calls.reset_mock()

    await service(hass, "set_hvac_mode", hvac_mode="auto")
    calls.assert_awaited_once_with("set_preset_mode", NA, preset_mode="away")
    assert hass.states.get(ENTITY).attributes["last_preset"] == "away"


async def test_auto_remembers_preset_chosen_in_app(hass, calls):
    await setup(hass)
    set_netatmo(hass, preset="boost", state="heat")
    await hass.async_block_till_done()
    await service(hass, "set_hvac_mode", hvac_mode="auto")
    calls.assert_awaited_once_with("set_preset_mode", NA, preset_mode="boost")


async def test_schedule_fallback_during_hold_is_not_remembered(hass, calls):
    await setup(hass)
    await service(hass, "set_preset_mode", preset_mode="away")
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    set_netatmo(hass, preset="schedule")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).attributes["last_preset"] == "away"


async def test_netatmo_commands_spaced_latest_wins(hass, calls):
    with patch("custom_components.smarther_hybrid.climate.NETATMO_COMMAND_INTERVAL", 3):
        await setup(hass)
        await service(hass, "set_preset_mode", preset_mode="away")
        await service(hass, "set_preset_mode", preset_mode="boost")
        await service(hass, "set_preset_mode", preset_mode="schedule")
        # The first goes out at once, the others wait.
        assert calls.await_args_list == [call("set_preset_mode", NA, preset_mode="away")]

        await advance(hass, 3.5)
        # Only the latest queued preset is sent.
        assert calls.await_args_list == [
            call("set_preset_mode", NA, preset_mode="away"),
            call("set_preset_mode", NA, preset_mode="schedule"),
            call("clear_temperature_setting", NA, domain="netatmo"),
        ]


async def test_off_drops_queued_netatmo_command(hass, calls):
    with patch("custom_components.smarther_hybrid.climate.NETATMO_COMMAND_INTERVAL", 3):
        await setup(hass)
        await service(hass, "set_preset_mode", preset_mode="away")
        await service(hass, "set_preset_mode", preset_mode="boost")
        await service(hass, "set_hvac_mode", hvac_mode="off")
        await advance(hass, 3.5)
        assert call("set_preset_mode", NA, preset_mode="boost") not in calls.await_args_list


SYNCED = "binary_sensor.smarther_soggiorno_sincronizzato"


async def test_synced_at_start(hass, calls):
    await setup(hass)
    assert hass.states.get(ENTITY).attributes["synced"] is True
    assert hass.states.get(SYNCED).state == "on"


async def test_setpoint_pending_until_homekit_confirms(hass, calls):
    await setup(hass)
    await service(hass, "set_temperature", temperature=21.5)
    state = hass.states.get(ENTITY)
    assert state.attributes["synced"] is False
    assert state.attributes["pending"] == ["temperature"]
    assert hass.states.get(SYNCED).state == "off"

    set_homekit(hass, temperature=21.5)
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).attributes["synced"] is True
    assert hass.states.get(SYNCED).state == "on"


async def test_preset_pending_until_netatmo_confirms(hass, calls):
    await setup(hass)
    await service(hass, "set_preset_mode", preset_mode="away")
    state = hass.states.get(ENTITY)
    # Accepted by the cloud (orange) until Netatmo reports it.
    assert state.attributes["pending"] == ["preset"]
    assert state.attributes["sync_state"] == "accepted"
    set_netatmo(hass, preset="away")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).attributes["synced"] is True


async def test_off_pending_until_homekit_off(hass, calls):
    await setup(hass)
    await service(hass, "set_hvac_mode", hvac_mode="off")
    assert hass.states.get(ENTITY).attributes["pending"] == ["hvac"]
    set_homekit(hass, state="off", temperature=7.0)
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY).attributes["synced"] is True


async def test_refused_command_stays_pending(hass, calls):
    await setup(hass)
    calls.side_effect = HomeAssistantError("boom")
    with pytest.raises(HomeAssistantError):
        await service(hass, "set_temperature", temperature=23)
    state = hass.states.get(ENTITY)
    assert state.attributes["synced"] is False
    assert state.attributes["sync_state"] == "pending"


async def test_refused_netatmo_preset_stays_pending(hass, calls):
    await setup(hass)
    calls.side_effect = HomeAssistantError("boom")
    with pytest.raises(HomeAssistantError):
        await service(hass, "set_preset_mode", preset_mode="away")
    assert hass.states.get(ENTITY).attributes["sync_state"] == "pending"


async def test_queued_preset_is_pending_and_dropped_by_off(hass, calls):
    with patch("custom_components.smarther_hybrid.climate.NETATMO_COMMAND_INTERVAL", 3):
        await setup(hass)
        await service(hass, "set_preset_mode", preset_mode="away")
        set_netatmo(hass, preset="away")
        await service(hass, "set_preset_mode", preset_mode="boost")  # queued
        await hass.async_block_till_done()
        assert hass.states.get(ENTITY).attributes["pending"] == ["preset"]

        await service(hass, "set_hvac_mode", hvac_mode="off")
        assert hass.states.get(ENTITY).attributes["pending"] == ["hvac"]


async def test_synced_sensor_unavailable_without_homekit(hass, calls):
    await setup(hass)
    hass.states.async_set(HK, "unavailable")
    await hass.async_block_till_done()
    assert hass.states.get(SYNCED).state == "unavailable"



async def test_reselecting_current_preset_is_synced_once_accepted(hass, calls):
    await setup(hass)  # Netatmo already reports schedule
    await service(hass, "set_preset_mode", preset_mode="schedule")
    assert hass.states.get(ENTITY).attributes["sync_state"] == "synced"


async def test_chosen_preset_shown_until_netatmo_confirms(hass, calls):
    await setup(hass)
    set_netatmo(hass, preset="manual", state="heat")
    await service(hass, "set_hvac_mode", hvac_mode="heat")
    await service(hass, "set_hvac_mode", hvac_mode="auto")
    # Netatmo still says manual: the chosen preset stays highlighted.
    assert hass.states.get(ENTITY).attributes["preset_mode"] == "schedule"
    assert hass.states.get(ENTITY).attributes["sync_state"] == "accepted"

    # Netatmo catches up (it may report "home" for the schedule).
    set_netatmo(hass, preset="home", state="auto")
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY)
    assert state.attributes["preset_mode"] == "schedule"
    assert state.attributes["sync_state"] == "synced"
