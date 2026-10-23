"""Read the Netatmo heating schedules for the schedule card.

The Netatmo integration already keeps every home's schedules in memory
(pyatmo objects); they are read from there, without extra cloud calls.
Recent Home Assistant versions keep its data handler in the config entry's
runtime_data, older ones in hass.data["netatmo"][entry_id].
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

NETATMO_DOMAIN = "netatmo"
NETATMO_DATA_HANDLER = "netatmo_data_handler"
THERM_SCHEDULE = "therm"


def _netatmo_accounts(hass: HomeAssistant) -> list[Any]:
    legacy = hass.data.get(NETATMO_DOMAIN, {})
    accounts: list[Any] = []
    for entry in hass.config_entries.async_entries(NETATMO_DOMAIN):
        handler = getattr(entry, "runtime_data", None)
        if handler is None and isinstance(legacy.get(entry.entry_id), dict):
            handler = legacy[entry.entry_id].get(NETATMO_DATA_HANDLER)
        if (account := getattr(handler, "account", None)) is not None:
            accounts.append(account)
    return accounts


def _netatmo_homes(hass: HomeAssistant) -> list[Any]:
    return [
        home
        for account in _netatmo_accounts(hass)
        for home in getattr(account, "homes", {}).values()
    ]


def _room_name(home: Any, room_id: str) -> str:
    room = getattr(home, "rooms", {}).get(room_id)
    return getattr(room, "name", None) or room_id


def _schedule_data(home: Any, schedule: Any) -> dict[str, Any]:
    return {
        "id": schedule.entity_id,
        "name": schedule.name,
        "selected": bool(schedule.selected),
        "away_temp": schedule.away_temp,
        "hg_temp": schedule.hg_temp,
        "zones": [
            {
                "id": zone.entity_id,
                "name": zone.name,
                "type": zone.type,
                "rooms": [
                    {
                        "id": room.entity_id,
                        "name": _room_name(home, room.entity_id),
                        "temperature": room.therm_setpoint_temperature,
                    }
                    for room in zone.rooms
                ],
            }
            for zone in schedule.zones
        ],
        "timetable": sorted(
            (
                {"m_offset": entry.m_offset, "zone_id": entry.zone_id}
                for entry in schedule.timetable
            ),
            key=lambda entry: entry["m_offset"],
        ),
    }


def heating_schedules(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Heating schedules of every Netatmo home, as plain data."""
    return [
        {
            "id": home.entity_id,
            "name": home.name,
            "schedules": [
                _schedule_data(home, schedule)
                for schedule in getattr(home, "schedules", {}).values()
                if str(getattr(schedule, "type", THERM_SCHEDULE)) == THERM_SCHEDULE
            ],
        }
        for home in _netatmo_homes(hass)
    ]


@websocket_api.websocket_command({vol.Required("type"): "smarther_hybrid/schedules"})
@callback
def ws_schedules(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the heating schedules."""
    connection.send_result(
        msg["id"],
        {
            "homes": heating_schedules(hass),
            "netatmo_found": bool(_netatmo_accounts(hass)),
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "smarther_hybrid/switch_schedule",
        vol.Required("home_id"): str,
        vol.Required("schedule_id"): str,
    }
)
@websocket_api.async_response
async def ws_switch_schedule(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Make a schedule the active one (by id: names are not reliable)."""
    home = next(
        (h for h in _netatmo_homes(hass) if h.entity_id == msg["home_id"]), None
    )
    if home is None or msg["schedule_id"] not in getattr(home, "schedules", {}):
        connection.send_error(msg["id"], "not_found", "Unknown home or schedule")
        return
    try:
        switched = await home.async_switch_schedule(msg["schedule_id"])
    except Exception as err:  # noqa: BLE001 - report any Netatmo error
        connection.send_error(msg["id"], "switch_failed", str(err))
        return
    if not switched:
        connection.send_error(msg["id"], "switch_failed", "Netatmo refused the change")
        return
    connection.send_result(msg["id"], {"homes": heating_schedules(hass)})


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the schedule websocket commands."""
    websocket_api.async_register_command(hass, ws_schedules)
    websocket_api.async_register_command(hass, ws_switch_schedule)
