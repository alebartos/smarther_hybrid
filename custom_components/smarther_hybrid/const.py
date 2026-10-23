"""Constants for Smarther Hybrid."""

DOMAIN = "smarther_hybrid"

CONF_HOMEKIT_ENTITY = "homekit_entity"
CONF_NETATMO_ENTITY = "netatmo_entity"
CONF_HUMIDITY_ENTITY = "humidity_entity"

DEFAULT_NAME = "Smarther Soggiorno"

# Preset values exposed by the Netatmo climate entity.
PRESET_SCHEDULE = "schedule"
PRESET_AWAY = "away"
PRESET_BOOST = "boost"
PRESET_FROST_GUARD = "frost_guard"
# Reported by Netatmo after a manual setpoint change; read-only here.
PRESET_MANUAL = "manual"
# Our own preset: keep the setpoint against the schedule (works locally).
PRESET_HOLD = "hold"

SETTABLE_PRESETS = [
    PRESET_SCHEDULE,
    PRESET_HOLD,
    PRESET_AWAY,
    PRESET_BOOST,
    PRESET_FROST_GUARD,
]

# Attribute name used by the Netatmo climate entity.
NETATMO_ATTR_SELECTED_SCHEDULE = "selected_schedule"

DEFAULT_MIN_TEMP = 5.0
DEFAULT_MAX_TEMP = 30.0
TEMP_STEP = 0.5

# Hold ("Riscaldamento" kept against the schedule).
CONF_HOLD_REFRESH_HOURS = "hold_refresh_hours"
DEFAULT_HOLD_REFRESH_HOURS = 3.0
# Wait for Netatmo (webhook) to report why the HomeKit setpoint changed.
HOLD_SETTLE_SECONDS = 60
# Never re-send the held setpoint more often than this.
HOLD_MIN_REAPPLY_SECONDS = 120
# Time for HomeKit to report the setpoint after turning the thermostat on.
TURN_ON_SETTLE_SECONDS = 3
# Setpoints at or below this are frost protection and are never held.
FROST_GUARD_TEMP = 7.0

ATTR_HOLD_ACTIVE = "hold_active"
ATTR_HOLD_TEMPERATURE = "hold_temperature"
