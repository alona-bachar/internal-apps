import { Chip } from "./Chip";
import { fullName, safeText } from "./helpers";
import type { AssignmentData, PersonData, PodData, PodSummary, Row } from "./types";

type GapsSectionProps = {
  summary: PodSummary;
  people: Row<PersonData>[];
  pods: Row<PodData>[];
  onAssignDs: () => void;
  onAssignFde: () => void;
  onFillExistingSlot: (assignment: Row<AssignmentData>) => void;
};

function openAllocationPct(assignment: Row<AssignmentData>): number {
  const raw = assignment.data.allocation_pct;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 100;
}

export function GapsSection({ summary, people, pods, onAssignDs, onAssignFde, onFillExistingSlot }: GapsSectionProps) {
  const filledDs = summary.ds.filter((a) => a.data.person_id && a.data.status !== "Open").length;
  const filledFde = [...summary.fde, ...summary.externalFde].filter(
    (a) => a.data.person_id && a.data.status !== "Open",
  ).length;
  const openDs = summary.ds.filter((a) => a.data.status === "Open" || !a.data.person_id);
  const openFde = [...summary.fde, ...summary.externalFde].filter(
    (a) => a.data.status === "Open" || !a.data.person_id,
  );
  const weeklyMissing = Number(summary.weekly?.data.fde_missing_count ?? 0) || 0;

  // Forecasted gaps: people leaving this pod in the next 30 days
  const horizonDate = new Date();
  horizonDate.setDate(horizonDate.getDate() + 30);
  const horizonStr = horizonDate.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const upcomingDepartures = summary.assignments
    .filter((a) => a.data.person_id && a.data.status !== "Open")
    .map((a) => {
      const person = people.find((p) => p.id === a.data.person_id);
      if (!person) return null;
      const targetPodId = person.data.move_to_pod_id;
      const moveDate = person.data.move_date ? String(person.data.move_date).slice(0, 10) : null;
      const isLeavingCompany = person.data.status === "Leaving";
      if (!targetPodId && !isLeavingCompany) return null;
      if (moveDate && (moveDate < todayStr || moveDate > horizonStr)) return null;
      const targetPodName = targetPodId
        ? safeText(pods.find((p) => p.id === targetPodId)?.data.pod_name, targetPodId)
        : "leaving the company";
      return { person, assignment: a, moveDate, targetPodName, isLeavingCompany };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const hasCurrentGaps = summary.gapCount > 0;
  const hasForecasted = upcomingDepartures.length > 0;

  if (!hasCurrentGaps && !hasForecasted) {
    return (
      <section className="pod-detail-section">
        <header className="section-header-row">
          <div>
            <p className="eyebrow">Gaps</p>
            <h3>Coverage gaps</h3>
          </div>
          <Chip tone="success">Fully staffed</Chip>
        </header>
      </section>
    );
  }

  return (
    <section className="pod-detail-section">
      <header className="section-header-row">
        <div>
          <p className="eyebrow">Gaps</p>
          <h3>
            Coverage gaps{summary.gapCount > 0 ? ` (${Math.round(summary.gapCount)}%)` : ""}
            {hasForecasted ? ` · ${upcomingDepartures.length} upcoming` : ""}
          </h3>
        </div>
      </header>
      <div className="gap-list-rows">
        {filledDs === 0 && openDs.length === 0 ? (
          <div className="gap-row">
            <span><strong>No DS assigned</strong> — this client needs a Deployment Strategist.</span>
            <button className="primary-button small" type="button" onClick={onAssignDs}>Assign DS</button>
          </div>
        ) : null}
        {filledFde === 0 && openFde.length === 0 ? (
          <div className="gap-row">
            <span><strong>No FDE assigned</strong> — this client needs Forward Deployed coverage.</span>
            <button className="primary-button small" type="button" onClick={onAssignFde}>Assign FDE</button>
          </div>
        ) : null}
        {openDs.map((a) => (
          <div className="gap-row" key={a.id}>
            <span>Open DS slot — <strong>{openAllocationPct(a)}% needed</strong> · {safeText(a.data.notes, "no notes")}.</span>
            <button className="primary-button small" type="button" onClick={() => onFillExistingSlot(a)}>Fill</button>
          </div>
        ))}
        {openFde.map((a) => (
          <div className="gap-row" key={a.id}>
            <span>Open FDE slot — <strong>{openAllocationPct(a)}% needed</strong> · {safeText(a.data.notes, "no notes")}.</span>
            <button className="primary-button small" type="button" onClick={() => onFillExistingSlot(a)}>Fill</button>
          </div>
        ))}
        {weeklyMissing > 0 ? (
          <div className="gap-row">
            <span>Weekly tracking reports <strong>{weeklyMissing}</strong> missing FDE{weeklyMissing === 1 ? "" : "s"}.</span>
            <span className="muted small">Adjust in This week section.</span>
          </div>
        ) : null}
        {upcomingDepartures.map(({ person, assignment, moveDate, targetPodName, isLeavingCompany }) => (
          <div className="gap-row upcoming" key={`forecast-${assignment.id}`}>
            <span>
              <strong>{fullName(person)}</strong> — {assignment.data.role} {isLeavingCompany ? "leaves" : "moves to"} {targetPodName}
              {moveDate ? ` on ${moveDate}` : ""}.
            </span>
            <span className="badge warning">Upcoming</span>
          </div>
        ))}
      </div>
    </section>
  );
}
