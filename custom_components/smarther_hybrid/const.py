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

SETTABLE_PRESETS = [PRESET_SCHEDULE, PRESET_AWAY, PRESET_BOOST, PRESET_FROST_GUARD]

# Attribute name used by the Netatmo climate entity.
NETATMO_ATTR_SELECTED_SCHEDULE = "selected_schedule"

DEFAULT_MIN_TEMP = 5.0
DEFAULT_MAX_TEMP = 30.0
TEMP_STEP = 0.5
