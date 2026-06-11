import { useMemo, useState } from "react";
import {
  fullName,
  isOnboardingStatus,
  isoDay,
  monthGrid,
  monthLabel,
  safeText,
  todayDateString,
} from "./helpers";
import type { PersonData, PodData, Row } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type EventKind = "onboarding" | "cert1" | "cert2" | "cert3" | "joining" | "transition" | "leaving";

type PipelineEvent = {
  id: string;
  kind: EventKind;
  person: Row<PersonData>;
  iso: string | null;
  label: string;
  detail: string;
};

const KIND_LABEL: Record<EventKind, string> = {
  onboarding: "Arriving",
  cert1: "Cert 1",
  cert2: "Cert 2",
  cert3: "Cert 3",
  joining: "Joining",
  transition: "Transition",
  leaving: "Leaving",
};

function normIso(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function eventsForPerson(
  person: Row<PersonData>,
  podNameById: (id: string | null | undefined) => string,
): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  const name = fullName(person);

  if (isOnboardingStatus(person.data.status)) {
    events.push({
      id: `${person.id}-onb`,
      kind: "onboarding",
      person,
      iso: normIso(person.data.expected_start_date),
      label: name,
      detail: "Arriving",
    });
  }

  const certs: Array<[1 | 2 | 3, string | null | undefined, string | null | undefined]> = [
    [1, person.data.cert1_date, person.data.cert1_status],
    [2, person.data.cert2_date, person.data.cert2_status],
    [3, person.data.cert3_date, person.data.cert3_status],
  ];
  for (const [attempt, date, status] of certs) {
    const iso = normIso(date);
    if (!iso) continue;
    const s = String(status ?? "").trim().toLowerCase();
    if (s === "passed") continue;
    const kind: EventKind = attempt === 1 ? "cert1" : attempt === 2 ? "cert2" : "cert3";
    events.push({
      id: `${person.id}-cert${attempt}`,
      kind,
      person,
      iso,
      label: name,
      detail: `Cert ${attempt}`,
    });
  }

  const status = String(person.data.status ?? "").trim();
  const moveIso = normIso(person.data.move_date);
  if (status === "Leaving") {
    events.push({
      id: `${person.id}-leave`,
      kind: "leaving",
      person,
      iso: moveIso,
      label: name,
      detail: "Leaving",
    });
  } else if (status === "Onboarding" && person.data.move_to_pod_id) {
    const pod = podNameById(person.data.move_to_pod_id);
    events.push({
      id: `${person.id}-join`,
      kind: "joining",
      person,
      iso: moveIso,
      label: name,
      detail: `Joining ${pod}`,
    });
  } else if (person.data.move_to_pod_id || status === "Move to other client") {
    const pod = podNameById(person.data.move_to_pod_id);
    events.push({
      id: `${person.id}-move`,
      kind: "transition",
      person,
      iso: moveIso,
      label: name,
      detail: pod ? `Moving to ${pod}` : "Transition",
    });
  }

  return events;
}

type HumanPipelineCalendarProps = {
  people: Row<PersonData>[];
  pods: Row<PodData>[];
  onEventClick?: (person: Row<PersonData>) => void;
};

export function HumanPipelineCalendar({ people, pods, onEventClick }: HumanPipelineCalendarProps) {
  const podNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pods) {
      if (p.data.pod_name) map.set(p.id, p.data.pod_name);
    }
    return (id: string | null | undefined) => (id ? safeText(map.get(id), id) : "");
  }, [pods]);
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const today = todayDateString();
  const grid = useMemo(() => monthGrid(view.year, view.month), [view]);

  const { byDay, tbd } = useMemo(() => {
    const map = new Map<string, PipelineEvent[]>();
    const tbdList: PipelineEvent[] = [];
    for (const person of people) {
      for (const ev of eventsForPerson(person, podNameById)) {
        if (!ev.iso) {
          tbdList.push(ev);
          continue;
        }
        const list = map.get(ev.iso) ?? [];
        list.push(ev);
        map.set(ev.iso, list);
      }
    }
    return { byDay: map, tbd: tbdList };
  }, [people, podNameById]);

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
      <section className="calendar-shell" aria-label="Human pipeline calendar">
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
                  {visible.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      className={`calendar-item tone-${ev.kind}`}
                      onClick={() => onEventClick?.(ev.person)}
                      title={`${ev.detail} · ${ev.label} · ${ev.iso}`}
                    >
                      <strong>{ev.label}</strong>
                      <em>{ev.detail}</em>
                    </button>
                  ))}
                  {hiddenCount > 0 ? <span className="calendar-more">+{hiddenCount} more</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <footer className="calendar-legend">
          <span className="calendar-legend-item tone-onboarding">{KIND_LABEL.onboarding}</span>
          <span className="calendar-legend-item tone-cert1">{KIND_LABEL.cert1}</span>
          <span className="calendar-legend-item tone-cert2">{KIND_LABEL.cert2}</span>
          <span className="calendar-legend-item tone-cert3">{KIND_LABEL.cert3}</span>
          <span className="calendar-legend-item tone-joining">{KIND_LABEL.joining}</span>
          <span className="calendar-legend-item tone-transition">{KIND_LABEL.transition}</span>
          <span className="calendar-legend-item tone-leaving">{KIND_LABEL.leaving}</span>
        </footer>
      </section>

      <aside className="calendar-tbd" aria-label="Pipeline events without a specific date">
        <header>
          <p className="eyebrow">TBD / unscheduled</p>
          <h3>{tbd.length === 1 ? "1 event" : `${tbd.length} events`}</h3>
        </header>
        {tbd.length === 0 ? (
          <p className="muted small">All upcoming pipeline events have a date.</p>
        ) : (
          <ul className="calendar-tbd-list">
            {tbd.map((ev) => (
              <li key={ev.id}>
                <button type="button" className="calendar-tbd-link" onClick={() => onEventClick?.(ev.person)}>
                  <strong>{ev.label}</strong>
                  <span className="muted small">{ev.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
