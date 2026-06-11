export type PipelineSegment = "Onboarding" | "Active" | "Moving";

export const SEGMENT_ORDER: PipelineSegment[] = ["Onboarding", "Active", "Moving"];

export const SEGMENT_LABELS: Record<PipelineSegment, string> = {
  Onboarding: "Onboarding",
  Active: "Active",
  Moving: "Moving",
};

export const SEGMENT_HINTS: Record<PipelineSegment, string> = {
  Onboarding: "People currently in onboarding",
  Active: "Active employees",
  Moving: "Planned moves or leaving",
};

type PipelineStatsProps = {
  counts: Record<PipelineSegment, number>;
  unassignedCount: number;
  activeSegment: PipelineSegment;
  onSegmentChange: (segment: PipelineSegment) => void;
  unassignedOnly: boolean;
};

export function PipelineStats({ counts, unassignedCount, activeSegment, onSegmentChange, unassignedOnly }: PipelineStatsProps) {
  return (
    <section className="stats-grid compact" aria-label="Human pipeline stats">
      {SEGMENT_ORDER.map((segment) => {
        const count = counts[segment] ?? 0;
        const isDim = count === 0 && segment !== activeSegment;
        return (
          <button
            key={segment}
            type="button"
            className={`stat-card${activeSegment === segment ? " active" : ""}${isDim ? " empty" : ""}`}
            onClick={() => onSegmentChange(segment)}
            aria-pressed={activeSegment === segment}
            aria-label={`${SEGMENT_LABELS[segment]}: ${count}`}
            title={SEGMENT_HINTS[segment]}
          >
            <strong>{count}</strong>
            <span>{SEGMENT_LABELS[segment]}</span>
          </button>
        );
      })}
      <article
        className={`stat-card read-only unassigned-stat${unassignedOnly ? " active" : ""}`}
        aria-label={`Unassigned: ${unassignedCount}`}
        title="People without an active pod assignment"
      >
        <strong>{unassignedCount}</strong>
        <span>Unassigned</span>
      </article>
    </section>
  );
}
