"""Tests for the classification logic."""
from unittest.mock import MagicMock, patch

import pytest

from custom_components.ha_entity_cleaner.coordinator import classify, compute_score, _scan_references


def _make_entry(entity_id, config_entry_id=None, platform=None, disabled_by=None):
    entry = MagicMock()
    entry.entity_id = entity_id
    entry.config_entry_id = config_entry_id
    entry.platform = platform
    entry.disabled_by = disabled_by
    entry.labels = set()
    return entry


def _make_state(entity_id, state="on", last_changed=None, attributes=None):
    from datetime import datetime, timezone
    s = MagicMock()
    s.entity_id = entity_id
    s.state = state
    s.last_changed = last_changed or datetime(2024, 1, 1, tzinfo=timezone.utc)
    s.attributes = attributes or {}
    return s


def _make_config_entry(entry_id, domain="test_integration"):
    ce = MagicMock()
    ce.entry_id = entry_id
    ce.domain = domain
    return ce


@pytest.fixture
def mock_hass():
    hass = MagicMock()
    hass.config.components = set()
    hass.config.config_dir = "/tmp/ha_test"
    return hass


class TestClassifyOfflineDevice:
    """The critical safety case: offline (config-entry-backed) devices are NEVER orphans."""

    def test_device_with_live_config_entry_unavailable_is_offline_not_orphan(self, mock_hass):
        entry_id = "abc123"
        entity_id = "light.wled_strip"

        mock_hass.config_entries.async_entries.return_value = [_make_config_entry(entry_id, "wled")]
        mock_hass.states.get.return_value = _make_state(entity_id, state="unavailable")
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id=entry_id)}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, ref_index={})

        assert entity_id not in [i["entity_id"] for i in buckets["orphan"]], \
            "Offline config-entry-backed device must NEVER appear as orphan"
        assert any(i["entity_id"] == entity_id for i in buckets["offline"])

    def test_device_with_live_config_entry_unknown_is_offline(self, mock_hass):
        entry_id = "ce_xyz"
        entity_id = "sensor.plug_power"

        mock_hass.config_entries.async_entries.return_value = [_make_config_entry(entry_id)]
        mock_hass.states.get.return_value = _make_state(entity_id, state="unknown")
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id=entry_id)}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, ref_index={})

        assert entity_id not in [i["entity_id"] for i in buckets["orphan"]]
        assert any(i["entity_id"] == entity_id for i in buckets["offline"])

    def test_device_with_removed_config_entry_is_orphan_safe(self, mock_hass):
        """Config entry gone → safe orphan, regardless of state."""
        entity_id = "button.removed_device_identify"

        # No config entries in HA at all.
        mock_hass.config_entries.async_entries.return_value = []
        mock_hass.states.get.return_value = _make_state(entity_id, state="unavailable")
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id="gone_entry")}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, ref_index={})

        orphans = {i["entity_id"]: i for i in buckets["orphan"]}
        assert entity_id in orphans
        assert orphans[entity_id]["safe"] is True


class TestReferenceScanGuard:
    """Referenced entities are flagged and should not be pre-selected."""

    def test_referenced_entity_gets_flag(self, mock_hass):
        entity_id = "sensor.old_temp"

        mock_hass.config_entries.async_entries.return_value = []
        mock_hass.states.get.return_value = None
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id="missing")}

        ref_index = {entity_id: ["automations.yaml:42"]}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, ref_index=ref_index)

        item = next((i for i in buckets["orphan"] if i["entity_id"] == entity_id), None)
        assert item is not None
        assert item["referenced"] is True
        assert "automations.yaml:42" in item["used_in"]

    def test_unreferenced_entity_has_no_flag(self, mock_hass):
        entity_id = "sensor.truly_orphaned"

        mock_hass.config_entries.async_entries.return_value = []
        mock_hass.states.get.return_value = None
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id="missing")}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, ref_index={})

        item = next((i for i in buckets["orphan"] if i["entity_id"] == entity_id), None)
        assert item is not None
        assert item["referenced"] is False
        assert item["used_in"] == []


class TestIgnoreRules:
    def test_ignored_entity_id_wildcard(self, mock_hass):
        entity_id = "sensor.legacy_temp"

        mock_hass.config_entries.async_entries.return_value = []
        mock_hass.states.get.return_value = None
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id="missing")}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, options={"ignore_entity_ids": ["sensor.legacy_*"]}, ref_index={})

        all_ids = [i["entity_id"] for bucket in buckets.values() for i in bucket]
        assert entity_id not in all_ids


class TestDeleteGuards:
    def test_skip_referenced_guard(self, mock_hass):
        """Referenced entities must be skipped when skip_referenced=True."""
        from unittest.mock import AsyncMock
        # Just validate the classify flag is wired — WS layer tested separately.
        entity_id = "sensor.ref_entity"

        mock_hass.config_entries.async_entries.return_value = []
        mock_hass.states.get.return_value = None
        mock_hass.states.async_all.return_value = []

        reg = MagicMock()
        reg.entities = {entity_id: _make_entry(entity_id, config_entry_id="missing")}

        with patch("custom_components.ha_entity_cleaner.coordinator.er.async_get", return_value=reg):
            buckets = classify(mock_hass, ref_index={entity_id: ["configuration.yaml:10"]})

        item = next((i for i in buckets["orphan"] if i["entity_id"] == entity_id), None)
        assert item["referenced"] is True  # guard: caller must check this before deleting


class TestReferenceScan:
    def test_large_file_is_skipped(self, tmp_path):
        """Files over the size cap must not be read."""
        big = tmp_path / "big.yaml"
        big.write_bytes(b"x" * (6 * 1024 * 1024))  # 6 MB
        result = _scan_references(tmp_path, [])
        assert not result  # nothing indexed from oversized file

    def test_yaml_entity_ids_are_indexed(self, tmp_path):
        f = tmp_path / "automations.yaml"
        f.write_text("entity_id: sensor.living_room_temp\n", encoding="utf-8")
        result = _scan_references(tmp_path, [])
        assert "sensor.living_room_temp" in result
        assert any("automations.yaml:1" in loc for loc in result["sensor.living_room_temp"])

    def test_ignored_file_is_skipped(self, tmp_path):
        f = tmp_path / "legacy.yaml"
        f.write_text("entity_id: sensor.old\n", encoding="utf-8")
        result = _scan_references(tmp_path, ["legacy.yaml"])
        assert "sensor.old" not in result


class TestScoreComputation:
    def test_empty_is_perfect(self):
        buckets = {"orphan": [], "offline": [], "disabled": [], "ghost": []}
        assert compute_score(buckets) == 100

    def test_safe_orphans_reduce_score(self):
        orphans = [{"safe": True, "referenced": False}] * 10
        buckets = {"orphan": orphans, "offline": [], "disabled": [], "ghost": []}
        score = compute_score(buckets)
        assert 0 <= score < 100

    def test_score_clamps_to_zero(self):
        orphans = [{"safe": True, "referenced": False}] * 100
        buckets = {"orphan": orphans, "offline": [], "disabled": [], "ghost": []}
        assert compute_score(buckets) >= 0
