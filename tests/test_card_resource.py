"""The card is registered as a dashboard resource, once, with the version."""

from homeassistant.setup import async_setup_component

from custom_components.smarther_hybrid import CARD_URL, async_register_card_resource


def _card_items(hass):
    resources = hass.data["lovelace"].resources
    return [i for i in resources.async_items() if i["url"].startswith(CARD_URL)]


async def test_card_resource_added_then_updated(hass):
    assert await async_setup_component(hass, "lovelace", {})

    assert await async_register_card_resource(hass, f"{CARD_URL}?v=1")
    assert await async_register_card_resource(hass, f"{CARD_URL}?v=1")
    items = _card_items(hass)
    assert len(items) == 1
    assert items[0]["url"] == f"{CARD_URL}?v=1"
    assert items[0]["type"] == "module"

    # An update replaces the URL instead of adding a second resource.
    assert await async_register_card_resource(hass, f"{CARD_URL}?v=2")
    items = _card_items(hass)
    assert [i["url"] for i in items] == [f"{CARD_URL}?v=2"]


async def test_yaml_resources_fall_back(hass):
    assert await async_setup_component(
        hass, "lovelace", {"lovelace": {"resource_mode": "yaml"}}
    )
    assert not await async_register_card_resource(hass, f"{CARD_URL}?v=1")
