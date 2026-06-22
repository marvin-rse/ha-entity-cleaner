"""WebSocket commands for HA Entity Cleaner — admin-only."""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import (
    BUCKET_DISABLED,
    BUCKET_GHOST,
    BUCKET_OFFLINE,
    BUCKET_ORPHAN,
    DOMAIN,
    WS_DELETE,
    WS_LIST,
    WS_SCAN,
)
from .coordinator import EntityCleanerCoordinator, classify, compute_score

_LOGGER = logging.getLogger(__name__)

# Buckets in which deletion is forbidden regardless of any flag.
_NEVER_DELETE = {BUCKET_OFFLINE, BUCKET_DISABLED, BUCKET_GHOST}


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register all WS command handlers."""
    websocket_api.async_register_command(hass, ws_scan)
    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_delete)


# ---------------------------------------------------------------------------
# ha_entity_cleaner/scan
# ---------------------------------------------------------------------------

@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): WS_SCAN})
@websocket_api.async_response
async def ws_scan(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Trigger an immediate refresh of the entity buckets."""
    for coordinator in hass.data.get(DOMAIN, {}).values():
        if isinstance(coordinator, EntityCleanerCoordinator):
            await coordinator.async_request_refresh()
    connection.send_result(msg["id"], {"status": "ok"})


# ---------------------------------------------------------------------------
# ha_entity_cleaner/list
# ---------------------------------------------------------------------------

@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): WS_LIST})
@websocket_api.async_response
async def ws_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return the current classification buckets plus a cleanliness score."""
    # Get options from the active config entry.
    options: dict = {}
    for entry in hass.config_entries.async_entries(DOMAIN):
        options = dict(entry.options)
        break

    buckets = await hass.async_add_executor_job(classify, hass, options)
    score = compute_score(buckets)

    summary = {
        "orphan_count": len(buckets[BUCKET_ORPHAN]),
        "orphan_safe_count": sum(1 for i in buckets[BUCKET_ORPHAN] if i["safe"]),
        "orphan_uncertain_count": sum(1 for i in buckets[BUCKET_ORPHAN] if not i["safe"]),
        "orphan_referenced_count": sum(1 for i in buckets[BUCKET_ORPHAN] if i["referenced"]),
        "offline_count": len(buckets[BUCKET_OFFLINE]),
        "disabled_count": len(buckets[BUCKET_DISABLED]),
        "ghost_count": len(buckets[BUCKET_GHOST]),
        "score": score,
    }

    connection.send_result(
        msg["id"],
        {"buckets": buckets, "summary": summary},
    )


# ---------------------------------------------------------------------------
# ha_entity_cleaner/delete
# ---------------------------------------------------------------------------

_DELETE_SCHEMA = {
    vol.Required("type"): WS_DELETE,
    vol.Required("entity_ids"): [str],
    vol.Optional("include_uncertain", default=False): bool,
    vol.Optional("min_age_days", default=0): vol.All(int, vol.Range(min=0)),
    vol.Optional("skip_referenced", default=True): bool,
    vol.Optional("dry_run", default=True): bool,
}


@websocket_api.require_admin
@websocket_api.websocket_command(_DELETE_SCHEMA)
@websocket_api.async_response
async def ws_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Delete orphan entities with full guard rails."""
    options: dict = {}
    for entry in hass.config_entries.async_entries(DOMAIN):
        options = dict(entry.options)
        break

    buckets = await hass.async_add_executor_job(classify, hass, options)

    # Build a lookup: entity_id → item (orphan bucket only).
    orphan_map: dict[str, dict] = {i["entity_id"]: i for i in buckets[BUCKET_ORPHAN]}

    requested: set[str] = set(msg["entity_ids"])
    include_uncertain: bool = msg["include_uncertain"]
    min_age_days: int = msg["min_age_days"]
    skip_referenced: bool = msg["skip_referenced"]
    dry_run: bool = msg["dry_run"]
    now = dt_util.utcnow()

    deleted: list[str] = []
    failed: list[dict] = []
    skipped_not_orphan: list[str] = []
    skipped_uncertain: list[str] = []
    skipped_referenced: list[str] = []
    skipped_recent: list[str] = []

    for entity_id in requested:
        # Must be in the orphan bucket — refuse everything else.
        item = orphan_map.get(entity_id)
        if item is None:
            skipped_not_orphan.append(entity_id)
            continue

        if not item["safe"] and not include_uncertain:
            skipped_uncertain.append(entity_id)
            continue

        if skip_referenced and item["referenced"]:
            skipped_referenced.append(entity_id)
            continue

        if min_age_days:
            state = hass.states.get(entity_id)
            if state and (now - state.last_changed).days < min_age_days:
                skipped_recent.append(entity_id)
                continue

        deleted.append(entity_id)

    if not dry_run and deleted:
        registry = er.async_get(hass)
        actually_deleted: list[str] = []
        for entity_id in deleted:
            try:
                registry.async_remove(entity_id)
                actually_deleted.append(entity_id)
            except Exception as exc:  # noqa: BLE001
                failed.append({"entity_id": entity_id, "error": str(exc)})
        deleted = actually_deleted

        # Refresh coordinator(s) after deletion.
        for coordinator in hass.data.get(DOMAIN, {}).values():
            if isinstance(coordinator, EntityCleanerCoordinator):
                await coordinator.async_request_refresh()

    connection.send_result(
        msg["id"],
        {
            "dry_run": dry_run,
            "deleted": deleted,
            "deleted_count": len(deleted),
            "failed": failed,
            "skipped_not_orphan": skipped_not_orphan,
            "skipped_uncertain": skipped_uncertain,
            "skipped_referenced": skipped_referenced,
            "skipped_recent": skipped_recent,
        },
    )
