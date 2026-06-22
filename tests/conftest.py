"""Shared fixtures for HA Entity Cleaner tests."""
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_entity_cleaner.const import DOMAIN


@pytest.fixture
def config_entry():
    return MockConfigEntry(domain=DOMAIN, title="HA Entity Cleaner", data={}, options={})
