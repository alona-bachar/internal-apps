import { useMemo, useState } from "react";
import { isoDay, monthGrid, monthLabel, safeText, todayDateString } from "./helpers";
import { parseTargetDate } from "./goLiveDate";
import type { GoLiveData, PodData, Row } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusTone(status: string | null | undefined): "success" | "neutral" | "warning" | "danger" {
  const v = String(status ?? "").trim().toLowerCase();
  if (v === "delayed") return "danger";
  if (v === "at risk") return "warning";
  if (v === "performance pending") return "neutral";
  if (v === "on track") return "success";
  return "neutral";
}

type GoLivesCalendarProps = {
  goLives: Row<GoLiveData>[];
  pods: Row<PodData>[];
};

export function GoLivesCalendar({ goLives, pods }: GoLivesCalendarProps) {
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const today = todayDateString();
  const grid = useMemo(() => monthGrid(view.year, view.month), [view]);

  const podName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pods) {
      if (p.data.pod_name) map.set(p.id, p.data.pod_name);
    }
    return (podId: string | undefined) => (podId ? map.get(podId) ?? podId : "—");
  }, [pods]);

  const { byDay, tbd } = useMemo(() => {
    const map = new Map<string, Row<GoLiveData>[]>();
    const tbdList: Row<GoLiveData>[] = [];
    for (const g of goLives) {
      const iso = parseTargetDate(g.data.target_date, view.year);
      if (!iso) {
        tbdList.push(g);
        continue;
      }
      const list = map.get(iso) ?? [];
      list.push(g);
      map.set(iso, list);
    }
    return { byDay: map, tbd: tbdList };
  }, [goLives, view.year]);

  const goPrev = () =>
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 }));
  const goNext = () =>
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 }));
  const goToday = () => {
    const now = new Date();
    setView({ year: now.getFullYear(), month: now.getMonth() });
  };

  return (
    <div className="go-lives-calendar-layout">
      <section className="calendar-shell" aria-label="Go-lives calendar">
        <header className="calendar-header">
          <h3>{monthLabel(view.year, view.month)}</h3>
          <div className="calendar-nav">
            <button type="button" className="secondary-button small" onClick={goPrev} aria-label="Previous month">‹</button>
            <button type="button" className="secondary-button small" onClick={goToday}>Today</button>
            <button type="button" className="secondary-button small" onClick={goNext} aria-label="Next month">›</button>
          </div>
        </header>
        <div className="calendar-grid">
          {WEEKDAYS.map((d) => (
            <div key={d} className="calendar-weekday">{d}</div>
          ))}
          {grid.map((day) => {
            const key = isoDay(day);
            const inMonth = day.getMonth() === view.month;
            const isToday = key === today;
            const isPast = key < today;
            const items = byDay.get(key) ?? [];
            const visible = items.slice(0, 3);
            const hiddenCount = items.length - visible.length;
            return (
              <div
                key={key}
                className={`calendar-cell${inMonth ? "" : " out-of-month"}${isToday ? " today" : ""}${isPast ? " past" : ""}`}
              >
                <span className="calendar-day-num">{day.getDate()}</span>
                <div className="calendar-day-items">
                  {visible.map((g) => (
                    <span
                      key={g.id}
                      className={`calendar-item tone-${statusTone(g.data.status)}`}
                      title={`${safeText(g.data.agent_use_case)} · ${podName(g.data.pod_id)} · ${safeText(g.data.status, "—")} · ${safeText(g.data.target_date)}`}
                    >
                      <strong>{safeText(g.data.agent_use_case)}</strong>
                      <em>{podName(g.data.pod_id)}</em>
                    </span>
                  ))}
                  {hiddenCount > 0 ? <span className="calendar-more">+{hiddenCount} more</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <footer className="calendar-legend">
          <span className="calendar-legend-item tone-success">On Track</span>
          <span className="calendar-legend-item tone-neutral">Performance Pending</span>
          <span className="calendar-legend-item tone-warning">At Risk</span>
          <span className="calendar-legend-item tone-danger">Delayed</span>
        </footer>
      </section>

      <aside className="calendar-tbd" aria-label="Pipeline items without a specific date">
        <header>
          <p className="eyebrow">TBD / unscheduled</p>
          <h3>{tbd.length === 1 ? "1 item" : `${tbd.length} items`}</h3>
        </header>
        {tbd.length === 0 ? (
          <p className="muted small">All pipeline items have a parseable target.</p>
        ) : (
          <ul className="calendar-tbd-list">
            {tbd.map((g) => (
              <li key={g.id}>
                <strong>{safeText(g.data.agent_use_case)}</strong>
                <span className="muted small">{podName(g.data.pod_id)} · {safeText(g.data.target_date, "—")}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
