"""Smarther Hybrid: one climate entity built from HomeKit (local) and Netatmo (cloud)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .schedule import async_register_websocket
from .sync import SyncState

PLATFORMS = [Platform.CLIMATE, Platform.BINARY_SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_LOGGER = logging.getLogger(__name__)

CARD_FILE = "smarther-hybrid-card.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILE}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the Lovelace cards and load them in the frontend."""
    async_register_websocket(hass)
    if getattr(hass, "http", None) is None:
        return True  # no web server (e.g. tests): nothing to serve

    from homeassistant.components.frontend import add_extra_js_url
    from homeassistant.components.http import StaticPathConfig

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                CARD_URL, str(Path(__file__).parent / "frontend" / CARD_FILE), True
            )
        ]
    )
    # The version busts the browser cache after an update.
    version = (await async_get_integration(hass, DOMAIN)).version
    url = f"{CARD_URL}?v={version}"
    # A dashboard resource is loaded before cards are drawn; an extra JS URL
    # is not, so a slow load showed "configuration error" until a reload.
    try:
        registered = await async_register_card_resource(hass, url)
    except Exception:  # noqa: BLE001 - never block setup over the card
        _LOGGER.exception("Could not add the card to the dashboard resources")
        registered = False
    if not registered and "frontend" in hass.config.components:
        add_extra_js_url(hass, url)
    return True


def _lovelace_resources(hass: HomeAssistant) -> Any:
    data = hass.data.get("lovelace")
    if data is None:
        return None
    if isinstance(data, dict):  # before Home Assistant 2025.2
        return data.get("resources")
    return getattr(data, "resources", None)


async def async_register_card_resource(hass: HomeAssistant, url: str) -> bool:
    """Add or update the card in the dashboard resources (storage mode only)."""
    resources = _lovelace_resources(hass)
    if resources is None or not hasattr(resources, "async_create_item"):
        return False  # resources managed in YAML
    await resources.async_get_info()  # loads the stored resources
    for item in resources.async_items():
        if item.get("url", "").split("?")[0] == CARD_URL:
            if item["url"] != url:
                await resources.async_update_item(
                    item["id"], {"res_type": "module", "url": url}
                )
            return True
    await resources.async_create_item({"res_type": "module", "url": url})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Smarther Hybrid from a config entry."""
    entry.runtime_data = SyncState()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload so the entities pick up new options."""
    await hass.config_entries.async_reload(entry.entry_id)
