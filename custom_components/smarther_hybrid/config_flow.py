"""Config flow for Smarther Hybrid."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_NAME
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    TextSelector,
)

from .const import (
    CONF_HOMEKIT_ENTITY,
    CONF_HUMIDITY_ENTITY,
    CONF_NETATMO_ENTITY,
    DEFAULT_NAME,
    DOMAIN,
)


class SmartherHybridConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Smarther Hybrid."""

    VERSION = 1

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
