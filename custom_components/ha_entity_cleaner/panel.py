"""Register and unregister the HA Entity Cleaner sidebar panel."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

_PANEL_URL = "ha-entity-cleaner"
_STATIC_URL = f"/{DOMAIN}"
_JS_FILE = "ha-entity-cleaner.js"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the sidebar panel and its static JS asset."""
    www_path = Path(__file__).parent / "www"

    await hass.http.async_register_static_paths(
        [StaticPathConfig(_STATIC_URL, str(www_path), cache_headers=False)]
    )

    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Entity Cleaner",
        sidebar_icon="mdi:broom",
        frontend_url_path=_PANEL_URL,
        config={
            "_panel_custom": {
                "name": "ha-entity-cleaner-panel",
                "module_url": f"{_STATIC_URL}/{_JS_FILE}",
            }
        },
        require_admin=True,
    )
    _LOGGER.debug("Entity Cleaner panel registered at /%s", _PANEL_URL)


def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar panel entry."""
    try:
        from homeassistant.components.frontend import async_remove_panel  # noqa: PLC0415

        async_remove_panel(hass, _PANEL_URL)
        _LOGGER.debug("Entity Cleaner panel removed")
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Panel removal skipped (already gone or API changed)")
