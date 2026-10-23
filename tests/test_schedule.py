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
    hass.data["netatmo"] = {"entry": {"netatmo_data_handler": handler}}


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
    assert msg["result"] == {"homes": []}


async def _client_with_two_schedules(hass, hass_ws_client):
    assert await async_setup_component(hass, "websocket_api", {})
    assert await async_setup_component(hass, DOMAIN, {})
    fake_netatmo(hass)
    home = hass.data["netatmo"]["entry"]["netatmo_data_handler"].account.homes["h1"]
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
