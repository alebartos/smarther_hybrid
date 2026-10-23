"""Config flow for Smarther Hybrid."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    TextSelector,
)

from .const import (
    CONF_HOLD_REFRESH_HOURS,
    CONF_HOMEKIT_ENTITY,
    CONF_HUMIDITY_ENTITY,
    CONF_NETATMO_ENTITY,
    DEFAULT_HOLD_REFRESH_HOURS,
    DEFAULT_NAME,
    DOMAIN,
)


class SmartherHybridConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Smarther Hybrid."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow."""
        return SmartherHybridOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick the HomeKit and Netatmo entities to combine."""
        errors: dict[str, str] = {}

        if user_input is not None:
            if user_input[CONF_HOMEKIT_ENTITY] == user_input[CONF_NETATMO_ENTITY]:
                errors["base"] = "same_entity"
            else:
                await self.async_set_unique_id(user_input[CONF_HOMEKIT_ENTITY])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input[CONF_NAME], data=user_input
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=DEFAULT_NAME): TextSelector(),
                vol.Required(CONF_HOMEKIT_ENTITY): EntitySelector(
                    EntitySelectorConfig(
                        domain="climate", integration="homekit_controller"
                    )
                ),
                vol.Required(CONF_NETATMO_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="climate", integration="netatmo")
                ),
                vol.Optional(CONF_HUMIDITY_ENTITY): EntitySelector(
                    EntitySelectorConfig(domain="sensor", device_class="humidity")
                ),
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(schema, user_input),
            errors=errors,
        )


class SmartherHybridOptionsFlow(OptionsFlow):
    """Options for Smarther Hybrid."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Set how often the held setpoint is re-sent (0 disables it)."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_HOLD_REFRESH_HOURS,
                    default=self.config_entry.options.get(
                        CONF_HOLD_REFRESH_HOURS, DEFAULT_HOLD_REFRESH_HOURS
                    ),
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=0,
                        max=11,
                        step=0.5,
                        unit_of_measurement="h",
                        mode=NumberSelectorMode.BOX,
                    )
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
