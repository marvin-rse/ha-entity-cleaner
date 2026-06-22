"""Shared fixtures for HA Entity Cleaner tests."""
import sys
from unittest.mock import MagicMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_entity_cleaner.const import DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Enable loading of custom integrations in all tests."""
    yield


@pytest.fixture(autouse=True)
def mock_hass_frontend():
    """Mock hass_frontend so the frontend HA dependency can load in tests.

    pytest-homeassistant-custom-component does not install hass-frontend;
    patching sys.modules avoids the ImportError at dependency-load time.
    """
    mock_mod = MagicMock()
    mock_mod.where = lambda: "/mock/hass_frontend"
    sys.modules.setdefault("hass_frontend", mock_mod)
    with patch("homeassistant.components.frontend.async_setup", return_value=True), \
         patch("homeassistant.components.frontend.async_setup_entry", return_value=True):
        yield
    sys.modules.pop("hass_frontend", None)


@pytest.fixture
def config_entry():
    return MockConfigEntry(domain=DOMAIN, title="HA Entity Cleaner", data={}, options={})
