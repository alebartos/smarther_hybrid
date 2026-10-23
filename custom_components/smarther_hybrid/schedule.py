"""Read the Netatmo heating schedules for the schedule card.

The Netatmo integration already keeps every home's schedules in memory
(pyatmo objects); they are read from there, without extra cloud calls.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

NETATMO_DOMAIN = "netatmo"
NETATMO_DATA_HANDLER = "netatmo_data_handler"
THERM_SCHEDULE = "therm"


def _netatmo_homes(hass: HomeAssistant) -> list[Any]:
    homes: list[Any] = []
    for entry_data in hass.data.get(NETATMO_DOMAIN, {}).values():
        if not isinstance(entry_data, dict):
            continue
        handler = entry_data.get(NETATMO_DATA_HANDLER)
        account = getattr(handler, "account", None)
        homes.extend(getattr(account, "homes", {}).values())
    return homes


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
    connection.send_result(msg["id"], {"homes": heating_schedules(hass)})


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the schedule websocket command."""
    websocket_api.async_register_command(hass, ws_schedules)
