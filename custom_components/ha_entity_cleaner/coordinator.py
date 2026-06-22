"""Scanning, classification and reference-scan logic for HA Entity Cleaner.

Core safety rule
----------------
An entity is only ever an "orphan" if the integration that created it is GONE.
As long as its config entry still exists (even if the device is unplugged and
the integration is in setup-retry), the entity is classified as "offline" and
is NEVER deletable.  This prevents real-but-temporarily-offline devices from
being removed.

Reference scan (Watchman-inspired)
-----------------------------------
Before any entity is presented as deletable, we run a heuristic line-based
scan of the YAML config tree and the .storage Lovelace JSON blobs.  Each
entity_id that appears somewhere is flagged as `referenced: True` with a
`used_in` list.  This is ADVISORY only — false positives and negatives are
possible — so it never auto-selects or auto-expands the delete set.
"""
from __future__ import annotations

import fnmatch
import logging
import os
import re
from datetime import timedelta
from pathlib import Path

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    ATTR_RESTORED,
    BUCKET_DISABLED,
    BUCKET_GHOST,
    BUCKET_OFFLINE,
    BUCKET_ORPHAN,
    CONF_IGNORE_ENTITY_IDS,
    CONF_IGNORE_FILES,
    CONF_IGNORE_LABELS,
    DOMAIN,
    UNAVAILABLE_STATES,
)

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(minutes=15)

# Folders / filenames to skip in the reference scan.
_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".storage"}
_STORAGE_LOVELACE_RE = re.compile(r"lovelace", re.IGNORECASE)

# Regex that matches a bare entity_id (domain.object_id) in a line.
_ENTITY_RE = re.compile(r"\b([a-z_][a-z0-9_]*\.[a-z0-9_]+)\b")


# ---------------------------------------------------------------------------
# Reference scan
# ---------------------------------------------------------------------------

def _scan_references(hass: HomeAssistant, ignore_files: list[str]) -> dict[str, list[str]]:
    """Return a dict mapping entity_id -> list of "file:line" locations.

    Scans:
    - hass.config.config_dir (YAML tree, excluding .git/__pycache__)
    - .storage/ Lovelace blobs (lovelace.* files)

    Heuristic / line-based — may produce false positives.
    """
    config_dir = Path(hass.config.config_dir)
    storage_dir = config_dir / ".storage"
    index: dict[str, list[str]] = {}

    def _should_skip_file(path: Path) -> bool:
        rel = str(path.relative_to(config_dir))
        return any(fnmatch.fnmatch(rel, pat) for pat in ignore_files)

    def _scan_file(path: Path) -> None:
        if _should_skip_file(path):
            return
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        for lineno, line in enumerate(text.splitlines(), 1):
            for match in _ENTITY_RE.finditer(line):
                eid = match.group(1)
                loc = f"{path.relative_to(config_dir)}:{lineno}"
                index.setdefault(eid, []).append(loc)

    # Walk YAML config tree.
    for root, dirs, files in os.walk(config_dir):
        root_path = Path(root)
        # Prune hidden / well-known non-config dirs.
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
        for fname in files:
            if fname.endswith((".yaml", ".yml")):
                _scan_file(root_path / fname)

    # Walk .storage for Lovelace blobs.
    if storage_dir.is_dir():
        for fname in os.listdir(storage_dir):
            if _STORAGE_LOVELACE_RE.search(fname):
                _scan_file(storage_dir / fname)

    return index


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def _item(
    entity_id: str,
    domain: str,
    reason: str,
    safe: bool,
    last_changed: str | None,
    referenced: bool = False,
    used_in: list[str] | None = None,
) -> dict:
    return {
        "entity_id": entity_id,
        "domain": domain,
        "reason": reason,
        "safe": safe,
        "last_changed": last_changed,
        "referenced": referenced,
        "used_in": used_in or [],
    }


def _matches_ignore_entity(entity_id: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(entity_id, pat) for pat in patterns)


def _has_ignore_label(entry: er.RegistryEntry, ignore_labels: list[str]) -> bool:
    labels = getattr(entry, "labels", set()) or set()
    return bool(labels & set(ignore_labels))


@callback
def classify(
    hass: HomeAssistant,
    options: dict | None = None,
) -> dict[str, list[dict]]:
    """Sort entities into orphan / offline / disabled / ghost buckets.

    Each item carries a human reason, a `safe` flag (True only when deletion is
    high-confidence), the entity's last_changed timestamp, and reference-scan
    results (referenced flag + used_in locations).
    """
    options = options or {}
    ignore_entity_ids: list[str] = options.get(CONF_IGNORE_ENTITY_IDS, [])
    ignore_labels: list[str] = options.get(CONF_IGNORE_LABELS, [])
    ignore_files: list[str] = options.get(CONF_IGNORE_FILES, [])

    # Reference scan runs first so we can annotate every item.
    try:
        ref_index = _scan_references(hass, ignore_files)
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Reference scan failed; skipping usage checks", exc_info=True)
        ref_index = {}

    registry = er.async_get(hass)
    entries = {e.entry_id: e for e in hass.config_entries.async_entries()}
    loaded = set(hass.config.components)

    buckets: dict[str, list[dict]] = {
        BUCKET_ORPHAN: [],
        BUCKET_OFFLINE: [],
        BUCKET_DISABLED: [],
        BUCKET_GHOST: [],
    }
    registered: set[str] = set()

    for entity_id, entry in registry.entities.items():
        registered.add(entity_id)
        domain = entity_id.split(".")[0]
        state = hass.states.get(entity_id)
        last_changed = state.last_changed.isoformat() if state else None

        # Ignore rules.
        if _matches_ignore_entity(entity_id, ignore_entity_ids):
            continue
        if _has_ignore_label(entry, ignore_labels):
            continue

        # Reference annotation.
        locs = ref_index.get(entity_id, [])
        ref = bool(locs)

        if entry.disabled_by is not None:
            buckets[BUCKET_DISABLED].append(
                _item(entity_id, domain, "disabled", False, last_changed, ref, locs)
            )
            continue

        restored = bool(state and state.attributes.get(ATTR_RESTORED))
        unavailable = state is None or state.state in UNAVAILABLE_STATES
        ce_id = entry.config_entry_id

        if ce_id:
            if ce_id not in entries:
                # Config entry removed → integration instance is gone.
                buckets[BUCKET_ORPHAN].append(
                    _item(entity_id, domain, "config entry removed", True, last_changed, ref, locs)
                )
            elif restored or unavailable:
                # Config entry still present → real device, just offline. KEEP.
                dom = entries[ce_id].domain
                buckets[BUCKET_OFFLINE].append(
                    _item(
                        entity_id,
                        domain,
                        f"offline · integration '{dom}'",
                        False,
                        last_changed,
                        ref,
                        locs,
                    )
                )
            # else: live and healthy → ignore
        else:
            integ = entry.platform
            if integ and integ not in loaded:
                buckets[BUCKET_ORPHAN].append(
                    _item(
                        entity_id,
                        domain,
                        f"integration '{integ}' not loaded",
                        True,
                        last_changed,
                        ref,
                        locs,
                    )
                )
            elif restored or state is None:
                buckets[BUCKET_ORPHAN].append(
                    _item(
                        entity_id,
                        domain,
                        "no config entry · review before deleting",
                        False,
                        last_changed,
                        ref,
                        locs,
                    )
                )
            elif unavailable:
                buckets[BUCKET_OFFLINE].append(
                    _item(
                        entity_id,
                        domain,
                        "offline (no config entry)",
                        False,
                        last_changed,
                        ref,
                        locs,
                    )
                )

    # Ghosts: state machine entry without a registry entry.
    for state in hass.states.async_all():
        eid = state.entity_id
        if eid not in registered and state.state in UNAVAILABLE_STATES:
            locs = ref_index.get(eid, [])
            buckets[BUCKET_GHOST].append(
                _item(
                    eid,
                    eid.split(".")[0],
                    "no registry entry",
                    False,
                    state.last_changed.isoformat(),
                    bool(locs),
                    locs,
                )
            )

    return buckets


def compute_score(buckets: dict[str, list[dict]]) -> int:
    """Return a 0–100 cleanliness score (100 = perfectly clean)."""
    safe = len([i for i in buckets.get(BUCKET_ORPHAN, []) if i["safe"]])
    uncertain = len([i for i in buckets.get(BUCKET_ORPHAN, []) if not i["safe"]])
    ghost = len(buckets.get(BUCKET_GHOST, []))
    penalty = min(100, safe * 2 + uncertain * 1 + ghost * 1)
    return max(0, 100 - penalty)


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------

class EntityCleanerCoordinator(DataUpdateCoordinator[dict[str, list[dict]]]):
    """Periodically refresh entity buckets."""

    def __init__(self, hass: HomeAssistant, options: dict) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.options = options

    async def _async_update_data(self) -> dict[str, list[dict]]:
        return await self.hass.async_add_executor_job(
            classify, self.hass, self.options
        )
