"""Tests for the config flow and options flow."""
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

from custom_components.ha_entity_cleaner.const import DOMAIN


async def test_config_flow_creates_entry(hass):
    """User step with submit creates a config entry."""
    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
        assert result["type"] == FlowResultType.FORM
        assert result["step_id"] == "user"

        result2 = await hass.config_entries.flow.async_configure(
            result["flow_id"], user_input={}
        )
    assert result2["type"] == FlowResultType.CREATE_ENTRY
    assert result2["title"] == "HA Entity Cleaner"


async def test_config_flow_single_instance(hass):
    """A second setup attempt is aborted."""
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN)
    entry.add_to_hass(hass)

    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
    assert result["type"] == FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_options_flow_saves_ignore_rules(hass):
    """Options flow parses comma-separated values into lists."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Entity Cleaner", data={}, options={})
    entry.add_to_hass(hass)

    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True):
        result = await hass.config_entries.options.async_init(entry.entry_id)
        assert result["type"] == FlowResultType.FORM

        result2 = await hass.config_entries.options.async_configure(
            result["flow_id"],
            user_input={
                "ignore_entity_ids": "sensor.old_*, light.removed",
                "ignore_labels": "ignore_cleaner",
                "ignore_files": "",
            },
        )

    assert result2["type"] == FlowResultType.CREATE_ENTRY
    assert result2["data"]["ignore_entity_ids"] == ["sensor.old_*", "light.removed"]
    assert result2["data"]["ignore_labels"] == ["ignore_cleaner"]
    assert result2["data"]["ignore_files"] == []
