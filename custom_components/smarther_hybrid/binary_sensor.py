"""Binary sensor telling whether every command sent has been confirmed."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import ATTR_PENDING, ATTR_SYNC_STATE
from .device import device_info
from .sync import SyncState


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the synced binary sensor."""
    async_add_entities([SmartherSyncedSensor(entry, entry.runtime_data)])


class SmartherSyncedSensor(BinarySensorEntity):
    """On when the thermostat has confirmed every command."""

    _attr_should_poll = False
    _attr_has_entity_name = False

    def __init__(self, entry: ConfigEntry, sync: SyncState) -> None:
        """Initialize from the config entry."""
        self._sync = sync
        self._attr_unique_id = f"{entry.entry_id}_synced"
        self._attr_device_info = device_info(entry)
        self._attr_name = f"{entry.title} sincronizzato"

    async def async_added_to_hass(self) -> None:
        """Follow the shared sync state."""
        self.async_on_remove(self._sync.add_listener(self.async_write_ha_state))

    @property
    def available(self) -> bool:
        """Available while the thermostat is reachable."""
        return self._sync.available

    @property
    def is_on(self) -> bool:
        """True when nothing is waiting for confirmation."""
        return self._sync.synced

    @property
    def icon(self) -> str:
        """Sync icon, with an alert while commands are pending."""
        return "mdi:sync" if self._sync.synced else "mdi:sync-alert"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """List what is still waiting."""
        return {
            ATTR_SYNC_STATE: self._sync.state,
            ATTR_PENDING: self._sync.waiting,
        }
