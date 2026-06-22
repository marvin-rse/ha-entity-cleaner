# HA Entity Cleaner

> **Find, review, and safely bulk-delete orphaned ("zombie") entities in Home Assistant — with a built-in sidebar panel and config-usage checks.**

[![HACS][hacs-badge]][hacs-link]
[![hassfest][hassfest-badge]][hassfest-link]
[![GitHub release][release-badge]][release-link]
[![License: MIT][license-badge]](LICENSE)

---

## What is this?

Home Assistant accumulates "zombie" entities — registry leftovers from removed integrations, device migrations, or renamed devices. The native entities screen can't bulk-delete by category. **HA Entity Cleaner** gives you:

- A **sidebar panel** to browse, filter, and safely delete orphans in bulk
- A **cleanliness score** (0–100) for your instance
- A **config-usage check** (Watchman-inspired) that flags entities still referenced in YAML or Lovelace — so you never accidentally delete something that's still in an automation
- **Smart-delete guards**: dry-run by default, skip-referenced on by default, min-age filter, confirmation dialog with typed "DELETE" + backup acknowledgement
- An **automation service** (`ha_entity_cleaner.delete_orphans`) for scripted cleanup
- A **sensor** (`sensor.ha_entity_cleaner`) with counts and breakdowns for dashboards

---

## Panel screenshots

### Overview — cleanliness score + counters

```
┌─────────────────────────────────────────────────────────────────┐
│ 🧹 HA Entity Cleaner          Find, review, and safely remove…  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ◯ 74          Instance Cleanliness                      │   │
│  │  Fair          23 safe orphans ready to delete           │   │
│  │                · 5 uncertain · 2 still referenced        │   │
│  │                           [ Review & Clean → ]           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │   28     │  │    7     │  │   14     │  │    2     │        │
│  │ Orphans  │  │ Offline  │  │ Disabled │  │ Ghosts   │        │
│  │Deletable │  │Real,keep │  │Intentionl│  │Fix source│        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                                                                  │
│  ⚠ Take a backup before deleting. Deleted registry entries      │
│    cannot be recovered by this tool.                            │
└─────────────────────────────────────────────────────────────────┘
```

### Triage view — orphans grouped by domain

```
┌─────────────────────────────────────────────────────────────────┐
│ Orphans 28 │ Offline 7 │ Disabled 14 │ Ghosts 2                │
├─────────────────────────────────────────────────────────────────┤
│ Entities whose integration is gone or config entry was removed. │
│ Green = high confidence. Amber = review before deleting.        │
│                                                                  │
│ [Filter by entity_id or domain…] [✓ Safe only] [Select all]    │
│                                          7 selected             │
│                                                                  │
│  ▶ button                      Select all              22       │
│  ▼ sensor                      Select all               6       │
│  │ ☑ sensor.old_device_temp    config entry removed  74 days ago│
│  │ ☑ sensor.legacy_humidity    config entry removed  90 days ago│
│  │ ☐ sensor.ref_entity         config entry removed  ⚠ in config│
│                                                                  │
│  [ ⬇ Export JSON ]  [ 🗑 Delete selected (7) ]                  │
└─────────────────────────────────────────────────────────────────┘
```

### Delete confirmation dialog

```
┌─────────────────────────────────────────────┐
│  Confirm deletion                            │
│  7 entities will be permanently removed.    │
│                                              │
│  button: 4                                  │
│  sensor: 3                                  │
│                                              │
│  ☑ I have a current backup of my HA         │
│    instance.                                 │
│                                              │
│  Type DELETE to confirm                     │
│  ┌──────────────────────────────────┐       │
│  │ DELETE                           │       │
│  └──────────────────────────────────┘       │
│                                              │
│              [ Cancel ]  [ Delete now ]     │
└─────────────────────────────────────────────┘
```

---

## How entities are classified

The decisive signal is **whether the integration that created the entity still exists** — not whether the device is currently reachable.

| Bucket | Meaning | Deletable |
|--------|---------|-----------|
| **orphan · safe** | Config entry removed, or integration no longer loaded | Yes |
| **orphan · uncertain** | No config entry; source unclear — review before deleting | Only with `include_uncertain: true` |
| **offline** | Config entry still present but device is unreachable | **Never** — it will come back |
| **disabled** | Explicitly disabled in the registry | No |
| **ghost** | State machine entry with no registry entry (YAML / MQTT) | No — fix at source |

> **A WLED light that is unplugged is "offline", never an orphan.** Its config entry still exists, so HA Entity Cleaner will never touch it.

Each item also carries a `referenced` flag from the **config-usage scan**:

- If an entity_id appears in any YAML file or `.storage/lovelace*` blob, it is flagged as *in config*
- Referenced entities are **never pre-selected** and are skipped by default (`skip_referenced: true`)
- This scan is heuristic / line-based — false positives and negatives are possible. It is **advisory only** and never causes automatic deletions

---

## Installation

### Via HACS (recommended)

1. HACS → three-dot menu → **Custom repositories**
2. Add `https://github.com/marvin-rse/ha-entity-cleaner`, category **Integration**
3. Install **HA Entity Cleaner**, restart Home Assistant
4. Settings → Devices & Services → **Add Integration** → search "HA Entity Cleaner"

The sidebar panel appears automatically after setup (admin users only).

### Manual

Copy `custom_components/ha_entity_cleaner/` into your HA `custom_components/` folder and restart.

---

## Ignore rules

In the integration's **Configure** dialog you can set:

| Rule | Format | Effect |
|------|--------|--------|
| Ignore entity IDs | Comma-separated, wildcards OK: `sensor.old_*` | Entity excluded from all buckets |
| Ignore labels | Comma-separated label names: `ignore_cleaner` | Entities with this label excluded |
| Ignore files | Glob patterns: `integrations/legacy/*.yaml` | File skipped in reference scan |

---

## Sensor

`sensor.ha_entity_cleaner` — state = number of orphaned entities.

Attributes:

| Attribute | Description |
|-----------|-------------|
| `cleanliness_score` | 0–100 score |
| `orphan_count` | Total orphans |
| `orphan_safe_count` | High-confidence orphans |
| `orphan_uncertain_count` | Uncertain orphans |
| `orphan_referenced_count` | Orphans still in config |
| `offline_count` | Offline real devices |
| `disabled_count` | Disabled entities |
| `ghost_count` | Ghost entities |
| `orphan_per_domain` | `{"button": 22, "sensor": 6}` |
| `orphan_safe_entities` | List of safe entity IDs (capped at 100) |

---

## Services

### `ha_entity_cleaner.scan`
Re-scan and refresh counts immediately.

### `ha_entity_cleaner.delete_orphans`
Delete orphaned entities. **Defaults to a dry run.**

```yaml
# Preview what would be removed (nothing deleted):
action: ha_entity_cleaner.delete_orphans
data:
  dry_run: true
response_variable: result
```

```yaml
# Delete all safe orphans older than 30 days, in the button domain only:
action: ha_entity_cleaner.delete_orphans
data:
  dry_run: false
  domains:
    - button
  min_age_days: 30
  skip_referenced: true
response_variable: result
```

Response: `matched`, `matched_count`, `deleted`, `deleted_count`, `failed`, `skipped_recent`, `skipped_uncertain`, `skipped_referenced`.

---

## Dashboard card

```yaml
type: markdown
content: >
  {% set e = 'sensor.ha_entity_cleaner' %}
  ## 🧹 Score: {{ state_attr(e, 'cleanliness_score') }}/100

  **{{ state_attr(e, 'orphan_safe_count') }}** safe orphans ready to delete
  · **{{ state_attr(e, 'orphan_uncertain_count') }}** uncertain

  {% for dom, n in (state_attr(e, 'orphan_per_domain') or {}).items() %}
  - **{{ dom }}**: {{ n }}
  {% endfor %}
```

---

## Safety

- Default is always **dry run** — nothing is ever deleted without explicit confirmation
- **Offline config-entry-backed devices are never touched**, regardless of their state
- **Referenced entities are skipped** by default (`skip_referenced: true`)
- The panel requires confirmation: typed "DELETE" + "I have a backup" checkbox
- Admin-only: the panel and all WebSocket commands require admin access
- Fully local — no telemetry, no cloud, no CDN

---

## Development

```bash
# Backend
pip install pytest pytest-asyncio pytest-homeassistant-custom-component
pytest tests/ -v

# Frontend (requires Node.js 18+)
cd frontend
npm install
npm run build   # outputs to custom_components/ha_entity_cleaner/www/ha-entity-cleaner.js
```

---

## Disclaimer

Community project, not affiliated with the Home Assistant project. The classification uses the entity registry, config entries, and live states — verify against your own setup before bulk deleting. The config-usage scan is a heuristic and may produce false positives. Portions developed with AI assistance.

## License

MIT — see [LICENSE](LICENSE).

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-orange.svg
[hacs-link]: https://hacs.xyz
[hassfest-badge]: https://github.com/marvin-rse/ha-entity-cleaner/actions/workflows/validate.yml/badge.svg
[hassfest-link]: https://github.com/marvin-rse/ha-entity-cleaner/actions/workflows/validate.yml
[release-badge]: https://img.shields.io/github/v/release/marvin-rse/ha-entity-cleaner
[release-link]: https://github.com/marvin-rse/ha-entity-cleaner/releases
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
