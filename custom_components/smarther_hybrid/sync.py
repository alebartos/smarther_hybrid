"""Commands sent to the thermostat that are still waiting for confirmation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import CALLBACK_TYPE, callback

SYNC_SYNCED = "synced"
# Accepted by the Netatmo cloud, not yet reported back.
SYNC_ACCEPTED = "accepted"
# Queued, in flight or refused.
SYNC_PENDING = "pending"


class SyncState:
    """Shared between the climate entity and the "synced" binary sensor.

    Each key is a kind of command (temperature, hvac, preset) with the value
    the thermostat is expected to report. `pending` holds commands not yet
    accepted; `accepted` holds Netatmo commands the cloud accepted but has not
    reported back yet. A key disappears once the source entity reports that
    value or the command is superseded.
    """

    def __init__(self) -> None:
        """Start with nothing pending."""
        self.pending: dict[str, Any] = {}
        self.accepted: dict[str, Any] = {}
        self.available = False
        self._listeners: list[Callable[[], None]] = []

    @property
    def synced(self) -> bool:
        """True when every command has been confirmed."""
        return not self.pending and not self.accepted

    @property
    def state(self) -> str:
        """synced, accepted or pending."""
        if self.pending:
            return SYNC_PENDING
        if self.accepted:
            return SYNC_ACCEPTED
        return SYNC_SYNCED

    @property
    def waiting(self) -> list[str]:
        """Kinds of command not yet confirmed."""
        return sorted({*self.pending, *self.accepted})

    def forget(self, key: str) -> None:
        """Drop a command that was confirmed or superseded."""
        self.pending.pop(key, None)
        self.accepted.pop(key, None)

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
