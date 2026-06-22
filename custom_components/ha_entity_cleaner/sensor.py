"""Sensor exposing entity-cleaner counts and cleanliness score."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import BUCKET_ORPHAN, DOMAIN, LIST_CAP
from .coordinator import EntityCleanerCoordinator, compute_score


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: EntityCleanerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([EntityCleanerSensor(coordinator, entry)])


def _per_domain(items: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for item in items:
        out[item["domain"]] = out.get(item["domain"], 0) + 1
    return dict(sorted(out.items(), key=lambda kv: kv[1], reverse=True))


class EntityCleanerSensor(CoordinatorEntity[EntityCleanerCoordinator], SensorEntity):
    """State = number of orphaned entities; attributes hold the full breakdown."""

    _attr_name = "HA Entity Cleaner"
    _attr_icon = "mdi:broom"
    _attr_native_unit_of_measurement = "entities"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self, coordinator: EntityCleanerCoordinator, entry: ConfigEntry
    ) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_orphan_count"

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.get(BUCKET_ORPHAN, []))

    @property
    def extra_state_attributes(self) -> dict:
        data = self.coordinator.data
        orphans = data.get(BUCKET_ORPHAN, [])
        safe = [i for i in orphans if i["safe"]]
        referenced = [i for i in orphans if i["referenced"]]
        return {
            "cleanliness_score": compute_score(data),
            "orphan_count": len(orphans),
            "orphan_safe_count": len(safe),
            "orphan_uncertain_count": len(orphans) - len(safe),
            "orphan_referenced_count": len(referenced),
            "offline_count": len(data.get("offline", [])),
            "disabled_count": len(data.get("disabled", [])),
            "ghost_count": len(data.get("ghost", [])),
            "orphan_per_domain": _per_domain(orphans),
            "orphan_safe_entities": [i["entity_id"] for i in safe][:LIST_CAP],
            "orphan_entities": [i["entity_id"] for i in orphans][:LIST_CAP],
        }
