"""Tests for reading the Netatmo heating schedules."""

from types import SimpleNamespace as NS

from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.smarther_hybrid.const import (
    CONF_HOMEKIT_ENTITY,
    CONF_NETATMO_ENTITY,
    DOMAIN,
)


def fake_netatmo(hass):
    room = NS(entity_id="r1", name="Soggiorno")
    comfort = NS(
        entity_id=0,
        name="Comfort",
        type=0,
        rooms=[NS(entity_id="r1", therm_setpoint_temperature=21.0)],
    )
    night = NS(
        entity_id=1,
        name="Notte",
        type=1,
        rooms=[NS(entity_id="r1", therm_setpoint_temperature=17.0)],
    )
    winter = NS(
        entity_id="s1",
        name="Inverno",
        type="therm",
        selected=True,
        away_temp=16,
        hg_temp=7,
        zones=[comfort, night],
        timetable=[NS(m_offset=420, zone_id=0), NS(m_offset=0, zone_id=1)],
    )
    lights = NS(entity_id="s2", name="Luci", type="event", selected=False)
    home = NS(
        entity_id="h1",
        name="Casa",
        rooms={"r1": room},
        schedules={"s1": winter, "s2": lights},
    )
    handler = NS(account=NS(homes={"h1": home}))
    # Recent Home Assistant: the data handler is the entry's runtime_data.
    entry = MockConfigEntry(domain="netatmo")
    entry.add_to_hass(hass)
    entry.runtime_data = handler
    return home


async def test_ws_schedules(hass, hass_ws_client):
    assert await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="S",
        data={CONF_HOMEKIT_ENTITY: "climate.hk", CONF_NETATMO_ENTITY: "climate.na"},
    )
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    fake_netatmo(hass)

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "smarther_hybrid/schedules"})
    msg = await client.receive_json()
    assert msg["success"]
    (home,) = msg["result"]["homes"]
    assert home["name"] == "Casa"
    (schedule,) = home["schedules"]  # the lights schedule is left out
    assert schedule["name"] == "Inverno"
    assert schedule["selected"] is True
    assert [z["name"] for z in schedule["zones"]] == ["Comfort", "Notte"]
    assert schedule["zones"][0]["rooms"] == [
        {"id": "r1", "name": "Soggiorno", "temperature": 21.0}
    ]
    # Sorted by offset.
    assert schedule["timetable"] == [
        {"m_offset": 0, "zone_id": 1},
        {"m_offset": 420, "zone_id": 0},
    ]


async def test_ws_schedules_without_netatmo(hass, hass_ws_client):
    assert await async_setup_component(hass, "websocket_api", {})
    assert await async_setup_component(hass, DOMAIN, {})
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "smarther_hybrid/schedules"})
    msg = await client.receive_json()
    assert msg["result"] == {"homes": [], "netatmo_found": False}


async def _client_with_two_schedules(hass, hass_ws_client):
    assert await async_setup_component(hass, "websocket_api", {})
    assert await async_setup_component(hass, DOMAIN, {})
    home = fake_netatmo(hass)
    summer = NS(
        entity_id="s3",
        name="Estate",
        type="therm",
        selected=False,
        away_temp=16,
        hg_temp=7,
        zones=[],
        timetable=[],
    )
    home.schedules["s3"] = summer

    async def switch(schedule_id):
        for sched in home.schedules.values():
            sched.selected = sched.entity_id == schedule_id
        return True

    home.async_switch_schedule = switch
    return await hass_ws_client(hass), home


async def test_ws_switch_schedule(hass, hass_ws_client):
    client, home = await _client_with_two_schedules(hass, hass_ws_client)
    await client.send_json(
        {"id": 1, "type": "smarther_hybrid/switch_schedule", "home_id": "h1", "schedule_id": "s3"}
    )
    msg = await client.receive_json()
    assert msg["success"]
    selected = [s["name"] for s in msg["result"]["homes"][0]["schedules"] if s["selected"]]
    assert selected == ["Estate"]


async def test_ws_switch_unknown_schedule(hass, hass_ws_client):
    client, _ = await _client_with_two_schedules(hass, hass_ws_client)
    await client.send_json(
        {"id": 1, "type": "smarther_hybrid/switch_schedule", "home_id": "h1", "schedule_id": "nope"}
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "not_found"


async def test_ws_switch_refused(hass, hass_ws_client):
    client, home = await _client_with_two_schedules(hass, hass_ws_client)

    async def refuse(schedule_id):
        return False

    home.async_switch_schedule = refuse
    await client.send_json(
        {"id": 1, "type": "smarther_hybrid/switch_schedule", "home_id": "h1", "schedule_id": "s3"}
    )
    msg = await client.receive_json()
    assert msg["error"]["code"] == "switch_failed"



async def test_ws_schedules_legacy_hass_data(hass, hass_ws_client):
    """Older Home Assistant kept the data handler in hass.data."""
    assert await async_setup_component(hass, "websocket_api", {})
    assert await async_setup_component(hass, DOMAIN, {})
    fake_netatmo(hass)
    entry = hass.config_entries.async_entries("netatmo")[0]
    handler = entry.runtime_data
    del entry.runtime_data
    hass.data["netatmo"] = {entry.entry_id: {"netatmo_data_handler": handler}}

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "smarther_hybrid/schedules"})
    msg = await client.receive_json()
    assert msg["result"]["netatmo_found"] is True
    assert msg["result"]["homes"][0]["schedules"][0]["name"] == "Inverno"


class FakeAuth:
    """Records synchomeschedule requests."""

    def __init__(self, status="ok"):
        self.requests = []
        self.status = status

    async def async_post_api_request(self, endpoint, params):
        self.requests.append((endpoint, params))
        status = self.status

        class Resp:
            async def json(self):
                return {"status": status}

        return Resp()


async def _client_for_edit(hass, hass_ws_client, status="ok"):
    assert await async_setup_component(hass, "websocket_api", {})
    assert await async_setup_component(hass, DOMAIN, {})
    home = fake_netatmo(hass)
    home.auth = FakeAuth(status)
    return await hass_ws_client(hass), home


WEEKDAYS_7_TO_22 = [{"m_offset": 0, "zone_id": 1}] + [
    entry
    for day in range(7)
    for entry in (
        {"m_offset": day * 1440 + 420, "zone_id": 0},
        {"m_offset": day * 1440 + 1320, "zone_id": 1},
    )
]


async def test_save_schedule_keeps_name_and_backs_up(hass, hass_ws_client):
    client, home = await _client_for_edit(hass, hass_ws_client)
    await client.send_json(
        {
            "id": 1,
            "type": "smarther_hybrid/save_schedule",
            "home_id": "h1",
            "schedule_id": "s1",
            "zones": [{"id": 0, "rooms": {"r1": 21.5}}],
            "timetable": WEEKDAYS_7_TO_22,
        }
    )
    msg = await client.receive_json()
    assert msg["success"], msg
    ((endpoint, params),) = home.auth.requests
    assert endpoint == "api/synchomeschedule"
    assert params["params"] == {"home_id": "h1", "schedule_id": "s1", "name": "Inverno"}
    body = params["json"]
    assert body["zones"][0]["rooms"] == [{"id": "r1", "therm_setpoint_temperature": 21.5}]
    # Unchanged zone keeps its temperature.
    assert body["zones"][1]["rooms"] == [{"id": "r1", "therm_setpoint_temperature": 17.0}]
    assert body["timetable"][0] == {"m_offset": 0, "zone_id": 1}
    assert len(body["timetable"]) == len(WEEKDAYS_7_TO_22)
    assert msg["result"]["homes"][0]["schedules"][0]["backups"] == 1


async def test_save_rejects_bad_schedules(hass, hass_ws_client):
    client, home = await _client_for_edit(hass, hass_ws_client)
    bad = [
        {"zones": [{"id": 0, "rooms": {"r1": 40}}], "timetable": WEEKDAYS_7_TO_22},
        {"zones": [], "timetable": [{"m_offset": 60, "zone_id": 0}]},
        {"zones": [], "timetable": [{"m_offset": 0, "zone_id": 9}]},
    ]
    for i, data in enumerate(bad, start=1):
        await client.send_json(
            {"id": i, "type": "smarther_hybrid/save_schedule", "home_id": "h1", "schedule_id": "s1", **data}
        )
        msg = await client.receive_json()
        assert not msg["success"]
        assert msg["error"]["code"] == "save_failed"
    assert home.auth.requests == []


async def test_refused_save_leaves_no_backup(hass, hass_ws_client):
    client, home = await _client_for_edit(hass, hass_ws_client, status="error")
    await client.send_json(
        {
            "id": 1,
            "type": "smarther_hybrid/save_schedule",
            "home_id": "h1",
            "schedule_id": "s1",
            "zones": [],
            "timetable": WEEKDAYS_7_TO_22,
        }
    )
    assert not (await client.receive_json())["success"]
    await client.send_json({"id": 2, "type": "smarther_hybrid/schedules"})
    msg = await client.receive_json()
    assert msg["result"]["homes"][0]["schedules"][0]["backups"] == 0


async def test_restore_sends_previous_version(hass, hass_ws_client):
    client, home = await _client_for_edit(hass, hass_ws_client)
    await client.send_json(
        {
            "id": 1,
            "type": "smarther_hybrid/save_schedule",
            "home_id": "h1",
            "schedule_id": "s1",
            "zones": [{"id": 0, "rooms": {"r1": 23}}],
            "timetable": WEEKDAYS_7_TO_22,
        }
    )
    assert (await client.receive_json())["success"]
    await client.send_json(
        {"id": 2, "type": "smarther_hybrid/restore_schedule", "home_id": "h1", "schedule_id": "s1"}
    )
    msg = await client.receive_json()
    assert msg["success"], msg
    _, params = home.auth.requests[-1]
    # The original version: comfort 21°, timetable as it was.
    assert params["json"]["zones"][0]["rooms"] == [{"id": "r1", "therm_setpoint_temperature": 21.0}]
    assert params["json"]["timetable"] == [{"m_offset": 0, "zone_id": 1}, {"m_offset": 420, "zone_id": 0}]
    assert msg["result"]["homes"][0]["schedules"][0]["backups"] == 0
