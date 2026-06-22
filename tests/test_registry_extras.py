"""Tests for device- and area-registry cleanup logic."""
from unittest.mock import MagicMock, patch

import pytest

from custom_components.ha_entity_cleaner import registry_extras

MOD = "custom_components.ha_entity_cleaner.registry_extras"


def _device(device_id, name="Dev", config_entries=(), area_id=None):
    d = MagicMock()
    d.id = device_id
    d.name = name
    d.name_by_user = None
    d.manufacturer = "Acme"
    d.model = "X1"
    d.area_id = area_id
    d.config_entries = set(config_entries)
    return d


def _area(area_id, name):
    a = MagicMock()
    a.id = area_id
    a.name = name
    return a


@pytest.fixture
def hass():
    return MagicMock()


class TestScanRegistryExtras:
    def test_device_with_no_entities_is_orphaned(self, hass):
        dev = _device("dev1")
        dev_reg = MagicMock()
        dev_reg.devices = {"dev1": dev}
        area_reg = MagicMock()
        area_reg.areas = {}

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.ar.async_get", return_value=area_reg), \
             patch(f"{MOD}.er.async_entries_for_device", return_value=[]):
            result = registry_extras.scan_registry_extras(hass)

        assert [d["device_id"] for d in result["devices"]] == ["dev1"]

    def test_device_with_entities_is_kept(self, hass):
        dev = _device("dev1")
        dev_reg = MagicMock()
        dev_reg.devices = {"dev1": dev}
        area_reg = MagicMock()
        area_reg.areas = {}

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.ar.async_get", return_value=area_reg), \
             patch(f"{MOD}.er.async_entries_for_device", return_value=[MagicMock()]):
            result = registry_extras.scan_registry_extras(hass)

        assert result["devices"] == []

    def test_empty_area_is_reported_and_used_area_is_kept(self, hass):
        dev_reg = MagicMock()
        dev_reg.devices = {}
        area_reg = MagicMock()
        area_reg.areas = {"a_empty": _area("a_empty", "Spare"), "a_used": _area("a_used", "Kitchen")}

        def devices_for_area(_reg, area_id):
            return [MagicMock()] if area_id == "a_used" else []

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.ar.async_get", return_value=area_reg), \
             patch(f"{MOD}.dr.async_entries_for_area", side_effect=devices_for_area), \
             patch(f"{MOD}.er.async_entries_for_area", return_value=[]):
            result = registry_extras.scan_registry_extras(hass)

        ids = [a["area_id"] for a in result["areas"]]
        assert ids == ["a_empty"]


class TestRemoveDevices:
    def test_dry_run_does_not_remove(self, hass):
        dev = _device("dev1")
        dev_reg = MagicMock()
        dev_reg.async_get.return_value = dev

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.er.async_entries_for_device", return_value=[]):
            result = registry_extras.remove_devices(hass, ["dev1"], dry_run=True)

        assert result["removed"] == ["dev1"]
        dev_reg.async_remove_device.assert_not_called()

    def test_real_run_removes_orphaned_device(self, hass):
        dev = _device("dev1")
        dev_reg = MagicMock()
        dev_reg.async_get.return_value = dev

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.er.async_entries_for_device", return_value=[]):
            result = registry_extras.remove_devices(hass, ["dev1"], dry_run=False)

        assert result["removed"] == ["dev1"]
        dev_reg.async_remove_device.assert_called_once_with("dev1")

    def test_device_that_regained_entity_is_skipped(self, hass):
        dev = _device("dev1")
        dev_reg = MagicMock()
        dev_reg.async_get.return_value = dev

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.er.async_entries_for_device", return_value=[MagicMock()]):
            result = registry_extras.remove_devices(hass, ["dev1"], dry_run=False)

        assert result["removed"] == []
        assert result["skipped"] == ["dev1"]
        dev_reg.async_remove_device.assert_not_called()


class TestRemoveAreas:
    def test_real_run_deletes_empty_area(self, hass):
        area_reg = MagicMock()
        area_reg.async_get_area.return_value = _area("a1", "Spare")
        dev_reg = MagicMock()

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.ar.async_get", return_value=area_reg), \
             patch(f"{MOD}.dr.async_entries_for_area", return_value=[]), \
             patch(f"{MOD}.er.async_entries_for_area", return_value=[]):
            result = registry_extras.remove_areas(hass, ["a1"], dry_run=False)

        assert result["removed"] == ["a1"]
        area_reg.async_delete.assert_called_once_with("a1")

    def test_non_empty_area_is_skipped(self, hass):
        area_reg = MagicMock()
        area_reg.async_get_area.return_value = _area("a1", "Kitchen")
        dev_reg = MagicMock()

        with patch(f"{MOD}.dr.async_get", return_value=dev_reg), \
             patch(f"{MOD}.er.async_get", return_value=MagicMock()), \
             patch(f"{MOD}.ar.async_get", return_value=area_reg), \
             patch(f"{MOD}.dr.async_entries_for_area", return_value=[MagicMock()]), \
             patch(f"{MOD}.er.async_entries_for_area", return_value=[]):
            result = registry_extras.remove_areas(hass, ["a1"], dry_run=False)

        assert result["removed"] == []
        assert result["skipped"] == ["a1"]
        area_reg.async_delete.assert_not_called()
