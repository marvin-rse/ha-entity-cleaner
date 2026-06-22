/* HA Entity Cleaner — panel custom element (vanilla ES module, no CDN) */
"use strict";

const STYLES = `
:host {
  display: block;
  --c-orphan: var(--error-color, #f0556d);
  --c-offline: var(--warning-color, #e3a93c);
  --c-disabled: var(--disabled-color, #7d8590);
  --c-ghost: var(--accent-color, #a78bfa);
  --c-ok: var(--success-color, #3fb950);
  font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
  font-size: 15px;
}
*, *::before, *::after { box-sizing: border-box; }
.page { max-width: 1100px; margin: 0 auto; padding: 24px 20px 100px; }
h1 { margin: 0; font-size: 22px; font-weight: 650; }
h2 { margin: 0 0 8px; font-size: 18px; }
h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; text-transform: uppercase;
     letter-spacing:.06em; color: var(--secondary-text-color); }
p { margin: 6px 0; }
.sub { color: var(--secondary-text-color); font-size: 13px; margin: 2px 0 0; }
.muted { color: var(--secondary-text-color); font-size: 13px; }
.small { font-size: 11.5px; }
.mono { font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.top-bar { display:flex; justify-content:space-between; align-items:flex-start;
           gap:16px; margin-bottom:24px; flex-wrap:wrap; }
.title-row { display:flex; align-items:center; gap:12px; }
.logo { font-size: 26px; }
.header-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.card { background:var(--card-background-color); border:1px solid var(--divider-color);
        border-radius:14px; padding:18px; margin-bottom:16px; }
.btn { border-radius:9px; padding:9px 14px; font-size:13px; font-weight:550;
       cursor:pointer; border:none; display:inline-flex; align-items:center; gap:6px;
       transition:filter .15s, opacity .15s; }
.btn:disabled { opacity:.4; cursor:not-allowed; }
.btn-primary { background:var(--primary-color); color:var(--text-primary-color,#fff); }
.btn-primary:not(:disabled):hover { filter:brightness(1.08); }
.btn-ghost { background:transparent; color:var(--primary-text-color);
             border:1px solid var(--divider-color); }
.btn-ghost:not(:disabled):hover { border-color:var(--secondary-text-color); }
.btn-danger { background:var(--c-orphan); color:#fff; }
.btn-danger:not(:disabled):hover { filter:brightness(1.08); }

/* score ring */
.score-card { display:flex; gap:28px; align-items:center; flex-wrap:wrap; }
.ring-wrap { position:relative; width:120px; height:120px; flex-shrink:0; }
.ring-svg { width:100%; height:100%; transform:rotate(-90deg); }
.ring-bg { fill:none; stroke:var(--divider-color); stroke-width:10; }
.ring-fill { fill:none; stroke-width:10; stroke-linecap:round; transition:stroke-dasharray .5s; }
.ring-center { position:absolute; inset:0; display:flex; flex-direction:column;
               align-items:center; justify-content:center; gap:2px; }
.score-num { font-size:30px; font-weight:700; line-height:1; }
.score-lbl { font-size:11px; color:var(--secondary-text-color); letter-spacing:.04em; }
.score-meta { flex:1; }

/* counters */
.counters { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
@media(max-width:720px){ .counters { grid-template-columns:repeat(2,1fr); } }
.counter { position:relative; overflow:hidden; padding:16px 16px 14px;
           background:var(--card-background-color); border:1px solid var(--divider-color);
           border-radius:14px; cursor:default; text-align:left; }
.counter.clickable { cursor:pointer; transition:border-color .15s; }
.counter.clickable:hover { border-color:var(--cc); }
.counter-bar { position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--cc); }
.counter-num { font-size:34px; font-weight:700; font-variant-numeric:tabular-nums;
               color:var(--cc); line-height:1; }
.counter-lbl { font-size:13px; font-weight:600; margin-top:6px; }
.counter-sub { font-size:11px; color:var(--secondary-text-color); margin-top:2px; }

/* backup banner */
.backup-banner { display:flex; gap:10px; align-items:flex-start;
  background:color-mix(in srgb,var(--c-offline) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--c-offline) 40%,transparent);
  border-radius:11px; padding:12px 14px; font-size:13px; margin-bottom:16px; }

/* domain breakdown */
.dom-bar-row { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
.dom-bar-name { width:160px; font-size:13px; flex-shrink:0; }
.dom-bar-track { flex:1; height:6px; background:var(--divider-color); border-radius:3px; overflow:hidden; }
.dom-bar-fill { height:100%; background:var(--c-orphan); border-radius:3px; }
.dom-bar-cnt { width:32px; font-size:12px; text-align:right; color:var(--secondary-text-color); }

/* tabs */
.tabs { display:flex; gap:4px; border-bottom:1px solid var(--divider-color); flex-wrap:wrap; }
.tab { background:none; border:none; border-bottom:2px solid transparent;
       color:var(--secondary-text-color); padding:10px 14px; font-size:14px; font-weight:550;
       cursor:pointer; display:flex; align-items:center; gap:6px; }
.tab.active { color:var(--primary-color); border-bottom-color:var(--primary-color); }
.pill { font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:11px;
        background:var(--secondary-background-color); padding:1px 7px; border-radius:20px; }
.bucket-note { font-size:12.5px; color:var(--secondary-text-color); padding:10px 2px 4px; line-height:1.6; }

/* toolbar */
.toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 0; }
.search { flex:1; min-width:180px; background:var(--secondary-background-color);
          border:1px solid var(--divider-color); color:var(--primary-text-color);
          border-radius:9px; padding:9px 12px; font-size:13px; }
.search:focus { outline:none; border-color:var(--primary-color); }
.safe-wrap { display:flex; align-items:center; gap:6px; font-size:13px;
             color:var(--secondary-text-color); cursor:pointer; white-space:nowrap; }
.sel-count { font-size:13px; color:var(--secondary-text-color); font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }

/* entity list */
.dom-group { border:1px solid var(--divider-color); border-radius:11px; margin-bottom:8px;
             background:var(--card-background-color); overflow:hidden; }
.dom-hdr { display:flex; align-items:center; gap:10px; padding:11px 14px; cursor:pointer; user-select:none; }
.dom-hdr:hover { background:var(--secondary-background-color); }
.chev { font-size:12px; color:var(--secondary-text-color); transition:transform .15s; display:inline-block; }
.chev.open { transform:rotate(90deg); }
.dom-name { font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-weight:600; }
.dom-sel { margin-left:auto; background:none; border:none; font-size:12px;
           color:var(--primary-color); cursor:pointer; padding:2px 6px; }
.dom-cnt { font-size:12px; color:var(--secondary-text-color);
           font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.ent-row { display:flex; align-items:center; gap:10px; padding:8px 14px 8px 36px;
           border-top:1px solid var(--divider-color); font-size:13px; flex-wrap:wrap; }
.ent-row.ref { background:color-mix(in srgb,var(--c-offline) 6%,transparent); }
.cb-space { width:16px; height:16px; flex-shrink:0; }
.eid { flex:1; font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; word-break:break-all; min-width:120px; }
.reason { font-size:11.5px; color:var(--secondary-text-color); font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.age { font-size:11px; white-space:nowrap; color:var(--secondary-text-color); }
.ref-badge { display:inline-flex; align-items:center; gap:3px; font-size:11px;
             color:var(--c-offline); border:1px solid var(--c-offline); border-radius:6px;
             padding:1px 6px; cursor:help; }
.empty { color:var(--secondary-text-color); text-align:center; padding:40px 20px; font-size:14px; }

/* action bar */
.action-bar { position:sticky; bottom:0; padding:16px 0 8px;
  background:linear-gradient(180deg,transparent,var(--lovelace-background,var(--primary-background-color)) 28%);
  display:flex; gap:12px; align-items:center; flex-wrap:wrap; }

/* loading / error */
.loading { text-align:center; padding:60px 20px; color:var(--secondary-text-color); }
.error-box { background:color-mix(in srgb,var(--c-orphan) 10%,transparent);
             border:1px solid color-mix(in srgb,var(--c-orphan) 40%,transparent);
             border-radius:11px; padding:16px; margin:24px 0; }

/* modal */
.overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); display:grid;
           place-items:center; padding:20px; z-index:100; }
.modal { background:var(--card-background-color); border:1px solid var(--divider-color);
         border-radius:16px; padding:24px; max-width:480px; width:100%; }
.modal-list { background:var(--secondary-background-color); border:1px solid var(--divider-color);
  border-radius:10px; padding:10px 12px; font-size:12px; color:var(--secondary-text-color);
  max-height:140px; overflow:auto; margin:12px 0;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; line-height:1.7; white-space:pre; }
.modal-warn { display:flex; gap:8px; align-items:flex-start;
  background:color-mix(in srgb,var(--c-offline) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--c-offline) 40%,transparent);
  border-radius:8px; padding:10px 12px; font-size:12.5px; margin:10px 0; }
.cb-label { display:flex; gap:9px; align-items:flex-start; font-size:13px; margin:12px 0; cursor:pointer; }
.field label { display:block; font-size:12px; color:var(--secondary-text-color); margin-bottom:5px; }
.field input[type=text] { width:100%; background:var(--secondary-background-color);
  border:1px solid var(--divider-color); color:var(--primary-text-color); border-radius:9px;
  padding:9px 12px; font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:14px; }
.field input:focus { outline:none; border-color:var(--primary-color); }
.progress-bar { height:8px; background:var(--secondary-background-color); border-radius:20px;
                overflow:hidden; margin:16px 0 8px; }
.progress-fill { height:100%; background:var(--c-orphan); border-radius:20px; transition:width .3s; }
.modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageStr(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (isNaN(days) || days < 0) return "";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const m = Math.floor(days / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

function scoreLabel(s) {
  if (s >= 95) return "Excellent";
  if (s >= 80) return "Good";
  if (s >= 60) return "Fair";
  if (s >= 40) return "Poor";
  return "Critical";
}

function scoreColor(s) {
  if (s >= 80) return "var(--success-color, #3fb950)";
  if (s >= 60) return "var(--warning-color, #e3a93c)";
  return "var(--error-color, #f0556d)";
}

function groupByDomain(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.domain)) map.set(it.domain, []);
    map.get(it.domain).push(it);
  }
  return new Map([...map.entries()].sort((a, b) => b[1].length - a[1].length));
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "className") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k === "checked") e.checked = v;
    else if (k === "disabled") e.disabled = v;
    else e.setAttribute(k, v);
  }
  for (const ch of children.flat()) {
    if (ch == null || ch === false) continue;
    e.append(typeof ch === "string" ? ch : ch);
  }
  return e;
}

function txt(s) { return document.createTextNode(s); }

// ---------------------------------------------------------------------------
// Panel element
// ---------------------------------------------------------------------------

class HaEntityCleanerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._data = null;
    this._error = null;
    this._loading = false;
    this._view = "home";       // "home" | "triage"
    this._bucket = "orphan";
    this._search = "";
    this._safeOnly = true;
    this._selected = new Set();
    this._expanded = new Set();
    this._deleteStep = "idle"; // "idle" | "confirm" | "running" | "done"
    this._deleteResult = null;
    this._confirmText = "";
    this._backupAck = false;
    this._deleteProgress = 0;
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._loadData();
  }

  connectedCallback() {
    this._render();
  }

  // ---- data ----------------------------------------------------------------

  async _loadData() {
    this._loading = true;
    this._error = null;
    this._render();
    try {
      this._data = await this._hass.callWS({ type: "ha_entity_cleaner/list" });
    } catch (e) {
      this._error = e?.message || String(e);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  // ---- computed ------------------------------------------------------------

  get _currentItems() {
    if (!this._data) return [];
    let items = this._data.buckets[this._bucket] ?? [];
    if (this._bucket === "orphan" && this._safeOnly) items = items.filter(i => i.safe);
    const q = this._search.trim().toLowerCase();
    if (q) items = items.filter(i => i.entity_id.toLowerCase().includes(q) || i.domain.toLowerCase().includes(q));
    return items;
  }

  get _selectedItems() {
    if (!this._data) return [];
    const all = [
      ...this._data.buckets.orphan,
      ...this._data.buckets.offline,
      ...this._data.buckets.disabled,
      ...this._data.buckets.ghost,
    ];
    return all.filter(i => this._selected.has(i.entity_id));
  }

  // ---- render --------------------------------------------------------------

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = STYLES;
    root.appendChild(style);

    const page = el("div", { className: "page" });
    page.appendChild(this._renderHeader());

    if (this._loading) {
      page.appendChild(el("div", { className: "loading" }, "Scanning entities…"));
    } else if (this._error) {
      page.appendChild(this._renderError());
    } else if (this._view === "home") {
      page.appendChild(this._renderHome());
    } else {
      page.appendChild(this._renderTriage());
    }

    if (this._deleteStep !== "idle") {
      page.appendChild(this._renderModal());
    }

    root.appendChild(page);
  }

  _renderHeader() {
    const wrap = el("div", { className: "top-bar" });
    const titleRow = el("div", { className: "title-row" },
      el("span", { className: "logo" }, "🧹"),
      el("div", {},
        el("h1", {}, "HA Entity Cleaner"),
        el("p", { className: "sub" }, "Find, review, and safely remove orphaned entities"),
      ),
    );
    const actions = el("div", { className: "header-actions" });
    if (this._view === "triage") {
      actions.appendChild(el("button", { className: "btn btn-ghost", onclick: () => { this._view = "home"; this._render(); } }, "← Overview"));
    }
    actions.appendChild(el("button", {
      className: "btn btn-ghost",
      disabled: this._loading,
      onclick: () => this._loadData(),
    }, "↺ Rescan"));
    wrap.append(titleRow, actions);
    return wrap;
  }

  _renderError() {
    return el("div", { className: "error-box" },
      el("strong", {}, "Error loading entity data"),
      el("p", {}, this._error),
      el("p", { className: "muted" }, "Make sure the HA Entity Cleaner integration is installed and you are logged in as an administrator."),
      el("button", { className: "btn btn-primary", style: { marginTop: "12px" }, onclick: () => this._loadData() }, "Retry"),
    );
  }

  // ---- home ----------------------------------------------------------------

  _renderHome() {
    const s = this._data?.summary;
    if (!s) return el("div", {}, "No data.");
    const frag = document.createDocumentFragment();

    // Score card
    const score = s.score;
    const color = scoreColor(score);
    const circ = 2 * Math.PI * 42; // 263.9
    const dash = (score / 100) * circ;

    const scoreCard = el("div", { className: "card score-card" },
      el("div", { className: "ring-wrap" },
        (() => {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 100 100");
          svg.className.baseVal = "ring-svg";
          const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          bg.setAttribute("cx", "50"); bg.setAttribute("cy", "50"); bg.setAttribute("r", "42");
          bg.className.baseVal = "ring-bg";
          const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          fill.setAttribute("cx", "50"); fill.setAttribute("cy", "50"); fill.setAttribute("r", "42");
          fill.className.baseVal = "ring-fill";
          fill.setAttribute("stroke", color);
          fill.setAttribute("stroke-dasharray", `${dash} ${circ}`);
          svg.append(bg, fill);
          return svg;
        })(),
        el("div", { className: "ring-center" },
          el("span", { className: "score-num", style: { color } }, String(score)),
          el("span", { className: "score-lbl" }, scoreLabel(score)),
        ),
      ),
      el("div", { className: "score-meta" },
        el("h2", {}, "Instance Cleanliness"),
        el("p", { className: "muted" },
          s.orphan_safe_count
            ? `${s.orphan_safe_count} safe orphan${s.orphan_safe_count === 1 ? "" : "s"} ready to delete`
            : "No safe orphans found — great shape!",
          s.orphan_uncertain_count ? ` · ${s.orphan_uncertain_count} uncertain` : "",
          s.orphan_referenced_count ? ` · ${s.orphan_referenced_count} still referenced in config` : "",
        ),
        el("button", { className: "btn btn-primary", style: { marginTop: "12px" }, onclick: () => { this._view = "triage"; this._render(); } }, "Review & Clean →"),
      ),
    );
    frag.appendChild(scoreCard);

    // Counters
    const counters = el("div", { className: "counters" });
    const counterDefs = [
      { key: "orphan", label: "Orphans", sub: "Deletable", color: "var(--c-orphan)" },
      { key: "offline", label: "Offline", sub: "Real, keep", color: "var(--c-offline)" },
      { key: "disabled", label: "Disabled", sub: "Intentional", color: "var(--c-disabled)" },
      { key: "ghost", label: "Ghosts", sub: "Fix at source", color: "var(--c-ghost)" },
    ];
    for (const { key, label, sub, color: cc } of counterDefs) {
      const cnt = s[`${key}_count`] ?? 0;
      const card = el("div", {
        className: `counter${cnt ? " clickable" : ""}`,
        style: { "--cc": cc },
        title: `View ${label.toLowerCase()}`,
      },
        el("div", { className: "counter-bar" }),
        el("div", { className: "counter-num mono" }, String(cnt)),
        el("div", { className: "counter-lbl" }, label),
        el("div", { className: "counter-sub" }, sub),
      );
      if (cnt) card.addEventListener("click", () => { this._bucket = key; this._view = "triage"; this._render(); });
      counters.appendChild(card);
    }
    frag.appendChild(counters);

    // Backup banner
    frag.appendChild(el("div", { className: "backup-banner" },
      el("span", {}, "⚠ "),
      el("span", {}, [
        el("strong", {}, "Take a backup before deleting."),
        txt(" Deleted registry entries cannot be recovered by this tool. Use "),
        el("em", {}, "Export JSON"),
        txt(" to save a copy of your selection first."),
      ]),
    ));

    // Domain breakdown
    const orphans = this._data.buckets.orphan ?? [];
    if (orphans.length) {
      const groups = groupByDomain(orphans);
      const top = [...groups.entries()].slice(0, 8);
      const breakdown = el("div", { className: "card" },
        el("h3", {}, "Orphan breakdown by domain"),
        ...top.map(([domain, list]) => el("div", { className: "dom-bar-row" },
          el("span", { className: "dom-bar-name mono" }, domain),
          el("div", { className: "dom-bar-track" },
            el("div", { className: "dom-bar-fill", style: { width: `${(list.length / orphans.length) * 100}%` } }),
          ),
          el("span", { className: "dom-bar-cnt" }, String(list.length)),
        )),
        groups.size > 8 ? el("p", { className: "muted small" }, `…and ${groups.size - 8} more domains`) : null,
      );
      frag.appendChild(breakdown);
    }

    const wrapper = el("div", { className: "home" });
    wrapper.appendChild(frag);
    return wrapper;
  }

  // ---- triage --------------------------------------------------------------

  _renderTriage() {
    const NOTES = {
      orphan: "Entities whose integration is gone or config entry was removed. " +
        "Green = config entry deleted (high confidence). Amber = no config entry found (review before deleting). " +
        "Devices that are simply offline appear in the Offline tab, never here.",
      offline: "Real devices whose integration is still installed but temporarily unreachable. " +
        "Do NOT delete — they will come back when powered on. Selection is intentionally disabled here.",
      disabled: "Entities explicitly disabled in the registry. Not zombies, don't need to be removed.",
      ghost: "Entities in the state machine with no registry entry (YAML / MQTT retain). " +
        "Cannot be deleted via the registry — fix at source.",
    };
    const LABELS = { orphan: "Orphans", offline: "Offline", disabled: "Disabled", ghost: "Ghosts" };
    const deletable = this._bucket === "orphan";

    const wrap = el("div", { className: "triage" });

    // Tabs
    const tabs = el("div", { className: "tabs" });
    for (const b of ["orphan", "offline", "disabled", "ghost"]) {
      const count = this._data?.buckets[b]?.length ?? 0;
      const tab = el("button", { className: `tab${this._bucket === b ? " active" : ""}` },
        LABELS[b],
        el("span", { className: "pill" }, String(count)),
      );
      tab.addEventListener("click", () => { this._bucket = b; this._search = ""; this._selected.clear(); this._render(); });
      tabs.appendChild(tab);
    }
    wrap.appendChild(tabs);

    // Bucket note
    wrap.appendChild(el("div", { className: "bucket-note" }, NOTES[this._bucket]));

    // Toolbar
    const toolbar = el("div", { className: "toolbar" });
    const searchEl = el("input", { className: "search", type: "text", placeholder: "Filter by entity_id or domain…" });
    searchEl.value = this._search;
    searchEl.addEventListener("input", e => { this._search = e.target.value; this._render(); });
    toolbar.appendChild(searchEl);

    if (this._bucket === "orphan") {
      const safeWrap = el("label", { className: "safe-wrap" },
        el("input", { type: "checkbox", checked: this._safeOnly }),
        " Safe only",
      );
      safeWrap.querySelector("input").addEventListener("change", e => { this._safeOnly = e.target.checked; this._render(); });
      toolbar.appendChild(safeWrap);
    }

    if (deletable) {
      toolbar.appendChild(el("button", { className: "btn btn-ghost", onclick: () => this._selectAll() }, "Select all"));
      toolbar.appendChild(el("button", { className: "btn btn-ghost", onclick: () => { this._selected.clear(); this._render(); } }, "Clear"));
    }
    toolbar.appendChild(el("span", { className: "sel-count" }, `${this._selected.size} selected`));
    wrap.appendChild(toolbar);

    // Entity list
    const listEl = el("div", { className: "entity-list" });
    const items = this._currentItems;
    if (!items.length) {
      listEl.appendChild(el("div", { className: "empty" },
        "Nothing in this category." + (this._search ? " Try clearing the filter." : " Your instance is clean here."),
      ));
    } else {
      const groups = groupByDomain(items);
      for (const [domain, domItems] of groups) {
        listEl.appendChild(this._renderDomainGroup(domain, domItems, deletable));
      }
    }
    wrap.appendChild(listEl);

    // Action bar
    if (deletable) {
      wrap.appendChild(el("div", { className: "action-bar" },
        el("button", {
          className: "btn btn-ghost",
          disabled: !this._selected.size,
          onclick: () => this._exportSelected(),
        }, "⬇ Export JSON"),
        el("button", {
          className: "btn btn-danger",
          disabled: !this._selected.size,
          onclick: () => { this._deleteStep = "confirm"; this._confirmText = ""; this._backupAck = false; this._deleteResult = null; this._render(); },
        }, `🗑 Delete selected (${this._selected.size})`),
      ));
    }

    return wrap;
  }

  _renderDomainGroup(domain, items, deletable) {
    const open = this._expanded.has(domain);
    const group = el("div", { className: "dom-group" });
    const hdr = el("div", { className: "dom-hdr", tabindex: "0" },
      el("span", { className: `chev${open ? " open" : ""}` }, "▶"),
      el("span", { className: "dom-name" }, domain),
    );
    if (deletable) {
      const allSel = items.every(i => this._selected.has(i.entity_id));
      const selBtn = el("button", { className: "dom-sel" }, allSel ? "Deselect all" : "Select all");
      selBtn.addEventListener("click", e => {
        e.stopPropagation();
        items.forEach(i => allSel ? this._selected.delete(i.entity_id) : this._selected.add(i.entity_id));
        this._render();
      });
      hdr.appendChild(selBtn);
    }
    hdr.appendChild(el("span", { className: "dom-cnt" }, String(items.length)));
    hdr.addEventListener("click", () => {
      if (open) this._expanded.delete(domain); else this._expanded.add(domain);
      this._render();
    });
    hdr.addEventListener("keydown", e => { if (e.key === "Enter") hdr.click(); });
    group.appendChild(hdr);

    if (open) {
      for (const item of items) {
        group.appendChild(this._renderEntityRow(item, deletable));
      }
    }
    return group;
  }

  _renderEntityRow(item, deletable) {
    const row = el("div", { className: `ent-row${item.referenced ? " ref" : ""}` });
    if (deletable) {
      const cb = el("input", { type: "checkbox", checked: this._selected.has(item.entity_id) });
      cb.addEventListener("change", e => {
        if (e.target.checked) this._selected.add(item.entity_id);
        else this._selected.delete(item.entity_id);
        this._render();
      });
      row.appendChild(cb);
    } else {
      row.appendChild(el("span", { className: "cb-space" }));
    }

    row.appendChild(el("span", { className: "eid" }, item.entity_id));

    const reasonColor = this._bucket === "orphan"
      ? (item.safe ? "var(--c-ok)" : "var(--c-offline)")
      : "";
    row.appendChild(el("span", { className: "reason", style: { color: reasonColor } }, item.reason));

    const age = ageStr(item.last_changed);
    if (age) row.appendChild(el("span", { className: "age" }, age));

    if (item.referenced) {
      const tip = (item.used_in || []).slice(0, 5).join(", ") + (item.used_in?.length > 5 ? ` …+${item.used_in.length - 5} more` : "");
      const badge = el("span", { className: "ref-badge", title: `Used in: ${tip}` }, "⚠ in config");
      row.appendChild(badge);
    }

    return row;
  }

  // ---- modal ---------------------------------------------------------------

  _renderModal() {
    const overlay = el("div", { className: "overlay" });
    overlay.addEventListener("click", e => { if (e.target === overlay && this._deleteStep !== "running") this._closeModal(); });

    const modal = el("div", { className: "modal" });

    if (this._deleteStep === "confirm") {
      const items = this._selectedItems;
      const groups = groupByDomain(items);
      const refCount = items.filter(i => i.referenced).length;
      const confirmed = this._backupAck && this._confirmText.trim().toUpperCase() === "DELETE";

      modal.appendChild(el("h2", {}, "Confirm deletion"));
      modal.appendChild(el("p", { className: "muted" },
        `${items.length} entit${items.length === 1 ? "y" : "ies"} will be permanently removed from the registry.`,
      ));

      const list = el("div", { className: "modal-list" });
      list.textContent = [...groups.entries()].map(([d, l]) => `${d}: ${l.length}`).join("\n");
      modal.appendChild(list);

      if (refCount) {
        modal.appendChild(el("div", { className: "modal-warn" },
          `⚠ ${refCount} selected entit${refCount === 1 ? "y is" : "ies are"} still referenced in your config and will be skipped (skip_referenced=true).`,
        ));
      }

      const cbLabel = el("label", { className: "cb-label" },
        el("input", { type: "checkbox", checked: this._backupAck }),
        " I have a current backup of my Home Assistant instance.",
      );
      cbLabel.querySelector("input").addEventListener("change", e => { this._backupAck = e.target.checked; this._render(); });
      modal.appendChild(cbLabel);

      const fieldWrap = el("div", { className: "field" },
        el("label", {}, "Type DELETE to confirm"),
      );
      const confirmInput = el("input", { type: "text", placeholder: "DELETE", autocomplete: "off" });
      confirmInput.value = this._confirmText;
      confirmInput.addEventListener("input", e => { this._confirmText = e.target.value; this._render(); });
      fieldWrap.appendChild(confirmInput);
      modal.appendChild(fieldWrap);

      modal.appendChild(el("div", { className: "modal-actions" },
        el("button", { className: "btn btn-ghost", onclick: () => this._closeModal() }, "Cancel"),
        el("button", { className: "btn btn-danger", disabled: !confirmed, onclick: () => this._executeDelete() }, "Delete now"),
      ));

    } else if (this._deleteStep === "running") {
      modal.appendChild(el("h2", {}, "Deleting…"));
      const bar = el("div", { className: "progress-bar" },
        el("div", { className: "progress-fill", style: { width: `${this._deleteProgress}%` } }),
      );
      modal.appendChild(bar);
      modal.appendChild(el("p", { className: "muted" }, "Please wait."));

    } else { // done
      const r = this._deleteResult;
      modal.appendChild(el("h2", {}, r?.deleted_count ? `Deleted ${r.deleted_count} entit${r.deleted_count === 1 ? "y" : "ies"}` : "Nothing deleted"));
      if (r?.failed?.length) {
        modal.appendChild(el("div", { className: "modal-warn" }, `${r.failed.length} failed (still claimed by an integration):`));
        const failList = el("div", { className: "modal-list" });
        failList.textContent = r.failed.map(f => `${f.entity_id} — ${f.error}`).join("\n");
        modal.appendChild(failList);
      }
      if (r?.skipped_referenced?.length) {
        modal.appendChild(el("p", { className: "muted small" },
          `Skipped (still in config): ${r.skipped_referenced.join(", ")}`,
        ));
      }
      modal.appendChild(el("div", { className: "modal-actions" },
        el("button", { className: "btn btn-ghost", onclick: () => this._closeModal() }, "Close"),
      ));
    }

    overlay.appendChild(modal);
    return overlay;
  }

  _closeModal() {
    if (this._deleteStep === "done") this._loadData();
    this._deleteStep = "idle";
    this._deleteResult = null;
    this._render();
  }

  // ---- actions -------------------------------------------------------------

  _selectAll() {
    for (const i of this._currentItems) this._selected.add(i.entity_id);
    this._render();
  }

  _exportSelected() {
    const items = this._selectedItems;
    const blob = new Blob([JSON.stringify({
      exported: new Date().toISOString(),
      count: items.length,
      entities: items.map(i => ({
        entity_id: i.entity_id, domain: i.domain, reason: i.reason,
        safe: i.safe, referenced: i.referenced, used_in: i.used_in, last_changed: i.last_changed,
      })),
    }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ha-entity-cleaner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async _executeDelete() {
    this._deleteStep = "running";
    this._deleteProgress = 20;
    this._render();

    const entityIds = this._selectedItems.map(i => i.entity_id);
    try {
      this._deleteProgress = 50;
      this._render();
      const result = await this._hass.callWS({
        type: "ha_entity_cleaner/delete",
        entity_ids: entityIds,
        include_uncertain: false,
        min_age_days: 0,
        skip_referenced: true,
        dry_run: false,
      });
      this._deleteProgress = 100;
      this._deleteResult = result;
      this._selected.clear();
    } catch (e) {
      this._deleteResult = {
        deleted: [], deleted_count: 0,
        failed: [{ entity_id: "—", error: e?.message || String(e) }],
        skipped_not_orphan: [], skipped_uncertain: [], skipped_referenced: [], skipped_recent: [],
      };
    }
    this._deleteStep = "done";
    this._render();
  }
}

customElements.define("ha-entity-cleaner-panel", HaEntityCleanerPanel);
