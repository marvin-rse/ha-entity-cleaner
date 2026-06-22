"""HA Entity Cleaner — find, review, and safely bulk-delete orphaned entities."""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SERVICE_DELETE_ORPHANS, SERVICE_SCAN
from .coordinator import EntityCleanerCoordinator, async_scan_and_classify
from .panel import async_register_panel, async_unregister_panel
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]

DELETE_SCHEMA = vol.Schema(
    {
        vol.Optional("domains"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("entity_ids"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("include_uncertain", default=False): cv.boolean,
        vol.Optional("include_offline", default=False): cv.boolean,
        vol.Optional("include_disabled", default=False): cv.boolean,
        vol.Optional("min_age_days", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("skip_referenced", default=True): cv.boolean,
        vol.Optional("dry_run", default=True): cv.boolean,
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HA Entity Cleaner from a config entry."""
    options = dict(entry.options)
    coordinator = EntityCleanerCoordinator(hass, options)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    await async_register_panel(hass)
    async_register_websocket_api(hass)
    _register_services(hass)

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            async_unregister_panel(hass)
            for service in (SERVICE_SCAN, SERVICE_DELETE_ORPHANS):
                if hass.services.has_service(DOMAIN, service):
                    hass.services.async_remove(DOMAIN, service)
    return unload_ok


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """React to options changes by reloading the entry."""
    await hass.config_entries.async_reload(entry.entry_id)


def _register_services(hass: HomeAssistant) -> None:
    """Register the scan and delete_orphans services (idempotent)."""

    async def handle_scan(call: ServiceCall) -> None:
        for coordinator in hass.data.get(DOMAIN, {}).values():
            if isinstance(coordinator, EntityCleanerCoordinator):
                await coordinator.async_request_refresh()

    async def handle_delete(call: ServiceCall) -> dict:
        options: dict = {}
        for entry in hass.config_entries.async_entries(DOMAIN):
            options = dict(entry.options)
            break

        buckets = await async_scan_and_classify(hass, options)

        domains = call.data.get("domains")
        explicit = call.data.get("entity_ids")
        include_uncertain = call.data.get("include_uncertain", False)
        include_offline = call.data.get("include_offline", False)
        include_disabled = call.data.get("include_disabled", False)
        min_age_days = call.data.get("min_age_days", 0)
        skip_referenced = call.data.get("skip_referenced", True)
        dry_run = call.data.get("dry_run", True)
        now = dt_util.utcnow()

        targets: list[str] = []
        skipped_recent: list[str] = []
        skipped_uncertain = 0
        skipped_referenced = 0

        candidate_buckets = [("orphan", buckets.get("orphan", []))]
        if include_offline:
            candidate_buckets.append(("offline", buckets.get("offline", [])))
        if include_disabled:
            candidate_buckets.append(("disabled", buckets.get("disabled", [])))

        for bucket_name, items in candidate_buckets:
            for item in items:
                entity_id = item["entity_id"]
                if explicit is not None and entity_id not in explicit:
                    continue
                if domains is not None and item["domain"] not in domains:
                    continue
                if bucket_name == "orphan":
                    if not item["safe"] and not include_uncertain:
                        skipped_uncertain += 1
                        continue
                    if skip_referenced and item["referenced"]:
                        skipped_referenced += 1
                        continue
                if min_age_days:
                    state = hass.states.get(entity_id)
                    if state and (now - state.last_changed).days < min_age_days:
                        skipped_recent.append(entity_id)
                        continue
                targets.append(entity_id)

        deleted: list[str] = []
        failed: list[dict] = []

        if not dry_run:
            registry = er.async_get(hass)
            for entity_id in targets:
                try:
                    registry.async_remove(entity_id)
                    deleted.append(entity_id)
                except Exception as exc:  # noqa: BLE001
                    failed.append({"entity_id": entity_id, "error": str(exc)})
            for coordinator in hass.data.get(DOMAIN, {}).values():
                if isinstance(coordinator, EntityCleanerCoordinator):
                    await coordinator.async_request_refresh()

        return {
            "dry_run": dry_run,
            "matched": targets,
            "matched_count": len(targets),
            "deleted": deleted,
            "deleted_count": len(deleted),
            "failed": failed,
            "skipped_recent": skipped_recent,
            "skipped_uncertain": skipped_uncertain,
            "skipped_referenced": skipped_referenced,
        }

    if not hass.services.has_service(DOMAIN, SERVICE_SCAN):
        hass.services.async_register(DOMAIN, SERVICE_SCAN, handle_scan)

    if not hass.services.has_service(DOMAIN, SERVICE_DELETE_ORPHANS):
        hass.services.async_register(
            DOMAIN,
            SERVICE_DELETE_ORPHANS,
            handle_delete,
            schema=DELETE_SCHEMA,
            supports_response=SupportsResponse.OPTIONAL,
        )
