"""Read and edit the Netatmo heating schedules for the schedule card.

The Netatmo integration already keeps every home's schedules in memory
(pyatmo objects); they are read from there, without extra cloud calls.
Recent Home Assistant versions keep its data handler in the config entry's
runtime_data, older ones in hass.data["netatmo"][entry_id].

Saving rewrites the whole schedule on Netatmo (synchomeschedule). pyatmo's
own sync always names the schedule "Default", so the request is built here
with the real name. Every save keeps a backup that can be restored.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

NETATMO_DOMAIN = "netatmo"
NETATMO_DATA_HANDLER = "netatmo_data_handler"
THERM_SCHEDULE = "therm"
SYNC_ENDPOINT = "api/synchomeschedule"

WEEK_MINUTES = 7 * 24 * 60
MIN_TEMP = 5.0
MAX_TEMP = 30.0
MAX_BACKUPS = 10

BACKUPS_KEY = "smarther_hybrid_schedule_backups"
STORAGE_KEY = "smarther_hybrid.schedule_backups"
STORAGE_VERSION = 1


class ScheduleError(Exception):
    """A schedule that cannot be saved."""


async def _backups(hass: HomeAssistant) -> tuple[Store, dict[str, list[dict]]]:
    """Saved versions per schedule id, newest last."""
    if BACKUPS_KEY not in hass.data:
        store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        hass.data[BACKUPS_KEY] = (store, await store.async_load() or {})
    return hass.data[BACKUPS_KEY]


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


def _heating(home: Any) -> list[Any]:
    return [
        schedule
        for schedule in getattr(home, "schedules", {}).values()
        if str(getattr(schedule, "type", THERM_SCHEDULE)) == THERM_SCHEDULE
    ]


def heating_schedules(
    hass: HomeAssistant, backups: dict[str, list[dict]] | None = None
) -> list[dict[str, Any]]:
    """Heating schedules of every Netatmo home, as plain data."""
    backups = backups or {}
    return [
        {
            "id": home.entity_id,
            "name": home.name,
            "schedules": [
                {
                    **_schedule_data(home, schedule),
                    "backups": len(backups.get(schedule.entity_id, [])),
                }
                for schedule in _heating(home)
            ],
        }
        for home in _netatmo_homes(hass)
    ]


def _find(hass: HomeAssistant, home_id: str, schedule_id: str) -> tuple[Any, Any]:
    home = next((h for h in _netatmo_homes(hass) if h.entity_id == home_id), None)
    schedule = next(
        (s for s in _heating(home) if s.entity_id == schedule_id), None
    ) if home is not None else None
    if schedule is None:
        raise ScheduleError("Unknown home or schedule")
    return home, schedule


def _validated(
    schedule: Any, zones: list[dict[str, Any]], timetable: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, int]]]:
    """Zones and timetable ready for Netatmo, or ScheduleError."""
    known = {zone.entity_id: zone for zone in schedule.zones}
    temps = {str(z["id"]): z.get("rooms", {}) for z in zones}
    netatmo_zones = []
    for zone_id, zone in known.items():
        rooms = []
        for room in zone.rooms:
            temp = temps.get(str(zone_id), {}).get(
                room.entity_id, room.therm_setpoint_temperature
            )
            if temp is None or not MIN_TEMP <= float(temp) <= MAX_TEMP:
                raise ScheduleError(f"Temperature out of range in {zone.name}")
            rooms.append({"id": room.entity_id, "therm_setpoint_temperature": float(temp)})
        netatmo_zones.append(
            {"id": zone_id, "name": zone.name, "type": zone.type, "rooms": rooms}
        )

    entries = sorted(timetable, key=lambda e: e["m_offset"])
    if not entries or entries[0]["m_offset"] != 0:
        raise ScheduleError("The timetable must start on Monday at 00:00")
    offsets = [e["m_offset"] for e in entries]
    if len(set(offsets)) != len(offsets) or offsets[-1] >= WEEK_MINUTES:
        raise ScheduleError("Invalid times in the timetable")
    by_str = {str(zone_id): zone_id for zone_id in known}
    netatmo_timetable = []
    for entry in entries:
        if str(entry["zone_id"]) not in by_str:
            raise ScheduleError("Unknown zone in the timetable")
        zone_id = by_str[str(entry["zone_id"])]
        # Consecutive entries with the same zone are redundant.
        if netatmo_timetable and netatmo_timetable[-1]["zone_id"] == zone_id:
            continue
        netatmo_timetable.append({"m_offset": int(entry["m_offset"]), "zone_id": zone_id})
    return netatmo_zones, netatmo_timetable


def _raw(schedule: Any) -> dict[str, Any]:
    """The schedule as Netatmo data, for backups and restores."""
    return {
        "zones": [
            {
                "id": zone.entity_id,
                "rooms": {
                    room.entity_id: room.therm_setpoint_temperature for room in zone.rooms
                },
            }
            for zone in schedule.zones
        ],
        "timetable": [
            {"m_offset": e.m_offset, "zone_id": e.zone_id} for e in schedule.timetable
        ],
    }


async def _sync(
    home: Any,
    schedule: Any,
    zones: list[dict[str, Any]],
    timetable: list[dict[str, int]],
) -> None:
    """Rewrite the schedule on Netatmo, keeping its name."""
    resp = await home.auth.async_post_api_request(
        endpoint=SYNC_ENDPOINT,
        params={
            "params": {
                "home_id": home.entity_id,
                "schedule_id": schedule.entity_id,
                "name": schedule.name,
            },
            "json": {
                "away_temp": schedule.away_temp,
                "hg_temp": schedule.hg_temp,
                "timetable": timetable,
                "zones": zones,
            },
        },
    )
    if (await resp.json()).get("status") != "ok":
        raise ScheduleError("Netatmo refused the schedule")
    # Same data in memory until the Netatmo integration refreshes it.
    if hasattr(schedule, "update_topology"):
        schedule.update_topology(
            {
                "id": schedule.entity_id,
                "name": schedule.name,
                "type": THERM_SCHEDULE,
                "selected": schedule.selected,
                "away_temp": schedule.away_temp,
                "hg_temp": schedule.hg_temp,
                "timetable": timetable,
                "zones": zones,
            }
        )


async def async_save_schedule(
    hass: HomeAssistant,
    home_id: str,
    schedule_id: str,
    zones: list[dict[str, Any]],
    timetable: list[dict[str, Any]],
) -> None:
    """Validate, back up the current version, then save."""
    home, schedule = _find(hass, home_id, schedule_id)
    netatmo_zones, netatmo_timetable = _validated(schedule, zones, timetable)
    store, backups = await _backups(hass)
    history = backups.setdefault(schedule_id, [])
    history.append({"time": dt_util.utcnow().isoformat(), **_raw(schedule)})
    del history[:-MAX_BACKUPS]
    try:
        await _sync(home, schedule, netatmo_zones, netatmo_timetable)
    except Exception:
        history.pop()
        raise
    await store.async_save(backups)


async def async_restore_schedule(
    hass: HomeAssistant, home_id: str, schedule_id: str
) -> None:
    """Put back the version saved before the last change."""
    home, schedule = _find(hass, home_id, schedule_id)
    store, backups = await _backups(hass)
    history = backups.get(schedule_id) or []
    if not history:
        raise ScheduleError("No backup to restore")
    previous = history[-1]
    netatmo_zones, netatmo_timetable = _validated(
        schedule, previous["zones"], previous["timetable"]
    )
    await _sync(home, schedule, netatmo_zones, netatmo_timetable)
    history.pop()
    await store.async_save(backups)


async def _result(hass: HomeAssistant) -> dict[str, Any]:
    _, backups = await _backups(hass)
    return {
        "homes": heating_schedules(hass, backups),
        "netatmo_found": bool(_netatmo_accounts(hass)),
    }


@websocket_api.websocket_command({vol.Required("type"): "smarther_hybrid/schedules"})
@websocket_api.async_response
async def ws_schedules(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the heating schedules."""
    connection.send_result(msg["id"], await _result(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "smarther_hybrid/save_schedule",
        vol.Required("home_id"): str,
        vol.Required("schedule_id"): str,
        vol.Required("zones"): [
            {
                vol.Required("id"): vol.Any(str, int),
                vol.Required("rooms"): {str: vol.Coerce(float)},
            }
        ],
        vol.Required("timetable"): [
            {
                vol.Required("m_offset"): vol.All(
                    vol.Coerce(int), vol.Range(min=0, max=WEEK_MINUTES - 1)
                ),
                vol.Required("zone_id"): vol.Any(str, int),
            }
        ],
    }
)
@websocket_api.async_response
async def ws_save_schedule(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Save zone temperatures and timetable, backing up the old version."""
    try:
        await async_save_schedule(
            hass, msg["home_id"], msg["schedule_id"], msg["zones"], msg["timetable"]
        )
    except Exception as err:  # noqa: BLE001 - report it to the card
        connection.send_error(msg["id"], "save_failed", str(err))
        return
    connection.send_result(msg["id"], await _result(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "smarther_hybrid/restore_schedule",
        vol.Required("home_id"): str,
        vol.Required("schedule_id"): str,
    }
)
@websocket_api.async_response
async def ws_restore_schedule(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Restore the version saved before the last change."""
    try:
        await async_restore_schedule(hass, msg["home_id"], msg["schedule_id"])
    except Exception as err:  # noqa: BLE001 - report it to the card
        connection.send_error(msg["id"], "restore_failed", str(err))
        return
    connection.send_result(msg["id"], await _result(hass))


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
    connection.send_result(msg["id"], await _result(hass))


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the schedule websocket commands."""
    websocket_api.async_register_command(hass, ws_schedules)
    websocket_api.async_register_command(hass, ws_switch_schedule)
    websocket_api.async_register_command(hass, ws_save_schedule)
    websocket_api.async_register_command(hass, ws_restore_schedule)
