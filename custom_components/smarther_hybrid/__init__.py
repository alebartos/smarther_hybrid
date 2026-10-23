"""Smarther Hybrid: one climate entity built from HomeKit (local) and Netatmo (cloud)."""

from __future__ import annotations

from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .sync import SyncState

PLATFORMS = [Platform.CLIMATE, Platform.BINARY_SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_FILE = "smarther-hybrid-card.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILE}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the Lovelace card and load it in the frontend."""
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
    add_extra_js_url(hass, f"{CARD_URL}?v={version}")
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
