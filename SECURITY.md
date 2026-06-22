# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x (latest) | Yes |
| < 0.2.0 | No |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report privately via [GitHub's private vulnerability reporting](https://github.com/marvin-rse/ha-entity-cleaner/security/advisories/new).

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Affected version(s)
- Any suggested fix, if you have one

You can expect an acknowledgement within **48 hours** and a status update within **7 days**.

## Security design notes

HA Entity Cleaner is a destructive admin-only tool. Its security model is:

- **Admin-only** — the sidebar panel (`require_admin: True`) and all WebSocket commands (`@require_admin`) are inaccessible to non-admin users
- **Default dry-run** — every delete path defaults to `dry_run: true`; actual deletion requires an explicit opt-in
- **skip_referenced=true by default** — entities still found in YAML or Lovelace configs are never auto-deleted
- **Typed confirmation** — the panel requires typing `DELETE` plus checking "I have a backup" before the delete button unlocks
- **No remote calls** — fully local; no analytics, no telemetry, no CDN dependencies
- **Reference scan is advisory** — the config-usage scan is heuristic and never causes automatic deletions

## Scope

In scope for reports:
- Authentication / authorization bypass (non-admin accessing WS commands or the panel)
- Deletions occurring without proper guard checks (offline/disabled/ghost entities, referenced entities)
- Path traversal or data leakage in the reference scan
- XSS in the panel

Out of scope:
- Denial of service via large numbers of entities (admin-only, self-hosted)
- False positives or negatives in the heuristic reference scan (documented limitation)
- Issues requiring physical access to the HA host
