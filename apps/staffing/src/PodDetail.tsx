import { useMemo } from "react";
import { availableTiers, transitionsForPod } from "./selectors";
import { InlineEditField } from "./InlineEditField";
import { RosterSection } from "./RosterSection";
import { GapsSection } from "./GapsSection";
import { TransitionsSection } from "./TransitionsSection";
import { ThisWeekSection } from "./ThisWeekSection";
import { AgentsSection } from "./AgentsSection";
import { EmptyState } from "./EmptyState";
import { safeText, tierClass } from "./helpers";
import type {
  AgentData,
  AssignableRole,
  AssignmentData,
  GoLiveData,
  PersonData,
  PodData,
  PodSummary,
  Row,
} from "./types";

const TIER_OPTIONS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Strategic"];

function assignmentRoleToAssignable(role?: string | null): AssignableRole {
  const text = String(role ?? "").trim().toLowerCase();
  if (text === "ds") return "DS";
  if (text === "gtm") return "GTM";
  if (text === "sa") return "SA";
  return "FDE";
}

type PodDetailProps = {
  summary: PodSummary | undefined;
  pods: Row<PodData>[];
  people: Row<PersonData>[];
  assignments: Row<AssignmentData>[];
  agents: Row<AgentData>[];
  goLives: Row<GoLiveData>[];
  peopleById: Map<string, Row<PersonData>>;
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
  busy?: boolean;
};

export function PodDetail({
  summary,
  pods,
  people,
  assignments,
  agents,
  goLives,
  peopleById,
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
  busy,
}: PodDetailProps) {
  const tierOptions = useMemo(() => {
    const set = new Set<string>([...TIER_OPTIONS, ...availableTiers(pods)]);
    return [...set].filter((t) => t && t !== "Unspecified");
  }, [pods]);
  const transitions = useMemo(
    () => (summary ? transitionsForPod(summary.pod.id, people, assignments) : { incoming: [], outgoing: [] }),
    [summary, people, assignments],
  );

  const podAgents = useMemo(
    () => (summary ? agents.filter((a) => a.data.pod_id === summary.pod.id) : []),
    [summary, agents],
  );

  const podGoLives = useMemo(
    () => (summary ? goLives.filter((g) => g.data.pod_id === summary.pod.id) : []),
    [summary, goLives],
  );

  if (!summary) {
    return (
      <section className="detail-panel">
        <EmptyState title="Select a client" description="Choose a client from the list to see coverage." />
      </section>
    );
  }

  return (
    <section className={`detail-panel ${tierClass(summary.pod.data.tier)}`}>
      <header className="detail-header">
        <div className="detail-header-fields">
          <p className="eyebrow">Selected client</p>
          <div className="detail-header-name">
            <InlineEditField
              kind="text"
              value={safeText(summary.pod.data.pod_name, summary.pod.id)}
              onCommit={(value) => onUpdatePod(summary.pod.id, { pod_name: value })}
              ariaLabel="Client name"
            />
          </div>
          <div className="detail-header-meta">
            <span className={`tier-tag ${tierClass(summary.pod.data.tier)}`}>
              <InlineEditField
                kind="select"
                value={safeText(summary.pod.data.tier, "Tier 3")}
                options={tierOptions.map((t) => ({ value: t, label: t }))}
                onCommit={(value) => onUpdatePod(summary.pod.id, { tier: value })}
                ariaLabel="Tier"
              />
            </span>
            <span className="muted small">
              · {summary.assignments.length} assignment row{summary.assignments.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </header>

      <RosterSection
        summary={summary}
        peopleById={peopleById}
        onFillSlot={(assignment) =>
          onAssign({
            pod_id: summary.pod.id,
            role: assignmentRoleToAssignable(assignment.data.role),
            assignment_row_id: assignment.id,
          })
        }
        onEditAssignment={onEditAssignment}
        onDeleteAssignment={onDeleteAssignment}
        onPlanTransition={onPlanTransitionForAssignment}
        onCommitStatus={onCommitAssignmentStatus}
        onCommitAllocationPct={onCommitAllocationPct}
        onAddPerson={(role) => onAssign({ pod_id: summary.pod.id, role })}
        onAddOpenSlot={(role) => onAddOpenSlot(summary.pod.id, role)}
        busy={busy}
      />

      <AgentsSection agents={podAgents} goLives={podGoLives} />

      <GapsSection
        summary={summary}
        people={people}
        pods={pods}
        onAssignDs={() => onAssign({ pod_id: summary.pod.id, role: "DS" })}
        onAssignFde={() => onAssign({ pod_id: summary.pod.id, role: "FDE" })}
        onFillExistingSlot={(assignment) =>
          onAssign({
            pod_id: summary.pod.id,
            role: assignmentRoleToAssignable(assignment.data.role),
            assignment_row_id: assignment.id,
          })
        }
      />

      <TransitionsSection
        transitions={transitions}
        pods={pods}
        currentPodId={summary.pod.id}
        onEditPerson={onEditPersonTransition}
      />

      <ThisWeekSection
        summary={summary}
        onCommitWeekly={(field, value) => onCommitWeekly(summary.pod.id, field, value)}
      />
    </section>
  );
}
