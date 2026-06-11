import { useEffect, useMemo, useState } from "react";
import {
  availableTiers,
  buildPodSummaries,
  filterPodSummaries,
  podTabStats,
} from "./selectors";
import { ClientCoverageStats } from "./ClientCoverageStats";
import { PodToolbar } from "./PodToolbar";
import { PodList } from "./PodList";
import { PodDetail } from "./PodDetail";
import { PodOverviewGrid } from "./PodOverviewGrid";
import type {
  AgentData,
  AssignableRole,
  AssignmentData,
  FilterKey,
  GoLiveData,
  PersonData,
  PodData,
  Row,
  SortKey,
  WeeklyData,
} from "./types";

type ViewMode = "overview" | "detail";

type ClientCoverageTabProps = {
  pods: Row<PodData>[];
  people: Row<PersonData>[];
  assignments: Row<AssignmentData>[];
  weekly: Row<WeeklyData>[];
  agents: Row<AgentData>[];
  goLives: Row<GoLiveData>[];
  isMutating: boolean;
  selectedPodId: string;
  onSelectPod: (podId: string) => void;
  onNewClient: () => void;
  onAssign: (prefill: { pod_id: string; role: AssignableRole; assignment_row_id?: string }) => void;
  onAddOpenSlot: (podId: string, role: AssignableRole) => void;
  onDeleteAssignment: (assignment: Row<AssignmentData>) => void;
  onEditAssignment: (assignment: Row<AssignmentData>) => void;
  onPlanTransitionForAssignment: (assignment: Row<AssignmentData>) => void;
  onEditPersonTransition: (person: Row<PersonData>) => void;
  onCommitAssignmentStatus: (assignment: Row<AssignmentData>, status: string) => void;
  onCommitAllocationPct: (assignment: Row<AssignmentData>, value: string) => void;
  onCommitWeekly: (podId: string, field: string, value: string) => void;
  onUpdatePod: (podId: string, patch: { pod_name?: string; tier?: string }) => void;
};

export function ClientCoverageTab({
  pods,
  people,
  assignments,
  weekly,
  agents,
  goLives,
  isMutating,
  selectedPodId,
  onSelectPod,
  onNewClient,
  onAssign,
  onAddOpenSlot,
  onDeleteAssignment,
  onEditAssignment,
  onPlanTransitionForAssignment,
  onEditPersonTransition,
  onCommitAssignmentStatus,
  onCommitAllocationPct,
  onCommitWeekly,
  onUpdatePod,
}: ClientCoverageTabProps) {
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("tier");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [detailQuery, setDetailQuery] = useState("");

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const summaries = useMemo(
    () => buildPodSummaries(pods, assignments, people, weekly),
    [pods, assignments, people, weekly],
  );

  const tiers = useMemo(() => availableTiers(pods), [pods]);

  const filtered = useMemo(
    () => filterPodSummaries(summaries, { query, tierFilter, filter, sort, peopleById }),
    [summaries, query, tierFilter, filter, sort, peopleById],
  );

  const detailFiltered = useMemo(() => {
    const q = detailQuery.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((s) => {
      const name = String(s.pod.data.pod_name ?? s.pod.id).toLowerCase();
      const tier = String(s.pod.data.tier ?? "").toLowerCase();
      return name.includes(q) || tier.includes(q);
    });
  }, [filtered, detailQuery]);

  const stats = useMemo(() => podTabStats(pods, summaries), [pods, summaries]);

  const selectedSummary = useMemo(
    () => summaries.find((s) => s.pod.id === selectedPodId),
    [summaries, selectedPodId],
  );

  useEffect(() => {
    if (viewMode === "detail" && !selectedSummary) {
      setViewMode("overview");
    }
  }, [viewMode, selectedSummary]);

  const handleSelectFromOverview = (podId: string) => {
    onSelectPod(podId);
    setViewMode("detail");
  };

  return (
    <>
      <ClientCoverageStats
        total={stats.total}
        staffed={stats.staffed}
        gaps={stats.gaps}
        openSlots={stats.openSlots}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      {viewMode === "overview" ? (
        <>
          <PodToolbar
            query={query}
            onQueryChange={setQuery}
            tierFilter={tierFilter}
            onTierChange={setTierFilter}
            availableTiers={tiers}
            filter={filter}
            onFilterChange={setFilter}
            sort={sort}
            onSortChange={setSort}
            onNewClient={onNewClient}
          />
          <PodOverviewGrid
            summaries={filtered}
            peopleById={peopleById}
            allAssignments={assignments}
            pods={pods}
            onSelect={handleSelectFromOverview}
          />
        </>
      ) : (
        <>
          <div className="detail-mode-header">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setViewMode("overview")}
              aria-label="Back to overview"
            >
              ← Back to overview
            </button>
          </div>
          <section className="coverage-layout">
            <aside className="left-panel">
              <div className="left-panel-search">
                <input
                  type="search"
                  placeholder="Search clients…"
                  value={detailQuery}
                  onChange={(event) => setDetailQuery(event.target.value)}
                  aria-label="Search clients"
                />
              </div>
              <PodList
                summaries={detailFiltered}
                selectedPodId={selectedSummary?.pod.id}
                onSelect={onSelectPod}
              />
            </aside>
            <div className="coverage-main">
              <PodDetail
                summary={selectedSummary}
                pods={pods}
                people={people}
                assignments={assignments}
                agents={agents}
                goLives={goLives}
                peopleById={peopleById}
                onAssign={onAssign}
                onAddOpenSlot={onAddOpenSlot}
                onDeleteAssignment={onDeleteAssignment}
                onEditAssignment={onEditAssignment}
                onPlanTransitionForAssignment={onPlanTransitionForAssignment}
                onEditPersonTransition={onEditPersonTransition}
                onCommitAssignmentStatus={onCommitAssignmentStatus}
                onCommitAllocationPct={onCommitAllocationPct}
                onCommitWeekly={onCommitWeekly}
                onUpdatePod={onUpdatePod}
                busy={isMutating}
              />
            </div>
          </section>
        </>
      )}
    </>
  );
}
