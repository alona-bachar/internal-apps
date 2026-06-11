import { PodOverviewCard } from "./PodOverviewCard";
import { EmptyState } from "./EmptyState";
import type { AssignmentData, PersonData, PodData, PodSummary, Row } from "./types";

type PodOverviewGridProps = {
  summaries: PodSummary[];
  peopleById: Map<string, Row<PersonData>>;
  allAssignments: Row<AssignmentData>[];
  pods: Row<PodData>[];
  onSelect: (podId: string) => void;
};

export function PodOverviewGrid({
  summaries,
  peopleById,
  allAssignments,
  pods,
  onSelect,
}: PodOverviewGridProps) {
  if (!summaries.length) {
    return <EmptyState title="No clients match the current filters." />;
  }

  return (
    <>
      <Legend />
      <div className="pod-overview-grid" role="list" aria-label="Clients overview">
        {summaries.map((summary) => (
          <PodOverviewCard
            key={summary.pod.id}
            summary={summary}
            peopleById={peopleById}
            allAssignments={allAssignments}
            pods={pods}
            onClick={() => onSelect(summary.pod.id)}
          />
        ))}
      </div>
    </>
  );
}

function Legend() {
  return (
    <div className="seat-legend" aria-label="Chip color legend">
      <LegendItem tag="external" label="External FDE" />
      <LegendItem tag="comando" label="Comando" />
      <LegendItem tag="onboarding" label="Onboarding" />
      <LegendItem tag="away" label="Away" />
      <LegendItem tag="neutral" label="Active" />
    </div>
  );
}

function LegendItem({ tag, label }: { tag: "external" | "comando" | "onboarding" | "away" | "neutral"; label: string }) {
  return (
    <span className="seat-legend-item">
      <span className={`seat seat-tag-${tag} filled`} aria-hidden />
      <span className="muted small">{label}</span>
    </span>
  );
}
