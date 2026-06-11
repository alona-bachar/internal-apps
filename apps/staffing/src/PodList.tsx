import { safeText } from "./helpers";
import { EmptyState } from "./EmptyState";
import type { PodSummary } from "./types";

type PodListProps = {
  summaries: PodSummary[];
  selectedPodId: string | undefined;
  onSelect: (podId: string) => void;
};

export function PodList({ summaries, selectedPodId, onSelect }: PodListProps) {
  if (!summaries.length) {
    return <EmptyState compact title="No clients match the current filters." />;
  }
  return (
    <div className="pod-list" role="listbox" aria-label="Clients">
      {summaries.map((summary) => (
        <PodListRow
          key={summary.pod.id}
          summary={summary}
          selected={selectedPodId === summary.pod.id}
          onSelect={() => onSelect(summary.pod.id)}
        />
      ))}
    </div>
  );
}

function PodListRow({
  summary,
  selected,
  onSelect,
}: {
  summary: PodSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const fdeTotal = summary.fde.length + summary.externalFde.length;
  const filledDs = summary.ds.filter((a) => a.data.person_id && a.data.status !== "Open").length;
  const filledFde = [...summary.fde, ...summary.externalFde].filter(
    (a) => a.data.person_id && a.data.status !== "Open",
  ).length;
  const gapText = summary.gapCount ? `${Math.round(summary.gapCount)}% gap` : "OK";
  return (
    <button
      type="button"
      className={`pod-row${selected ? " selected" : ""}`}
      onClick={onSelect}
      role="option"
      aria-selected={selected}
    >
      <span>
        <strong>{safeText(summary.pod.data.pod_name, summary.pod.id)}</strong>
        <small>
          {safeText(summary.pod.data.tier)} · {filledDs}/{summary.ds.length || 1} DS · {filledFde}/
          {fdeTotal || 1} FDE
        </small>
      </span>
      <span className="pod-row-signals">
        <span className={`dot ${summary.gapCount ? "danger-dot" : "success-dot"}`} aria-hidden />
        {gapText}
      </span>
    </button>
  );
}
