"""The device grouping a Smarther Hybrid entry's entities."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo

from .const import DOMAIN


def device_info(entry: ConfigEntry) -> DeviceInfo:
    """One device per entry, so the integration page shows a device page."""
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=entry.title,
        manufacturer="BTicino / Netatmo",
        model="Smarther2 (HomeKit + Netatmo)",
        entry_type=DeviceEntryType.SERVICE,
    )
