import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HassEntity {
  state: string;
  last_changed: string;
  attributes: Record<string, unknown>;
}

interface Hass {
  states: Record<string, HassEntity>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  user?: { is_admin: boolean };
}

interface CleanerItem {
  entity_id: string;
  domain: string;
  reason: string;
  safe: boolean;
  last_changed: string | null;
  referenced: boolean;
  used_in: string[];
}

interface BucketMap {
  orphan: CleanerItem[];
  offline: CleanerItem[];
  disabled: CleanerItem[];
  ghost: CleanerItem[];
}

interface Summary {
  orphan_count: number;
  orphan_safe_count: number;
  orphan_uncertain_count: number;
  orphan_referenced_count: number;
  offline_count: number;
  disabled_count: number;
  ghost_count: number;
  score: number;
}

interface ListResult {
  buckets: BucketMap;
  summary: Summary;
}

interface DeleteResult {
  dry_run: boolean;
  deleted: string[];
  deleted_count: number;
  failed: Array<{ entity_id: string; error: string }>;
  skipped_not_orphan: string[];
  skipped_uncertain: string[];
  skipped_referenced: string[];
  skipped_recent: string[];
}

type Bucket = keyof BucketMap;
type View = "home" | "triage";
type DeleteStep = "idle" | "confirm" | "running" | "done";

const BUCKET_LABELS: Record<Bucket, string> = {
  orphan: "Orphans",
  offline: "Offline",
  disabled: "Disabled",
  ghost: "Ghosts",
};

const BUCKET_NOTES: Record<Bucket, string> = {
  orphan:
    "Entities whose integration is gone or config entry was removed. " +
    "Safe (green) = config entry deleted — high confidence. " +
    "Uncertain (amber) = no config entry found — review before deleting. " +
    "Devices that are simply offline are in the Offline tab, never here.",
  offline:
    "Real devices whose integration is still installed but temporarily unreachable. " +
    "Do NOT delete — they will come back when the device is powered on. " +
    "Selection and deletion are intentionally disabled here.",
  disabled:
    "Entities that are explicitly disabled in the registry. " +
    "They are not zombies and do not need to be removed.",
  ghost:
    "Entities that exist in the state machine but have no registry entry " +
    "(often YAML-defined or MQTT retained). They cannot be deleted via the " +
    "registry API — fix them at the source (YAML / MQTT).",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageStr(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 86_400_000,
  );
  if (isNaN(days) || days < 0) return "";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function scoreLabel(score: number): string {
  if (score >= 95) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Poor";
  return "Critical";
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success-color, #3fb950)";
  if (score >= 60) return "var(--warning-color, #e3a93c)";
  return "var(--error-color, #f0556d)";
}

function groupByDomain(items: CleanerItem[]): Map<string, CleanerItem[]> {
  const map = new Map<string, CleanerItem[]>();
  for (const item of items) {
    const list = map.get(item.domain) ?? [];
    list.push(item);
    map.set(item.domain, list);
  }
  // Sort by count descending.
  return new Map(
    [...map.entries()].sort((a, b) => b[1].length - a[1].length),
  );
}

function exportJSON(items: CleanerItem[]): void {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          exported: new Date().toISOString(),
          count: items.length,
          entities: items.map((i) => ({
            entity_id: i.entity_id,
            domain: i.domain,
            reason: i.reason,
            safe: i.safe,
            referenced: i.referenced,
            used_in: i.used_in,
            last_changed: i.last_changed,
          })),
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ha-entity-cleaner-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Panel element (registered as custom panel)
// ---------------------------------------------------------------------------

@customElement("ha-entity-cleaner-panel")
export class HaEntityCleanerPanel extends LitElement {
  @property({ attribute: false }) hass!: Hass;
  @property({ attribute: false }) narrow = false;

  @state() private _view: View = "home";
  @state() private _bucket: Bucket = "orphan";
  @state() private _loading = false;
  @state() private _error: string | null = null;
  @state() private _data: ListResult | null = null;
  @state() private _search = "";
  @state() private _safeOnly = true;
  @state() private _selected = new Set<string>();
  @state() private _deleteStep: DeleteStep = "idle";
  @state() private _deleteResult: DeleteResult | null = null;
  @state() private _confirmText = "";
  @state() private _backupAck = false;
  @state() private _deleteProgress = 0;
  @state() private _expandedDomains = new Set<string>();

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  protected override firstUpdated(_: PropertyValues): void {
    this._loadData();
  }

  private async _loadData(): Promise<void> {
    this._loading = true;
    this._error = null;
    try {
      const result = await this.hass.callWS<ListResult>({
        type: "ha_entity_cleaner/list",
      });
      this._data = result;
    } catch (e: unknown) {
      this._error =
        e instanceof Error ? e.message : "Failed to load entity data.";
    } finally {
      this._loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  private get _currentItems(): CleanerItem[] {
    if (!this._data) return [];
    let items = this._data.buckets[this._bucket] ?? [];
    if (this._bucket === "orphan" && this._safeOnly) {
      items = items.filter((i) => i.safe);
    }
    const q = this._search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.entity_id.toLowerCase().includes(q) ||
          i.domain.toLowerCase().includes(q),
      );
    }
    return items;
  }

  private get _selectedItems(): CleanerItem[] {
    if (!this._data) return [];
    const all = [
      ...this._data.buckets.orphan,
      ...this._data.buckets.offline,
      ...this._data.buckets.disabled,
      ...this._data.buckets.ghost,
    ];
    return all.filter((i) => this._selected.has(i.entity_id));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  protected override render() {
    return html`
      <div class="page">
        ${this._renderHeader()}
        ${this._loading
          ? html`<div class="loading">
              <ha-circular-progress active></ha-circular-progress>
              <span>Scanning entities…</span>
            </div>`
          : this._error
            ? this._renderError()
            : this._view === "home"
              ? this._renderHome()
              : this._renderTriage()}
        ${this._deleteStep !== "idle" ? this._renderDeleteModal() : nothing}
      </div>
    `;
  }

  private _renderHeader() {
    return html`
      <header class="top-bar">
        <div class="title-row">
          <ha-icon icon="mdi:broom" class="logo-icon"></ha-icon>
          <div>
            <h1>HA Entity Cleaner</h1>
            <p class="sub">
              Find, review, and safely remove orphaned entities
            </p>
          </div>
        </div>
        <div class="header-actions">
          ${this._view === "triage"
            ? html`<mwc-button outlined @click=${() => (this._view = "home")}>
                ← Overview
              </mwc-button>`
            : nothing}
          <mwc-button
            outlined
            @click=${this._loadData}
            ?disabled=${this._loading}
          >
            <ha-icon icon="mdi:refresh"></ha-icon>
            Rescan
          </mwc-button>
        </div>
      </header>
    `;
  }

  private _renderError() {
    return html`
      <div class="error-state">
        <ha-icon icon="mdi:alert-circle" class="error-icon"></ha-icon>
        <p>${this._error}</p>
        <p class="hint">
          Make sure the HA Entity Cleaner integration is set up and you are
          logged in as an administrator.
        </p>
        <mwc-button raised @click=${this._loadData}>Retry</mwc-button>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Home view
  // ---------------------------------------------------------------------------

  private _renderHome() {
    const s = this._data?.summary;
    if (!s) return nothing;
    const score = s.score;

    return html`
      <div class="home">
        <!-- Cleanliness score -->
        <div class="score-card card">
          <div
            class="score-ring"
            style="--score-color:${scoreColor(score)}"
          >
            <svg viewBox="0 0 100 100" class="ring-svg">
              <circle cx="50" cy="50" r="42" class="ring-bg" />
              <circle
                cx="50"
                cy="50"
                r="42"
                class="ring-fill"
                style="stroke:${scoreColor(score)};stroke-dasharray:${(score / 100) * 264} 264"
              />
            </svg>
            <div class="score-value">
              <span class="score-num">${score}</span>
              <span class="score-label">${scoreLabel(score)}</span>
            </div>
          </div>
          <div class="score-meta">
            <h2>Instance Cleanliness</h2>
            <p class="muted">
              ${s.orphan_safe_count
                ? html`<strong>${s.orphan_safe_count}</strong> safe orphan${s.orphan_safe_count === 1 ? "" : "s"} deletable`
                : "No safe orphans found — great shape!"}
              ${s.orphan_uncertain_count
                ? html` · <strong>${s.orphan_uncertain_count}</strong> uncertain`
                : ""}
              ${s.orphan_referenced_count
                ? html` · <strong>${s.orphan_referenced_count}</strong> still referenced in config`
                : ""}
            </p>
            <mwc-button
              raised
              @click=${() => (this._view = "triage")}
              style="margin-top:12px"
            >
              Review & Clean →
            </mwc-button>
          </div>
        </div>

        <!-- Counters -->
        <div class="counters">
          ${this._renderCounter(
            "orphan",
            s.orphan_count,
            "Orphans",
            "Deletable",
            "mdi:ghost",
            "var(--error-color, #f0556d)",
          )}
          ${this._renderCounter(
            "offline",
            s.offline_count,
            "Offline",
            "Real, keep",
            "mdi:wifi-off",
            "var(--warning-color, #e3a93c)",
          )}
          ${this._renderCounter(
            "disabled",
            s.disabled_count,
            "Disabled",
            "Intentional",
            "mdi:eye-off",
            "var(--disabled-color, #7d8590)",
          )}
          ${this._renderCounter(
            "ghost",
            s.ghost_count,
            "Ghosts",
            "Fix at source",
            "mdi:help-circle",
            "var(--accent-color, #a78bfa)",
          )}
        </div>

        <!-- Backup banner -->
        <div class="backup-banner">
          <ha-icon icon="mdi:backup-restore" class="banner-icon"></ha-icon>
          <span>
            <strong>Take a backup before deleting.</strong>
            Deleted registry entries cannot be recovered by this tool.
            Use <em>Export selection</em> to save a JSON record first.
          </span>
        </div>

        <!-- Per-domain breakdown for orphans -->
        ${this._renderDomainBreakdown()}
      </div>
    `;
  }

  private _renderCounter(
    bucket: Bucket,
    count: number,
    label: string,
    sublabel: string,
    icon: string,
    color: string,
  ) {
    return html`
      <button
        class="counter-card card ${count ? "clickable" : ""}"
        style="--counter-color:${color}"
        @click=${count ? () => this._goToBucket(bucket) : undefined}
      >
        <div class="counter-bar"></div>
        <ha-icon icon="${icon}" class="counter-icon"></ha-icon>
        <div class="counter-num">${count}</div>
        <div class="counter-label">${label}</div>
        <div class="counter-sub muted">${sublabel}</div>
      </button>
    `;
  }

  private _renderDomainBreakdown() {
    const orphans = this._data?.buckets.orphan ?? [];
    if (!orphans.length) return nothing;

    const byDomain = groupByDomain(orphans);
    const top = [...byDomain.entries()].slice(0, 8);

    return html`
      <div class="card domain-breakdown">
        <h3>Orphan breakdown by domain</h3>
        ${top.map(
          ([domain, items]) => html`
            <div class="domain-row">
              <span class="domain-name mono">${domain}</span>
              <div class="domain-bar-wrap">
                <div
                  class="domain-bar-fill"
                  style="width:${(items.length / orphans.length) * 100}%"
                ></div>
              </div>
              <span class="domain-count mono">${items.length}</span>
            </div>
          `,
        )}
        ${byDomain.size > 8
          ? html`<p class="muted small">…and ${byDomain.size - 8} more domains</p>`
          : nothing}
      </div>
    `;
  }

  private _goToBucket(bucket: Bucket): void {
    this._bucket = bucket;
    this._view = "triage";
  }

  // ---------------------------------------------------------------------------
  // Triage view
  // ---------------------------------------------------------------------------

  private _renderTriage() {
    const deletable = this._bucket === "orphan";
    const items = this._currentItems;
    const groups = groupByDomain(items);

    return html`
      <div class="triage">
        <!-- Tabs -->
        <div class="tabs" role="tablist">
          ${(["orphan", "offline", "disabled", "ghost"] as Bucket[]).map(
            (b) => html`
              <button
                role="tab"
                class="tab ${this._bucket === b ? "active" : ""}"
                @click=${() => this._switchBucket(b)}
              >
                ${BUCKET_LABELS[b]}
                <span class="pill">${this._data?.buckets[b].length ?? 0}</span>
              </button>
            `,
          )}
        </div>

        <!-- Bucket note -->
        <div class="bucket-note">${BUCKET_NOTES[this._bucket]}</div>

        <!-- Toolbar -->
        <div class="toolbar">
          <input
            type="text"
            class="search"
            placeholder="Filter by entity_id or domain…"
            .value=${this._search}
            @input=${(e: Event) =>
              (this._search = (e.target as HTMLInputElement).value)}
          />
          ${this._bucket === "orphan"
            ? html`
                <label class="safe-toggle">
                  <input
                    type="checkbox"
                    ?checked=${this._safeOnly}
                    @change=${(e: Event) => {
                      this._safeOnly = (e.target as HTMLInputElement).checked;
                    }}
                  />
                  Safe only
                </label>
              `
            : nothing}
          ${deletable
            ? html`
                <button class="btn-ghost" @click=${this._selectAll}>
                  Select all
                </button>
                <button class="btn-ghost" @click=${this._clearSelection}>
                  Clear
                </button>
              `
            : nothing}
          <span class="sel-count mono"
            >${this._selected.size} selected</span
          >
        </div>

        <!-- Entity list -->
        <div class="entity-list">
          ${!items.length
            ? html`<div class="empty">
                Nothing in this category.
                ${this._search
                  ? "Try clearing the filter."
                  : "Your instance is clean here."}
              </div>`
            : repeat(
                [...groups.entries()],
                ([domain]) => domain,
                ([domain, domItems]) =>
                  this._renderDomainGroup(domain, domItems, deletable),
              )}
        </div>

        <!-- Sticky action bar -->
        ${deletable
          ? html`
              <div class="action-bar">
                <button
                  class="btn-ghost"
                  ?disabled=${!this._selected.size}
                  @click=${this._exportSelected}
                >
                  <ha-icon icon="mdi:download"></ha-icon>
                  Export JSON
                </button>
                <button
                  class="btn-danger"
                  ?disabled=${!this._selected.size}
                  @click=${this._startDelete}
                >
                  <ha-icon icon="mdi:delete"></ha-icon>
                  Delete selected (${this._selected.size})
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderDomainGroup(
    domain: string,
    items: CleanerItem[],
    deletable: boolean,
  ) {
    const open = this._expandedDomains.has(domain);
    const allSelected = items.every((i) => this._selected.has(i.entity_id));

    return html`
      <div class="dom-group">
        <div
          class="dom-header"
          @click=${() => this._toggleDomain(domain)}
          role="button"
          tabindex="0"
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._toggleDomain(domain)}
        >
          <ha-icon
            icon="mdi:chevron-right"
            class="chev ${open ? "open" : ""}"
          ></ha-icon>
          <span class="domain-name mono">${domain}</span>
          ${deletable
            ? html`<button
                class="dom-sel-all"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._selectDomain(domain, items, !allSelected);
                }}
              >
                ${allSelected ? "Deselect all" : "Select all"}
              </button>`
            : nothing}
          <span class="dom-count mono">${items.length}</span>
        </div>

        ${open
          ? repeat(
              items,
              (i) => i.entity_id,
              (item) => this._renderEntityRow(item, deletable),
            )
          : nothing}
      </div>
    `;
  }

  private _renderEntityRow(item: CleanerItem, deletable: boolean) {
    const checked = this._selected.has(item.entity_id);
    const age = ageStr(item.last_changed);
    const safeColor = item.safe
      ? "var(--success-color, #3fb950)"
      : "var(--warning-color, #e3a93c)";

    return html`
      <div class="ent-row ${item.referenced ? "referenced" : ""}">
        ${deletable
          ? html`<input
              type="checkbox"
              ?checked=${checked}
              @change=${(e: Event) =>
                this._toggleItem(
                  item.entity_id,
                  (e.target as HTMLInputElement).checked,
                )}
            />`
          : html`<span class="cb-spacer"></span>`}
        <span class="eid mono">${item.entity_id}</span>
        <span
          class="reason mono"
          style="${this._bucket === "orphan" ? `color:${safeColor}` : ""}"
        >
          ${item.reason}
        </span>
        ${age ? html`<span class="age muted">${age}</span>` : nothing}
        ${item.referenced
          ? html`<span
              class="ref-badge"
              title="Used in: ${item.used_in.slice(0, 5).join(", ")}${item.used_in.length > 5 ? ` …+${item.used_in.length - 5} more` : ""}"
            >
              <ha-icon icon="mdi:alert"></ha-icon>
              in config
            </span>`
          : nothing}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Delete modal
  // ---------------------------------------------------------------------------

  private _renderDeleteModal() {
    const items = this._selectedItems;
    const confirmed =
      this._backupAck && this._confirmText.trim().toUpperCase() === "DELETE";

    return html`
      <div class="overlay" @click=${this._maybeCloseModal}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          ${this._deleteStep === "confirm"
            ? html`
                <h2>Confirm deletion</h2>
                <p class="muted">
                  ${items.length} entit${items.length === 1 ? "y" : "ies"} will
                  be permanently removed from the registry.
                </p>

                <!-- Summary by domain -->
                <div class="modal-list">
                  ${[...groupByDomain(items).entries()].map(
                    ([d, list]) => html`<div>${d}: ${list.length}</div>`,
                  )}
                </div>

                ${items.some((i) => i.referenced)
                  ? html`
                      <div class="modal-warning">
                        <ha-icon icon="mdi:alert"></ha-icon>
                        <span
                          >${items.filter((i) => i.referenced).length}
                          selected entit${items.filter((i) => i.referenced).length === 1 ? "y is" : "ies are"}
                          still referenced in your config.
                          They will be skipped (skip_referenced=true).</span
                        >
                      </div>
                    `
                  : nothing}

                <label class="cb-label">
                  <input
                    type="checkbox"
                    ?checked=${this._backupAck}
                    @change=${(e: Event) =>
                      (this._backupAck = (e.target as HTMLInputElement).checked)}
                  />
                  I have a current backup of my Home Assistant instance.
                </label>

                <div class="field">
                  <label>Type <strong>DELETE</strong> to confirm</label>
                  <input
                    type="text"
                    .value=${this._confirmText}
                    @input=${(e: Event) =>
                      (this._confirmText = (e.target as HTMLInputElement).value)}
                    placeholder="DELETE"
                    autocomplete="off"
                  />
                </div>

                <div class="modal-actions">
                  <button
                    class="btn-ghost"
                    @click=${this._cancelDelete}
                  >
                    Cancel
                  </button>
                  <button
                    class="btn-danger"
                    ?disabled=${!confirmed}
                    @click=${this._executeDelete}
                  >
                    Delete now
                  </button>
                </div>
              `
            : this._deleteStep === "running"
              ? html`
                  <h2>Deleting…</h2>
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style="width:${this._deleteProgress}%"
                    ></div>
                  </div>
                  <p class="muted">Please wait.</p>
                `
              : html`
                  <!-- done -->
                  <h2>
                    ${this._deleteResult?.deleted_count
                      ? `Deleted ${this._deleteResult.deleted_count} ${this._deleteResult.deleted_count === 1 ? "entity" : "entities"}`
                      : "Nothing deleted"}
                  </h2>
                  ${this._deleteResult?.failed.length
                    ? html`
                        <div class="modal-warning">
                          <ha-icon icon="mdi:alert"></ha-icon>
                          <span
                            >${this._deleteResult.failed.length} failed
                            (still claimed by an integration):</span
                          >
                        </div>
                        <div class="modal-list">
                          ${this._deleteResult.failed.map(
                            (f) => html`<div class="mono">${f.entity_id} — ${f.error}</div>`,
                          )}
                        </div>
                      `
                    : nothing}
                  ${this._deleteResult?.skipped_referenced.length
                    ? html`
                        <p class="muted small">
                          Skipped (still in config):
                          ${this._deleteResult.skipped_referenced.join(", ")}
                        </p>
                      `
                    : nothing}
                  <div class="modal-actions">
                    <button class="btn-ghost" @click=${this._cancelDelete}>
                      Close
                    </button>
                  </div>
                `}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private _switchBucket(b: Bucket): void {
    this._bucket = b;
    this._search = "";
    this._selected.clear();
    this._selected = new Set(this._selected);
  }

  private _toggleDomain(domain: string): void {
    const next = new Set(this._expandedDomains);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    this._expandedDomains = next;
  }

  private _toggleItem(entityId: string, checked: boolean): void {
    const next = new Set(this._selected);
    if (checked) next.add(entityId);
    else next.delete(entityId);
    this._selected = next;
  }

  private _selectAll(): void {
    const next = new Set(this._selected);
    for (const item of this._currentItems) {
      next.add(item.entity_id);
    }
    this._selected = next;
  }

  private _clearSelection(): void {
    this._selected = new Set();
  }

  private _selectDomain(
    _domain: string,
    items: CleanerItem[],
    select: boolean,
  ): void {
    const next = new Set(this._selected);
    for (const item of items) {
      if (select) next.add(item.entity_id);
      else next.delete(item.entity_id);
    }
    this._selected = next;
  }

  private _exportSelected(): void {
    exportJSON(this._selectedItems);
  }

  private _startDelete(): void {
    this._deleteStep = "confirm";
    this._confirmText = "";
    this._backupAck = false;
    this._deleteResult = null;
  }

  private _cancelDelete(): void {
    if (this._deleteStep === "done") {
      this._loadData();
    }
    this._deleteStep = "idle";
    this._deleteResult = null;
  }

  private _maybeCloseModal(e: Event): void {
    if (this._deleteStep !== "running") this._cancelDelete();
  }

  private async _executeDelete(): Promise<void> {
    this._deleteStep = "running";
    this._deleteProgress = 10;

    const entityIds = this._selectedItems.map((i) => i.entity_id);

    try {
      this._deleteProgress = 50;
      const result = await this.hass.callWS<DeleteResult>({
        type: "ha_entity_cleaner/delete",
        entity_ids: entityIds,
        include_uncertain: false,
        min_age_days: 0,
        skip_referenced: true,
        dry_run: false,
      });
      this._deleteProgress = 100;
      this._deleteResult = result;
      this._selected = new Set();
    } catch (e: unknown) {
      this._deleteResult = {
        dry_run: false,
        deleted: [],
        deleted_count: 0,
        failed: [
          {
            entity_id: "—",
            error: e instanceof Error ? e.message : String(e),
          },
        ],
        skipped_not_orphan: [],
        skipped_uncertain: [],
        skipped_referenced: [],
        skipped_recent: [],
      };
    }

    this._deleteStep = "done";
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  static override styles = css`
    :host {
      display: block;
      --cleaner-orphan: var(--error-color, #f0556d);
      --cleaner-offline: var(--warning-color, #e3a93c);
      --cleaner-disabled: var(--disabled-color, #7d8590);
      --cleaner-ghost: var(--accent-color, #a78bfa);
      --cleaner-ok: var(--success-color, #3fb950);
    }

    * {
      box-sizing: border-box;
    }

    .page {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px 20px 80px;
    }

    /* ---- Header ---- */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      --mdc-icon-size: 36px;
      color: var(--primary-color);
    }

    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 650;
    }

    h2 {
      margin: 0 0 8px;
      font-size: 18px;
    }

    h3 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--secondary-text-color);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .sub {
      color: var(--secondary-text-color);
      font-size: 13px;
      margin: 2px 0 0;
    }

    .muted {
      color: var(--secondary-text-color);
      font-size: 13px;
    }

    .small {
      font-size: 12px;
    }

    .mono {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }

    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* ---- Card ---- */
    .card {
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 16px;
    }

    /* ---- Loading / Error ---- */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 60px 20px;
      color: var(--secondary-text-color);
    }

    .error-state {
      text-align: center;
      padding: 60px 20px;
    }

    .error-icon {
      --mdc-icon-size: 48px;
      color: var(--error-color, #f0556d);
    }

    .hint {
      color: var(--secondary-text-color);
      font-size: 13px;
    }

    /* ---- Score card ---- */
    .score-card {
      display: flex;
      gap: 32px;
      align-items: center;
      flex-wrap: wrap;
    }

    .score-ring {
      position: relative;
      width: 120px;
      height: 120px;
      flex-shrink: 0;
    }

    .ring-svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }

    .ring-bg {
      fill: none;
      stroke: var(--divider-color);
      stroke-width: 10;
    }

    .ring-fill {
      fill: none;
      stroke-width: 10;
      stroke-linecap: round;
      transition: stroke-dasharray 0.5s ease;
    }

    .score-value {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
    }

    .score-num {
      font-size: 30px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--score-color, var(--primary-color));
      line-height: 1;
    }

    .score-label {
      font-size: 11px;
      color: var(--secondary-text-color);
      letter-spacing: 0.04em;
    }

    .score-meta {
      flex: 1;
    }

    /* ---- Counters ---- */
    .counters {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }

    @media (max-width: 720px) {
      .counters {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .counter-card {
      position: relative;
      overflow: hidden;
      padding: 16px 16px 14px;
      text-align: left;
      cursor: default;
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 14px;
      transition: border-color 0.15s;
    }

    .counter-card.clickable {
      cursor: pointer;
    }

    .counter-card.clickable:hover {
      border-color: var(--counter-color);
    }

    .counter-bar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: var(--counter-color);
    }

    .counter-icon {
      --mdc-icon-size: 20px;
      color: var(--counter-color);
      margin-bottom: 6px;
    }

    .counter-num {
      font-size: 34px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--counter-color);
      line-height: 1;
    }

    .counter-label {
      font-size: 13px;
      font-weight: 600;
      margin-top: 6px;
    }

    .counter-sub {
      font-size: 11px;
      margin-top: 2px;
    }

    /* ---- Backup banner ---- */
    .backup-banner {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      background: color-mix(in srgb, var(--warning-color, #e3a93c) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--warning-color, #e3a93c) 40%, transparent);
      border-radius: 11px;
      padding: 12px 14px;
      font-size: 13px;
      color: var(--primary-text-color);
      margin-bottom: 16px;
    }

    .banner-icon {
      color: var(--warning-color, #e3a93c);
      flex-shrink: 0;
    }

    /* ---- Domain breakdown ---- */
    .domain-breakdown {
      padding: 16px 18px;
    }

    .domain-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }

    .domain-name {
      width: 160px;
      font-size: 13px;
      flex-shrink: 0;
    }

    .domain-bar-wrap {
      flex: 1;
      height: 6px;
      background: var(--divider-color);
      border-radius: 3px;
      overflow: hidden;
    }

    .domain-bar-fill {
      height: 100%;
      background: var(--cleaner-orphan);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    .domain-count {
      width: 32px;
      font-size: 12px;
      text-align: right;
      color: var(--secondary-text-color);
    }

    /* ---- Triage ---- */
    .triage {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    /* ---- Tabs ---- */
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--divider-color);
      flex-wrap: wrap;
      margin-bottom: 0;
    }

    .tab {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--secondary-text-color);
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 550;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tab.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
    }

    .pill {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      background: var(--secondary-background-color);
      padding: 1px 7px;
      border-radius: 20px;
    }

    /* ---- Bucket note ---- */
    .bucket-note {
      font-size: 12.5px;
      color: var(--secondary-text-color);
      padding: 10px 2px 6px;
      line-height: 1.6;
    }

    /* ---- Toolbar ---- */
    .toolbar {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      padding: 10px 0;
    }

    .search {
      flex: 1;
      min-width: 180px;
      background: var(--secondary-background-color);
      border: 1px solid var(--divider-color);
      color: var(--primary-text-color);
      border-radius: 9px;
      padding: 9px 12px;
      font-size: 13px;
    }

    .search:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .safe-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--secondary-text-color);
      cursor: pointer;
      white-space: nowrap;
    }

    .sel-count {
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    /* ---- Domain group ---- */
    .dom-group {
      border: 1px solid var(--divider-color);
      border-radius: 11px;
      margin-bottom: 8px;
      background: var(--card-background-color);
      overflow: hidden;
    }

    .dom-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 14px;
      cursor: pointer;
      user-select: none;
    }

    .dom-header:hover {
      background: var(--secondary-background-color);
    }

    .chev {
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
      transition: transform 0.15s;
      flex-shrink: 0;
    }

    .chev.open {
      transform: rotate(90deg);
    }

    .dom-sel-all {
      margin-left: auto;
      background: none;
      border: none;
      font-size: 12px;
      color: var(--primary-color);
      cursor: pointer;
      padding: 2px 6px;
    }

    .dom-count {
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    /* ---- Entity row ---- */
    .ent-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px 8px 36px;
      border-top: 1px solid var(--divider-color);
      font-size: 13px;
      flex-wrap: wrap;
    }

    .ent-row.referenced {
      background: color-mix(in srgb, var(--warning-color, #e3a93c) 6%, transparent);
    }

    .cb-spacer {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .eid {
      flex: 1;
      word-break: break-all;
      min-width: 160px;
    }

    .reason {
      font-size: 11.5px;
      color: var(--secondary-text-color);
    }

    .age {
      font-size: 11px;
      white-space: nowrap;
    }

    .ref-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--warning-color, #e3a93c);
      border: 1px solid var(--warning-color, #e3a93c);
      border-radius: 6px;
      padding: 1px 6px;
      cursor: help;
    }

    .ref-badge ha-icon {
      --mdc-icon-size: 13px;
    }

    /* ---- Empty ---- */
    .empty {
      color: var(--secondary-text-color);
      text-align: center;
      padding: 40px 20px;
      font-size: 14px;
    }

    /* ---- Action bar ---- */
    .action-bar {
      position: sticky;
      bottom: 0;
      padding: 16px 0 8px;
      background: linear-gradient(
        180deg,
        transparent,
        var(--lovelace-background, var(--primary-background-color)) 28%
      );
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* ---- Buttons ---- */
    .btn-ghost {
      background: transparent;
      border: 1px solid var(--divider-color);
      color: var(--primary-text-color);
      border-radius: 9px;
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 550;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-ghost:hover:not(:disabled) {
      border-color: var(--secondary-text-color);
    }

    .btn-ghost:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-danger {
      background: var(--error-color, #f0556d);
      color: #fff;
      border: none;
      border-radius: 9px;
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-danger:hover:not(:disabled) {
      filter: brightness(1.08);
    }

    .btn-danger:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* ---- Overlay / Modal ---- */
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: grid;
      place-items: center;
      padding: 20px;
      z-index: 100;
    }

    .modal {
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 16px;
      padding: 24px;
      max-width: 480px;
      width: 100%;
    }

    .modal-list {
      background: var(--secondary-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12px;
      color: var(--secondary-text-color);
      max-height: 140px;
      overflow: auto;
      margin: 12px 0;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      line-height: 1.7;
    }

    .modal-warning {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      background: color-mix(in srgb, var(--warning-color, #e3a93c) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--warning-color, #e3a93c) 40%, transparent);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12.5px;
      margin: 10px 0;
    }

    .modal-warning ha-icon {
      color: var(--warning-color, #e3a93c);
      flex-shrink: 0;
    }

    .cb-label {
      display: flex;
      gap: 9px;
      align-items: flex-start;
      font-size: 13px;
      margin: 12px 0;
      cursor: pointer;
    }

    .field label {
      display: block;
      font-size: 12px;
      color: var(--secondary-text-color);
      margin-bottom: 5px;
    }

    .field input[type="text"] {
      width: 100%;
      background: var(--secondary-background-color);
      border: 1px solid var(--divider-color);
      color: var(--primary-text-color);
      border-radius: 9px;
      padding: 9px 12px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 14px;
    }

    .field input:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .progress-bar {
      height: 8px;
      background: var(--secondary-background-color);
      border-radius: 20px;
      overflow: hidden;
      margin: 16px 0 8px;
    }

    .progress-fill {
      height: 100%;
      background: var(--error-color, #f0556d);
      border-radius: 20px;
      transition: width 0.3s ease;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-entity-cleaner-panel": HaEntityCleanerPanel;
  }
}
