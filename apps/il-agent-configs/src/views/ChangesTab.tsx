import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfigsApi } from "../lib/api";
import type { ChangesResponse, ConfigChange } from "../lib/types";
import { humanizeLabel } from "../lib/configGroups";

function fmtVal(v: string | null): string {
  if (v == null || v === "") return "—";
  return v.length > 80 ? v.slice(0, 77) + "…" : v;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const DAY_MS = 24 * 60 * 60 * 1000;
type RangePreset = "all" | "today" | "7d" | "30d" | "custom";
const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

// Resolve the active preset / custom dates to [fromMs, toMs] bounds (either may
// be null = unbounded). Custom dates are inclusive calendar days.
function rangeBounds(preset: RangePreset, from: string, to: string): { fromMs: number | null; toMs: number | null } {
  if (preset === "custom") {
    const f = from ? new Date(from + "T00:00:00").getTime() : null;
    const t = to ? new Date(to + "T23:59:59.999").getTime() : null;
    return { fromMs: f, toMs: t };
  }
  if (preset === "today") {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    return { fromMs: s.getTime(), toMs: null };
  }
  if (preset === "7d") return { fromMs: Date.now() - 7 * DAY_MS, toMs: null };
  if (preset === "30d") return { fromMs: Date.now() - 30 * DAY_MS, toMs: null };
  return { fromMs: null, toMs: null };
}

export function ChangesTab() {
  const { listChanges } = useConfigsApi();
  const [res, setRes] = useState<ChangesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<RangePreset>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [q, setQ] = useState<string>("");

  const fetchIt = useCallback(async () => {
    try {
      setRes(await listChanges());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [listChanges]);

  useEffect(() => {
    void fetchIt();
  }, [fetchIt]);

  const allChanges: ConfigChange[] = res && res.ok === true ? res.changes : [];

  // Apply the date/time-range filter, then group by calendar date (newest first).
  const { groups, shownCount } = useMemo(() => {
    const { fromMs, toMs } = rangeBounds(preset, from, to);
    const needle = q.trim().toLowerCase();
    const filtered = allChanges.filter((c) => {
      if (needle) {
        const hay = `${c.agent_name ?? ""} ${c.customer ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (fromMs == null && toMs == null) return true;
      const ts = c.changed_at ? Date.parse(c.changed_at) : NaN;
      if (isNaN(ts)) return false;
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
    const byDate = new Map<string, ConfigChange[]>();
    for (const c of filtered) {
      const day = (c.changed_at ?? "").slice(0, 10) || "unknown";
      if (!byDate.has(day)) byDate.set(day, []);
      byDate.get(day)!.push(c);
    }
    const g = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return { groups: g, shownCount: filtered.length };
  }, [allChanges, preset, from, to, q]);

  const filterBar = (
    <div className="toolbar-card">
      <input
        className="search"
        placeholder="Filter by agent or customer…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="filter-group">
        <span className="filter-label">Range</span>
        <div className="seg">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`seg-btn ${preset === p.key ? "is-active" : ""}`}
              onClick={() => { setPreset(p.key); setFrom(""); setTo(""); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group">
        <span className="filter-label">From</span>
        <input
          type="date"
          className="filter-date"
          value={from}
          max={to || undefined}
          onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
        />
      </div>
      <div className="filter-group">
        <span className="filter-label">To</span>
        <input
          type="date"
          className="filter-date"
          value={to}
          min={from || undefined}
          onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
        />
      </div>
      {preset === "custom" && (from || to) && (
        <button className="filter-clear" onClick={() => { setPreset("all"); setFrom(""); setTo(""); }}>
          Clear
        </button>
      )}
    </div>
  );

  const header = (
    <header className="tab-header">
      <div>
        <h1>Recent changes</h1>
        <p className="muted">Agent-config changes detected by the daily sync</p>
      </div>
    </header>
  );

  if (error) {
    return <div className="tab">{header}<div className="error-banner">Failed to load changes: {error}</div></div>;
  }
  if (res === null) {
    return <div className="tab">{header}<div className="empty">Loading…</div></div>;
  }
  if (res.ok === false) {
    return <div className="tab">{header}<div className="error-banner">Failed to load changes: {res.error}</div></div>;
  }
  if (res.changes.length === 0) {
    return (
      <div className="tab">
        {header}
        <div className="empty-state">
          <p><strong>No changes recorded yet.</strong></p>
          <p>Config changes appear here as the daily sync detects them (a row per changed field). Nothing has changed since tracking started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tab">
      {header}
      {filterBar}
      <p className="muted chg-count">
        {shownCount} change{shownCount === 1 ? "" : "s"}
        {preset !== "all" ? " in range" : ""}
      </p>
      {groups.length === 0 ? (
        <div className="empty-state">
          <p><strong>No changes in this range.</strong></p>
          <p>Try a wider range or clear the filter.</p>
        </div>
      ) : (
        groups.map(([day, items]) => (
          <section key={day} className="chg-group">
            <div className="chg-date">{day}</div>
            <div className="chg-list">
              {items.map((c) => (
                <div key={c.id} className="chg-row">
                  <div className="chg-meta">
                    <span className="chg-agent">{c.agent_name ?? c.agent_id ?? "—"}</span>
                    {c.customer && <span className="chg-customer">{c.customer}</span>}
                    <span className="chg-field">{humanizeLabel(c.field_path)}</span>
                    <span className="chg-path mono">{c.field_path}</span>
                  </div>
                  <div className="chg-diff">
                    <span className="chg-old mono">{fmtVal(c.old_value)}</span>
                    <span className="chg-arrow">→</span>
                    <span className="chg-new mono">{fmtVal(c.new_value)}</span>
                  </div>
                  <div className="chg-time muted">{fmtTime(c.changed_at)}</div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
