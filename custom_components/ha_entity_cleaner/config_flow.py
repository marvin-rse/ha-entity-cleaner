"""Config flow for HA Entity Cleaner — single instance + options for ignore rules."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_IGNORE_ENTITY_IDS,
    CONF_IGNORE_FILES,
    CONF_IGNORE_LABELS,
    DOMAIN,
)


class EntityCleanerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Single-instance setup — one click, no parameters required."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="HA Entity Cleaner", data={})

        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return EntityCleanerOptionsFlow(config_entry)


class EntityCleanerOptionsFlow(OptionsFlow):
    """Options flow for configuring ignore rules."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input=None):
        opts = self._config_entry.options
        if user_input is not None:
            # Convert comma-separated strings to lists.
            def split(val: str) -> list[str]:
                return [v.strip() for v in val.split(",") if v.strip()]

            return self.async_create_entry(
                title="",
                data={
                    CONF_IGNORE_ENTITY_IDS: split(user_input.get(CONF_IGNORE_ENTITY_IDS, "")),
                    CONF_IGNORE_LABELS: split(user_input.get(CONF_IGNORE_LABELS, "")),
                    CONF_IGNORE_FILES: split(user_input.get(CONF_IGNORE_FILES, "")),
                },
            )

        def join(key: str) -> str:
            return ", ".join(opts.get(key, []))

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_IGNORE_ENTITY_IDS,
                        default=join(CONF_IGNORE_ENTITY_IDS),
                    ): cv.string,
                    vol.Optional(
                        CONF_IGNORE_LABELS,
                        default=join(CONF_IGNORE_LABELS),
                    ): cv.string,
                    vol.Optional(
                        CONF_IGNORE_FILES,
                        default=join(CONF_IGNORE_FILES),
                    ): cv.string,
                }
            ),
            description_placeholders={
                "entity_ids_hint": "e.g. sensor.old_*, light.removed_device",
                "labels_hint": "e.g. ignore_cleaner",
                "files_hint": "e.g. integrations/legacy/*.yaml",
            },
        )
