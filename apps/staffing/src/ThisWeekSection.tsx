import { useState } from "react";
import { InlineEditField } from "./InlineEditField";
import { resolveCurrentWeek } from "./selectors";
import { safeText } from "./helpers";
import type { PodSummary } from "./types";

type ThisWeekSectionProps = {
  summary: PodSummary;
  onCommitWeekly: (field: string, value: string) => void;
};

export function ThisWeekSection({ summary, onCommitWeekly }: ThisWeekSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const weekly = summary.weekly?.data ?? {};
  const resolution = resolveCurrentWeek(weekly);
  const dsValue = resolution.dsCol ? String(weekly[resolution.dsCol] ?? "") : "";
  const fdeValue = resolution.fdeCol ? String(weekly[resolution.fdeCol] ?? "") : "";

  if (!summary.weekly) return null;

  const hasAnyValue = Boolean(weekly.notes || weekly.fde_missing_count || weekly.total_fde_needed || dsValue || fdeValue);
  if (!hasAnyValue && !expanded) {
    return (
      <section className="pod-detail-section">
        <button type="button" className="ghost-button small" onClick={() => setExpanded(true)}>
          + Add weekly tracking
        </button>
      </section>
    );
  }

  return (
    <section className="pod-detail-section">
      <header className="section-header-row clickable" onClick={() => setExpanded((v) => !v)}>
        <div>
          <p className="eyebrow">Weekly tracking — week of {resolution.weekLabel}</p>
          <h3>This week <span className="caret">{expanded ? "▾" : "▸"}</span></h3>
        </div>
        {!expanded ? (
          <span className="muted small">
            target {safeText(weekly.total_fde_needed, "—")} · missing {safeText(weekly.fde_missing_count, "0")}
          </span>
        ) : null}
      </header>

      {expanded ? (
        <>
          {resolution.isFallback ? (
            <div className="banner warning small" role="status">
              No column for {resolution.weekLabel} yet — showing latest available{resolution.fallbackWeekLabel ? ` (${resolution.fallbackWeekLabel})` : ""}.
            </div>
          ) : null}

          <div className="weekly-numbers">
            <InlineEditField
              kind="number"
              label="FDE headcount target"
              value={String(weekly.total_fde_needed ?? "")}
              onCommit={(v) => onCommitWeekly("total_fde_needed", v)}
            />
            <InlineEditField
              kind="number"
              label="Open FDE seats this week"
              value={String(weekly.fde_missing_count ?? "")}
              onCommit={(v) => onCommitWeekly("fde_missing_count", v)}
            />
          </div>

          <div className="two-col-form">
            {resolution.dsCol ? (
              <InlineEditField
                kind="text"
                label="DS notes this week"
                value={dsValue}
                onCommit={(v) => onCommitWeekly(resolution.dsCol!, v)}
                placeholder="e.g. Maya covering during Yotam OOO"
              />
            ) : null}
            {resolution.fdeCol ? (
              <InlineEditField
                kind="text"
                label="FDE notes this week"
                value={fdeValue}
                onCommit={(v) => onCommitWeekly(resolution.fdeCol!, v)}
                placeholder="e.g. Liat ramping up on production support"
              />
            ) : null}
          </div>

          <InlineEditField
            kind="textarea"
            label="Other weekly notes"
            value={String(weekly.notes ?? "")}
            onCommit={(v) => onCommitWeekly("notes", v)}
            rows={3}
          />

          {weekly.last_updated ? (
            <p className="muted tiny">Last updated: {safeText(weekly.last_updated)}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
