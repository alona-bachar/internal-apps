import { AssignmentCard } from "./AssignmentCard";
import { EmptyState } from "./EmptyState";
import type { AssignableRole, AssignmentData, PersonData, PodSummary, Row } from "./types";

function sortFilledFirst(assignments: Row<AssignmentData>[]): Row<AssignmentData>[] {
  const filled: Row<AssignmentData>[] = [];
  const open: Row<AssignmentData>[] = [];
  for (const a of assignments) {
    if (a.data.person_id && a.data.status !== "Open") filled.push(a);
    else open.push(a);
  }
  return [...filled, ...open];
}

type RosterSectionProps = {
  summary: PodSummary;
  peopleById: Map<string, Row<PersonData>>;
  onFillSlot: (assignment: Row<AssignmentData>) => void;
  onEditAssignment: (assignment: Row<AssignmentData>) => void;
  onDeleteAssignment: (assignment: Row<AssignmentData>) => void;
  onPlanTransition: (assignment: Row<AssignmentData>) => void;
  onCommitStatus: (assignment: Row<AssignmentData>, status: string) => void;
  onCommitAllocationPct: (assignment: Row<AssignmentData>, value: string) => void;
  onAddPerson: (role: AssignableRole) => void;
  onAddOpenSlot: (role: AssignableRole) => void;
  busy?: boolean;
};

export function RosterSection({
  summary,
  peopleById,
  onFillSlot,
  onEditAssignment,
  onDeleteAssignment,
  onPlanTransition,
  onCommitStatus,
  onCommitAllocationPct,
  onAddPerson,
  onAddOpenSlot,
  busy,
}: RosterSectionProps) {
  const fdeAssignments = [...summary.fde, ...summary.externalFde];
  return (
    <section className="pod-detail-section">
      <header className="section-header-row">
        <div>
          <p className="eyebrow">Roster</p>
          <h3>Coverage</h3>
        </div>
      </header>
      <div className="coverage-grid">
        <RosterColumn
          title="Deployment Strategists"
          subtitle="Primary DS coverage"
          count={summary.ds.length}
          role="DS"
          assignments={summary.ds}
          peopleById={peopleById}
          emptyTitle="No DS assigned yet."
          onAddPerson={() => onAddPerson("DS")}
          onAddOpenSlot={() => onAddOpenSlot("DS")}
          onFill={onFillSlot}
          onEdit={onEditAssignment}
          onDelete={onDeleteAssignment}
          onPlanTransition={onPlanTransition}
          onCommitStatus={onCommitStatus}
          onCommitAllocationPct={onCommitAllocationPct}
          busy={busy}
        />
        <RosterColumn
          title="FDE coverage"
          subtitle="Internal and external FDEs"
          count={fdeAssignments.length}
          role="FDE"
          assignments={fdeAssignments}
          peopleById={peopleById}
          emptyTitle="No FDE assigned yet."
          onAddPerson={() => onAddPerson("FDE")}
          onAddOpenSlot={() => onAddOpenSlot("FDE")}
          onFill={onFillSlot}
          onEdit={onEditAssignment}
          onDelete={onDeleteAssignment}
          onPlanTransition={onPlanTransition}
          onCommitStatus={onCommitStatus}
          onCommitAllocationPct={onCommitAllocationPct}
          busy={busy}
        />
        <RosterColumn
          title="Go-to-market"
          subtitle="Primary GTM coverage"
          count={summary.gtm.length}
          role="GTM"
          assignments={summary.gtm}
          peopleById={peopleById}
          emptyTitle="No GTM assigned yet."
          onAddPerson={() => onAddPerson("GTM")}
          onAddOpenSlot={() => onAddOpenSlot("GTM")}
          onFill={onFillSlot}
          onEdit={onEditAssignment}
          onDelete={onDeleteAssignment}
          onPlanTransition={onPlanTransition}
          onCommitStatus={onCommitStatus}
          onCommitAllocationPct={onCommitAllocationPct}
          busy={busy}
        />
        <RosterColumn
          title="Solution Architects"
          subtitle="Primary SA coverage"
          count={summary.sa.length}
          role="SA"
          assignments={summary.sa}
          peopleById={peopleById}
          emptyTitle="No SA assigned yet."
          onAddPerson={() => onAddPerson("SA")}
          onAddOpenSlot={() => onAddOpenSlot("SA")}
          onFill={onFillSlot}
          onEdit={onEditAssignment}
          onDelete={onDeleteAssignment}
          onPlanTransition={onPlanTransition}
          onCommitStatus={onCommitStatus}
          onCommitAllocationPct={onCommitAllocationPct}
          busy={busy}
        />
      </div>
    </section>
  );
}

function RosterColumn({
  title,
  subtitle,
  count,
  role,
  assignments,
  peopleById,
  emptyTitle,
  onAddPerson,
  onAddOpenSlot,
  onFill,
  onEdit,
  onDelete,
  onPlanTransition,
  onCommitStatus,
  onCommitAllocationPct,
  busy,
}: {
  title: string;
  subtitle: string;
  count: number;
  role: AssignableRole;
  assignments: Row<AssignmentData>[];
  peopleById: Map<string, Row<PersonData>>;
  emptyTitle: string;
  onAddPerson: () => void;
  onAddOpenSlot: () => void;
  onFill: (a: Row<AssignmentData>) => void;
  onEdit: (a: Row<AssignmentData>) => void;
  onDelete: (a: Row<AssignmentData>) => void;
  onPlanTransition: (a: Row<AssignmentData>) => void;
  onCommitStatus: (a: Row<AssignmentData>, status: string) => void;
  onCommitAllocationPct: (a: Row<AssignmentData>, value: string) => void;
  busy?: boolean;
}) {
  return (
    <section className="role-tab-panel">
      <header className="role-tab-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="role-tab-actions">
          <span className="chip neutral" aria-label={`${count} ${title}`}>{count}</span>
          <button
            type="button"
            className="secondary-button small"
            onClick={onAddPerson}
            title={`Assign a ${role}`}
          >
            + {role}
          </button>
          <button
            type="button"
            className="ghost-button small"
            onClick={onAddOpenSlot}
            title={`Add an open ${role} slot (no person yet)`}
          >
            + Open
          </button>
        </div>
      </header>
      <div className="role-tab-list">
        {assignments.length ? (
          sortFilledFirst(assignments).map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              person={assignment.data.person_id ? peopleById.get(assignment.data.person_id) : undefined}
              onFill={() => onFill(assignment)}
              onEdit={() => onEdit(assignment)}
              onDelete={() => onDelete(assignment)}
              onPlanTransition={() => onPlanTransition(assignment)}
              onCommitStatus={(status) => onCommitStatus(assignment, status)}
              onCommitAllocationPct={(value) => onCommitAllocationPct(assignment, value)}
              disabled={busy}
            />
          ))
        ) : (
          <EmptyState compact title={emptyTitle} />
        )}
      </div>
    </section>
  );
}
