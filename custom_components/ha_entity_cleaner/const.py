"""Constants for HA Entity Cleaner."""

DOMAIN = "ha_entity_cleaner"

# States that mark an entity as not currently usable.
UNAVAILABLE_STATES = ("unavailable", "unknown")

# Attribute set by HA on registry entities whose integration is not running.
ATTR_RESTORED = "restored"

# Service names (kept alongside the WS API for automation use).
SERVICE_SCAN = "scan"
SERVICE_DELETE_ORPHANS = "delete_orphans"

# WebSocket command types.
WS_SCAN = f"{DOMAIN}/scan"
WS_LIST = f"{DOMAIN}/list"
WS_DELETE = f"{DOMAIN}/delete"

# Sensor attribute cap (HA state-size guard).
LIST_CAP = 100

# Config entry / options keys.
CONF_IGNORE_ENTITY_IDS = "ignore_entity_ids"
CONF_IGNORE_LABELS = "ignore_labels"
CONF_IGNORE_FILES = "ignore_files"

# Buckets.
BUCKET_ORPHAN = "orphan"
BUCKET_OFFLINE = "offline"
BUCKET_DISABLED = "disabled"
BUCKET_GHOST = "ghost"
