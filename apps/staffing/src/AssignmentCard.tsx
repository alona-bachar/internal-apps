import { fullName, isExternalFdeRole, roleShort, safeText } from "./helpers";
import { Chip } from "./Chip";
import { InlineEditField } from "./InlineEditField";
import type { AssignmentData, PersonData, Row } from "./types";

const ASSIGNMENT_STATUSES = ["Active", "Backup", "Onboarding", "Leaving", "Open"];

function statusTone(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("open")) return "danger";
  if (normalized.includes("onboarding") || normalized.includes("leaving")) return "warning";
  return "neutral";
}

type AssignmentCardProps = {
  assignment: Row<AssignmentData>;
  person?: Row<PersonData>;
  onEdit: () => void;
  onFill: () => void;
  onDelete?: () => void;
  onPlanTransition?: () => void;
  onCommitStatus: (status: string) => void;
  onCommitAllocationPct?: (value: string) => void;
  disabled?: boolean;
};

export function AssignmentCard({
  assignment,
  person,
  onEdit,
  onFill,
  onDelete,
  onPlanTransition,
  onCommitStatus,
  onCommitAllocationPct,
  disabled,
}: AssignmentCardProps) {
  const isOpen = assignment.data.status === "Open" || !assignment.data.person_id;

  if (isOpen) {
    const role = assignment.data.role ?? "FDE";
    const raw = assignment.data.allocation_pct;
    const pct = typeof raw === "number" && Number.isFinite(raw) ? raw : 100;
    return (
      <div className={`chair-row role-${role.toLowerCase()}`}>
        <button
          type="button"
          className={`chair empty role-${role.toLowerCase()}`}
          onClick={onFill}
          aria-label={`Open ${role} slot — click to fill`}
          title={safeText(assignment.data.notes, "Open slot — click to fill")}
        >
          <span className="chair-label">Open {role}</span>
        </button>
        {onCommitAllocationPct ? (
          <label className="chair-pct" title="Edit how much coverage is needed">
            <InlineEditField
              kind="number"
              value={String(pct)}
              onCommit={onCommitAllocationPct}
              disabled={disabled}
              ariaLabel="Open slot allocation percent"
            />
            <span className="muted small">%</span>
          </label>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            className="chair-delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Delete this open slot"
            title="Delete this open slot"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  const external = isExternalFdeRole(person?.data.role);
  const onLeave = String(assignment.data.status ?? "").toLowerCase() === "leaving";

  return (
    <article className={`assignment-card${onLeave ? " is-leaving" : ""}`}>
      <div className="assignment-main">
        <div className="assignment-identity">
          <strong>{fullName(person)}</strong>
          <span>
            {roleShort(person?.data.role)}
            {external ? " · External" : ""}
            {" · "}
            {safeText(person?.data.email)}
          </span>
        </div>
        <div className="assignment-actions">
          {onPlanTransition ? (
            <button
              type="button"
              className="ghost-button small"
              onClick={onPlanTransition}
              aria-label={`Plan transition for ${fullName(person)}`}
              title="Plan transition"
            >
              ⇄
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={onEdit}
            aria-label={`Edit assignment for ${fullName(person)}`}
          >
            ⋯
          </button>
        </div>
      </div>
      <div className="chip-row">
        <InlineEditField
          kind="select"
          value={assignment.data.status ?? "Active"}
          options={ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: s }))}
          onCommit={onCommitStatus}
          disabled={disabled}
          ariaLabel="Assignment status"
        />
        {onCommitAllocationPct ? (
          <label className="assignment-pct" title="Allocation % for this assignment (blank = auto)">
            <InlineEditField
              kind="number"
              value={
                typeof assignment.data.allocation_pct === "number"
                  ? String(assignment.data.allocation_pct)
                  : ""
              }
              placeholder="auto"
              onCommit={onCommitAllocationPct}
              disabled={disabled}
              ariaLabel="Allocation percent"
            />
            <span className="muted small">%</span>
          </label>
        ) : null}
        {onLeave ? <Chip tone="warning">Leaving</Chip> : null}
        {external ? <Chip tone="neutral">External</Chip> : null}
      </div>
    </article>
  );
}

export function statusToneFromAssignment(status: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  return statusTone(status) as "success" | "warning" | "danger" | "neutral";
}
