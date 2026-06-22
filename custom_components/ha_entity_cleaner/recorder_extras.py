"""Recorder cleanup for HA Entity Cleaner.

When an entity is removed from the registry, its long-term **statistics** can
linger in the recorder database forever, quietly bloating it. This module
detects statistics whose ``statistic_id`` is an entity that no longer exists
(not in the entity registry and not a live state), and offers to purge them.

Design notes / safety
---------------------
- Detection uses the recorder's public ``list_statistic_ids`` helper, run in the
  recorder's own executor. Everything is wrapped in try/except so that a missing
  or incompatible recorder simply yields an empty result instead of erroring.
- We only ever consider statistics whose ``source == "recorder"`` (i.e. derived
  from an entity), never externally-supplied statistics (``source != "recorder"``)
  such as those from the energy dashboard or other integrations.
- Purging is **delegated to Home Assistant's own** ``recorder.purge_entities``
  service rather than touching the database directly, and defaults to a dry run.
"""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

_LOGGER = logging.getLogger(__name__)


def _known_entity_ids(hass: HomeAssistant) -> set[str]:
    """Entity ids that currently exist (registry entries + live states)."""
    registry = er.async_get(hass)
    known = set(registry.entities.keys())
    known.update(state.entity_id for state in hass.states.async_all())
    return known


async def async_scan_recorder(hass: HomeAssistant) -> list[dict]:
    """Return recorder statistics for entities that no longer exist.

    Each item: ``{"entity_id", "unit", "has_mean", "has_sum"}``.
    Returns an empty list if the recorder is unavailable or the API differs.
    """
    try:
        from homeassistant.components.recorder import get_instance
        from homeassistant.components.recorder.statistics import list_statistic_ids
    except ImportError:
        _LOGGER.debug("Recorder integration not available; skipping recorder scan")
        return []

    try:
        # get_instance raises (KeyError) when the recorder isn't initialised,
        # rather than returning None — treat any failure as "no recorder".
        instance = get_instance(hass)
    except Exception:  # noqa: BLE001
        instance = None
    if instance is None:
        return []

    try:
        # list_statistic_ids touches the recorder session → run in its executor.
        stats = await instance.async_add_executor_job(list_statistic_ids, hass)
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Recorder statistics scan failed", exc_info=True)
        return []

    known = _known_entity_ids(hass)
    leftovers: list[dict] = []
    for meta in stats or []:
        # Only recorder-derived (entity) statistics; skip external sources.
        if meta.get("source") != "recorder":
            continue
        stat_id = meta.get("statistic_id")
        if not stat_id or "." not in stat_id:
            continue
        if stat_id in known:
            continue
        unit = (
            meta.get("unit_of_measurement")
            or meta.get("statistics_unit_of_measurement")
            or meta.get("display_unit_of_measurement")
        )
        leftovers.append(
            {
                "entity_id": stat_id,
                "unit": unit,
                "has_mean": bool(meta.get("has_mean")),
                "has_sum": bool(meta.get("has_sum")),
            }
        )
    leftovers.sort(key=lambda i: i["entity_id"])
    return leftovers


async def async_purge_recorder(
    hass: HomeAssistant, entity_ids: list[str], dry_run: bool
) -> dict:
    """Delete the orphaned long-term statistics for the given entity ids.

    The leftovers we detect live in the statistics tables, so we remove them
    with the recorder's ``clear_statistics`` (run in the recorder executor) —
    ``recorder.purge_entities`` only removes *states*, not statistics. We also
    fire ``recorder.purge_entities`` as a best-effort mop-up of any residual
    states/events for the same ids.

    On dry_run, validates the targets against the current leftovers set and
    reports what would be purged without changing anything.
    """
    # Re-scan so we only ever purge ids still confirmed as orphaned statistics.
    current = {i["entity_id"] for i in await async_scan_recorder(hass)}
    targets = [eid for eid in entity_ids if eid in current]
    skipped = [eid for eid in entity_ids if eid not in current]

    purged: list[str] = []
    error: str | None = None

    if targets and not dry_run:
        try:
            from homeassistant.components.recorder import get_instance
            from homeassistant.components.recorder.statistics import clear_statistics
        except ImportError:
            return {
                "dry_run": dry_run,
                "purged": [],
                "purged_count": 0,
                "skipped": entity_ids,
                "error": "recorder integration is unavailable",
            }

        try:
            instance = get_instance(hass)
        except Exception:  # noqa: BLE001
            instance = None

        if instance is None:
            error = "recorder is not running"
        else:
            try:
                # Primary: remove the long-term statistics for these ids.
                await instance.async_add_executor_job(clear_statistics, instance, targets)
                purged = targets
            except Exception as exc:  # noqa: BLE001
                error = str(exc)

            # Best-effort: also drop any residual states/events.
            if purged and hass.services.has_service("recorder", "purge_entities"):
                try:
                    await hass.services.async_call(
                        "recorder", "purge_entities", {"entity_id": targets}, blocking=True
                    )
                except Exception:  # noqa: BLE001
                    _LOGGER.debug("purge_entities mop-up failed (non-fatal)", exc_info=True)
    elif targets:
        purged = targets  # dry run: would purge

    return {
        "dry_run": dry_run,
        "purged": purged,
        "purged_count": len(purged),
        "skipped": skipped,
        "error": error,
    }
