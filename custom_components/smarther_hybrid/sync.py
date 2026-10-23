"""Commands sent to the thermostat that are still waiting for confirmation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import CALLBACK_TYPE, callback


class SyncState:
    """Shared between the climate entity and the "synced" binary sensor.

    Each key is a kind of command (temperature, hvac, preset) with the value
    the thermostat is expected to report. A key disappears once the source
    entity reports that value or the command is superseded.
    """

    def __init__(self) -> None:
        """Start with nothing pending."""
        self.pending: dict[str, Any] = {}
        self.available = False
        self._listeners: list[Callable[[], None]] = []

    @property
    def synced(self) -> bool:
        """True when every command has been confirmed."""
        return not self.pending

    @callback
    def add_listener(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call `listener` whenever the sync state may have changed."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    @callback
    def notify(self) -> None:
        """Tell listeners to refresh."""
        for listener in list(self._listeners):
            listener()
