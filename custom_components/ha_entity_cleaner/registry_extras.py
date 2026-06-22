"""Device- and area-registry cleanup for HA Entity Cleaner.

Beyond stray *entities*, Home Assistant accumulates two other kinds of
registry leftovers:

- **Orphaned devices** — device-registry entries that have zero entities. They
  linger after an integration is removed or a device is re-paired under a new id.
- **Empty areas** — areas with no devices and no entities assigned.

Both are detected here (read-only) and can be removed via the device/area
registries.  Detection is event-loop only — it touches HA's in-memory
registries, which are not thread-safe.
"""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

_LOGGER = logging.getLogger(__name__)


def _device_label(device: dr.DeviceEntry) -> str:
    """Human-friendly device name."""
    return (
        device.name_by_user
        or device.name
        or (f"{device.manufacturer} {device.model}".strip() if device.manufacturer or device.model else "")
        or "(unnamed device)"
    )


@callback
def scan_registry_extras(hass: HomeAssistant) -> dict[str, list[dict]]:
    """Return orphaned devices and empty areas.

    Must run on the event loop (registry access is not thread-safe).

    - ``devices``: device entries with no entities (disabled entities included,
      so a device kept only for a disabled entity is NOT reported).
    - ``areas``: areas with no devices and no entities assigned.
    """
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)
    area_reg = ar.async_get(hass)

    devices: list[dict] = []
    for device in dev_reg.devices.values():
        entities = er.async_entries_for_device(
            ent_reg, device.id, include_disabled_entities=True
        )
        if entities:
            continue
        devices.append(
            {
                "device_id": device.id,
                "name": _device_label(device),
                "manufacturer": device.manufacturer or "",
                "model": device.model or "",
                "area_id": device.area_id,
                # A device still claimed by a config entry may be re-created by
                # its integration after removal — surface that as a soft warning.
                "has_config_entry": bool(device.config_entries),
            }
        )

    areas: list[dict] = []
    for area in area_reg.areas.values():
        devices_in = dr.async_entries_for_area(dev_reg, area.id)
        entities_in = er.async_entries_for_area(ent_reg, area.id)
        if devices_in or entities_in:
            continue
        areas.append({"area_id": area.id, "name": area.name})

    return {"devices": devices, "areas": areas}


@callback
def remove_devices(hass: HomeAssistant, device_ids: list[str], dry_run: bool) -> dict:
    """Remove the given devices from the device registry (no-op on dry_run).

    Only devices that are currently orphaned (zero entities) are removed; any
    id that has gained an entity since the scan, or is unknown, is skipped.
    """
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)

    removed: list[str] = []
    skipped: list[str] = []
    failed: list[dict] = []

    for device_id in device_ids:
        device = dev_reg.async_get(device_id)
        if device is None:
            skipped.append(device_id)
            continue
        if er.async_entries_for_device(ent_reg, device_id, include_disabled_entities=True):
            # Gained an entity since the scan — no longer orphaned, keep it.
            skipped.append(device_id)
            continue
        if dry_run:
            removed.append(device_id)
            continue
        try:
            dev_reg.async_remove_device(device_id)
            removed.append(device_id)
        except Exception as exc:  # noqa: BLE001
            failed.append({"device_id": device_id, "error": str(exc)})

    return {
        "dry_run": dry_run,
        "removed": removed,
        "removed_count": len(removed),
        "skipped": skipped,
        "failed": failed,
    }


@callback
def remove_areas(hass: HomeAssistant, area_ids: list[str], dry_run: bool) -> dict:
    """Delete the given areas (no-op on dry_run).

    Only areas that are still empty (no devices, no entities) are deleted.
    """
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)
    area_reg = ar.async_get(hass)

    removed: list[str] = []
    skipped: list[str] = []
    failed: list[dict] = []

    for area_id in area_ids:
        if area_reg.async_get_area(area_id) is None:
            skipped.append(area_id)
            continue
        if dr.async_entries_for_area(dev_reg, area_id) or er.async_entries_for_area(
            ent_reg, area_id
        ):
            # No longer empty — keep it.
            skipped.append(area_id)
            continue
        if dry_run:
            removed.append(area_id)
            continue
        try:
            area_reg.async_delete(area_id)
            removed.append(area_id)
        except Exception as exc:  # noqa: BLE001
            failed.append({"area_id": area_id, "error": str(exc)})

    return {
        "dry_run": dry_run,
        "removed": removed,
        "removed_count": len(removed),
        "skipped": skipped,
        "failed": failed,
    }
