"""Tests for recorder leftover-statistics detection and purge."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.ha_entity_cleaner import recorder_extras

MOD = "custom_components.ha_entity_cleaner.recorder_extras"


class _FakeInstance:
    async def async_add_executor_job(self, func, *args):
        return func(*args)


def _registry(entity_ids):
    reg = MagicMock()
    reg.entities = {eid: MagicMock() for eid in entity_ids}
    return reg


@pytest.fixture
def hass():
    h = MagicMock()
    h.states.async_all.return_value = []
    return h


async def test_scan_returns_only_unknown_recorder_statistics(hass):
    stats = [
        {"statistic_id": "sensor.gone", "source": "recorder", "unit_of_measurement": "W",
         "has_mean": True, "has_sum": False},
        {"statistic_id": "sensor.alive", "source": "recorder", "unit_of_measurement": "W"},
        {"statistic_id": "external:thing", "source": "external"},
    ]
    with patch("homeassistant.components.recorder.get_instance", return_value=_FakeInstance()), \
         patch("homeassistant.components.recorder.statistics.list_statistic_ids", return_value=stats), \
         patch(f"{MOD}.er.async_get", return_value=_registry({"sensor.alive"})):
        leftovers = await recorder_extras.async_scan_recorder(hass)

    assert [i["entity_id"] for i in leftovers] == ["sensor.gone"]
    assert leftovers[0]["unit"] == "W"


async def test_scan_degrades_gracefully_on_error(hass):
    with patch("homeassistant.components.recorder.get_instance", return_value=_FakeInstance()), \
         patch("homeassistant.components.recorder.statistics.list_statistic_ids",
               side_effect=RuntimeError("boom")), \
         patch(f"{MOD}.er.async_get", return_value=_registry(set())):
        leftovers = await recorder_extras.async_scan_recorder(hass)
    assert leftovers == []


async def test_purge_dry_run_does_not_call_service(hass):
    with patch(f"{MOD}.async_scan_recorder", AsyncMock(return_value=[{"entity_id": "sensor.gone"}])):
        result = await recorder_extras.async_purge_recorder(hass, ["sensor.gone"], dry_run=True)
    assert result["purged"] == ["sensor.gone"]
    hass.services.async_call.assert_not_called()


async def test_purge_real_run_clears_statistics_for_confirmed_targets(hass):
    hass.services.has_service.return_value = True
    hass.services.async_call = AsyncMock()

    instance = MagicMock()
    captured = {}

    async def _exec(fn, *args):
        captured["fn"] = fn
        captured["args"] = args
        return fn(*args)

    instance.async_add_executor_job = _exec

    fake_recorder = MagicMock()
    fake_recorder.get_instance.return_value = instance
    fake_stats = MagicMock()
    fake_stats.clear_statistics = MagicMock()

    with patch(f"{MOD}.async_scan_recorder", AsyncMock(return_value=[{"entity_id": "sensor.gone"}])), \
         patch.dict("sys.modules", {
             "homeassistant.components.recorder": fake_recorder,
             "homeassistant.components.recorder.statistics": fake_stats,
         }):
        result = await recorder_extras.async_purge_recorder(
            hass, ["sensor.gone", "sensor.not_leftover"], dry_run=False
        )

    assert result["purged"] == ["sensor.gone"]
    assert result["skipped"] == ["sensor.not_leftover"]
    # clear_statistics(instance, ["sensor.gone"]) was run in the recorder executor.
    assert captured["fn"] is fake_stats.clear_statistics
    assert captured["args"] == (instance, ["sensor.gone"])
    # best-effort purge_entities mop-up also fired.
    hass.services.async_call.assert_awaited_once()
