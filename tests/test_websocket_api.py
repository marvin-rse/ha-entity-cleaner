"""Tests for the WebSocket API — delete guards and response shape."""
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_entity_cleaner.const import DOMAIN
from custom_components.ha_entity_cleaner.websocket_api import async_register_websocket_api


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _entry_in_hass(hass, options=None):
    """Add a minimal config entry so WS handlers can read options."""
    entry = MockConfigEntry(
        domain=DOMAIN, title="HA Entity Cleaner", data={}, options=options or {}
    )
    entry.add_to_hass(hass)
    return entry


def _fake_buckets(*orphan_items):
    return {
        "orphan": list(orphan_items),
        "offline": [],
        "disabled": [],
        "ghost": [],
    }


def _orphan(entity_id, *, safe=True, referenced=False, used_in=None):
    return {
        "entity_id": entity_id,
        "domain": entity_id.split(".")[0],
        "reason": "config entry removed",
        "safe": safe,
        "last_changed": None,
        "referenced": referenced,
        "used_in": used_in or [],
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_ws_list_returns_buckets_and_score(hass, hass_ws_client):
    """ws_list returns buckets dict and a summary with a score."""
    _entry_in_hass(hass)
    async_register_websocket_api(hass)

    fake = _fake_buckets(_orphan("sensor.x"))

    with patch(
        "custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify",
        return_value=fake,
    ):
        client = await hass_ws_client(hass)
        await client.send_json({"id": 1, "type": "ha_entity_cleaner/list"})
        msg = await client.receive_json()

    assert msg["success"], msg
    assert "buckets" in msg["result"]
    assert "summary" in msg["result"]
    assert "score" in msg["result"]["summary"]


async def test_ws_delete_dry_run_returns_matched(hass, hass_ws_client):
    """dry_run=true returns matched list without touching the registry."""
    _entry_in_hass(hass)
    async_register_websocket_api(hass)

    entity_id = "sensor.orphaned"
    fake = _fake_buckets(_orphan(entity_id))

    with patch(
        "custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify",
        return_value=fake,
    ):
        client = await hass_ws_client(hass)
        await client.send_json({
            "id": 2,
            "type": "ha_entity_cleaner/delete",
            "entity_ids": [entity_id],
            "dry_run": True,
            "skip_referenced": True,
        })
        msg = await client.receive_json()

    assert msg["success"], msg
    r = msg["result"]
    assert r["dry_run"] is True
    assert entity_id in r["deleted"]
    assert r["deleted_count"] == 1


async def test_ws_delete_skips_referenced(hass, hass_ws_client):
    """skip_referenced=true keeps entities still found in config."""
    _entry_in_hass(hass)
    async_register_websocket_api(hass)

    entity_id = "sensor.ref_entity"
    fake = _fake_buckets(_orphan(entity_id, referenced=True, used_in=["automations.yaml:10"]))

    with patch(
        "custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify",
        return_value=fake,
    ):
        client = await hass_ws_client(hass)
        await client.send_json({
            "id": 3,
            "type": "ha_entity_cleaner/delete",
            "entity_ids": [entity_id],
            "dry_run": True,
            "skip_referenced": True,
        })
        msg = await client.receive_json()

    assert msg["success"], msg
    r = msg["result"]
    assert entity_id not in r["deleted"]
    assert entity_id in r["skipped_referenced"]


async def test_ws_delete_refuses_non_orphans(hass, hass_ws_client):
    """Offline / disabled / ghost entities cannot be deleted, period."""
    _entry_in_hass(hass)
    async_register_websocket_api(hass)

    entity_id = "light.offline_device"
    fake = {
        "orphan": [],
        "offline": [_orphan(entity_id) | {"reason": "offline · wled", "safe": False}],
        "disabled": [],
        "ghost": [],
    }

    with patch(
        "custom_components.ha_entity_cleaner.websocket_api.async_scan_and_classify",
        return_value=fake,
    ):
        client = await hass_ws_client(hass)
        await client.send_json({
            "id": 4,
            "type": "ha_entity_cleaner/delete",
            "entity_ids": [entity_id],
            "dry_run": True,
            "skip_referenced": True,
        })
        msg = await client.receive_json()

    assert msg["success"], msg
    r = msg["result"]
    assert entity_id not in r["deleted"]
    assert entity_id in r["skipped_not_orphan"]
