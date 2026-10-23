"""Tests for the Smarther Hybrid config and options flows."""

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.data_entry_flow import FlowResultType

from custom_components.smarther_hybrid.const import (
    CONF_HOLD_REFRESH_HOURS,
    CONF_HOMEKIT_ENTITY,
    CONF_NETATMO_ENTITY,
    DOMAIN,
)


async def test_user_flow(hass):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_NAME: "Smarther Soggiorno", CONF_HOMEKIT_ENTITY: "climate.hk", CONF_NETATMO_ENTITY: "climate.na"},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Smarther Soggiorno"


async def test_same_entity_rejected(hass):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_NAME: "X", CONF_HOMEKIT_ENTITY: "climate.hk", CONF_NETATMO_ENTITY: "climate.hk"},
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "same_entity"}


async def test_options_flow(hass):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_NAME: "S", CONF_HOMEKIT_ENTITY: "climate.hk", CONF_NETATMO_ENTITY: "climate.na"},
    )
    entry = result["result"]

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_HOLD_REFRESH_HOURS: 2.5}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options[CONF_HOLD_REFRESH_HOURS] == 2.5
