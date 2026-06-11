import { SEGMENT_LABELS, SEGMENT_ORDER, type PipelineSegment } from "./PipelineStats";

type PipelineToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  segment: PipelineSegment;
  onSegmentChange: (s: PipelineSegment) => void;
  unassignedOnly: boolean;
  onUnassignedOnlyChange: (v: boolean) => void;
  onNewPerson: () => void;
};

export function PipelineToolbar({
  query,
  onQueryChange,
  segment,
  onSegmentChange,
  unassignedOnly,
  onUnassignedOnlyChange,
  onNewPerson,
}: PipelineToolbarProps) {
  return (
    <div className="pipeline-toolbar">
      <label className="grow">
        Search people
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Name, email, role, client…"
        />
      </label>
      <div className="segmented-control" role="tablist" aria-label="Pipeline segment">
        {SEGMENT_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            className={segment === option ? "active" : ""}
            aria-selected={segment === option}
            onClick={() => onSegmentChange(option)}
          >
            {SEGMENT_LABELS[option]}
          </button>
        ))}
      </div>
      <label className="toggle-pill inline-toggle">
        <input
          type="checkbox"
          checked={unassignedOnly}
          onChange={(event) => onUnassignedOnlyChange(event.target.checked)}
        />
        Unassigned only
      </label>
      <button className="primary-button" type="button" onClick={onNewPerson}>
        + New person
      </button>
    </div>
  );
}
