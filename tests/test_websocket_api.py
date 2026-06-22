"""Tests for the WebSocket API — delete guards and response shape."""
from unittest.mock import patch, MagicMock

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_entity_cleaner.const import DOMAIN


async def test_ws_list_returns_buckets_and_score(hass, hass_ws_client, config_entry):
    """ws_list returns buckets dict and a summary with a score."""
    config_entry.add_to_hass(hass)

    fake_buckets = {
        "orphan": [{"entity_id": "sensor.x", "domain": "sensor", "reason": "config entry removed",
                    "safe": True, "last_changed": None, "referenced": False, "used_in": []}],
        "offline": [], "disabled": [], "ghost": [],
    }

    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True), \
         patch("custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify", return_value=fake_buckets):
        await hass.config_entries.async_setup(config_entry.entry_id)
        client = await hass_ws_client(hass)
        await client.send_json({"id": 1, "type": "ha_entity_cleaner/list"})
        msg = await client.receive_json()

    assert msg["success"]
    assert "buckets" in msg["result"]
    assert "summary" in msg["result"]
    assert "score" in msg["result"]["summary"]


async def test_ws_delete_dry_run_returns_matched(hass, hass_ws_client, config_entry):
    """dry_run=true returns matched list without touching the registry."""
    config_entry.add_to_hass(hass)

    entity_id = "sensor.orphaned"
    fake_buckets = {
        "orphan": [{"entity_id": entity_id, "domain": "sensor", "reason": "config entry removed",
                    "safe": True, "last_changed": None, "referenced": False, "used_in": []}],
        "offline": [], "disabled": [], "ghost": [],
    }

    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True), \
         patch("custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify", return_value=fake_buckets):
        await hass.config_entries.async_setup(config_entry.entry_id)
        client = await hass_ws_client(hass)
        await client.send_json({
            "id": 2, "type": "ha_entity_cleaner/delete",
            "entity_ids": [entity_id],
            "dry_run": True,
            "skip_referenced": True,
        })
        msg = await client.receive_json()

    assert msg["success"]
    r = msg["result"]
    assert r["dry_run"] is True
    assert entity_id in r["deleted"]
    assert r["deleted_count"] == 1


async def test_ws_delete_skips_referenced(hass, hass_ws_client, config_entry):
    """skip_referenced=true keeps entities still found in config."""
    config_entry.add_to_hass(hass)

    entity_id = "sensor.ref_entity"
    fake_buckets = {
        "orphan": [{"entity_id": entity_id, "domain": "sensor", "reason": "config entry removed",
                    "safe": True, "last_changed": None, "referenced": True,
                    "used_in": ["automations.yaml:10"]}],
        "offline": [], "disabled": [], "ghost": [],
    }

    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True), \
         patch("custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify", return_value=fake_buckets):
        await hass.config_entries.async_setup(config_entry.entry_id)
        client = await hass_ws_client(hass)
        await client.send_json({
            "id": 3, "type": "ha_entity_cleaner/delete",
            "entity_ids": [entity_id],
            "dry_run": True,
            "skip_referenced": True,
        })
        msg = await client.receive_json()

    assert msg["success"]
    r = msg["result"]
    assert entity_id not in r["deleted"]
    assert entity_id in r["skipped_referenced"]


async def test_ws_delete_refuses_non_orphans(hass, hass_ws_client, config_entry):
    """Offline / disabled / ghost entities cannot be deleted, period."""
    config_entry.add_to_hass(hass)

    entity_id = "light.offline_device"
    fake_buckets = {
        "orphan": [],
        "offline": [{"entity_id": entity_id, "domain": "light", "reason": "offline · wled",
                     "safe": False, "last_changed": None, "referenced": False, "used_in": []}],
        "disabled": [], "ghost": [],
    }

    with patch("custom_components.ha_entity_cleaner.async_setup_entry", return_value=True), \
         patch("custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify", return_value=fake_buckets):
        await hass.config_entries.async_setup(config_entry.entry_id)
        client = await hass_ws_client(hass)
        await client.send_json({
            "id": 4, "type": "ha_entity_cleaner/delete",
            "entity_ids": [entity_id],
            "dry_run": True,
            "skip_referenced": True,
        })
        msg = await client.receive_json()

    assert msg["success"]
    r = msg["result"]
    assert entity_id not in r["deleted"]
    assert entity_id in r["skipped_not_orphan"]
