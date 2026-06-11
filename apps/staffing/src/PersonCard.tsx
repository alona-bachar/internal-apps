import { fullName, isExternalFdeRole, isFullyCertified, isMoveStatus, isOnboardingStatus, isVacationActive, roleShort, safeText, toDateInput } from "./helpers";
import { Chip } from "./Chip";
import { InlineEditField } from "./InlineEditField";
import { MissingEmailWarning } from "./MissingEmailWarning";
import { CertProgressDots } from "./CertProgressDots";
import type { AssignmentData, PersonData, PodData, Row } from "./types";

const PERSON_STATUSES = ["Active", "Onboarding", "Move to other client", "Leaving"];

type PersonCardProps = {
  person: Row<PersonData>;
  attachments: Row<AssignmentData>[];
  pods: Row<PodData>[];
  onEdit: () => void;
  onCommitStatus: (status: string) => void;
  onCommitField: (field: keyof PersonData, value: string) => void;
  onAssign: () => void;
  onPlanTransition: () => void;
  onOffboard: () => void;
  onReactivate: () => void;
  onGraduate?: () => void;
  onDelete: () => void;
};

export function PersonCard({
  person,
  attachments,
  pods,
  onEdit,
  onCommitStatus,
  onCommitField,
  onAssign,
  onPlanTransition,
  onOffboard,
  onReactivate,
  onGraduate,
  onDelete,
}: PersonCardProps) {
  const hasEmail = Boolean(person.data.email && String(person.data.email).trim());
  const status = person.data.status ?? "Active";
  const isInactive = status === "Inactive";
  const isLeaving = status === "Leaving";
  const isOnboarding = isOnboardingStatus(status);
  const isMoving = isMoveStatus(status);
  const isExternal = isExternalFdeRole(person.data.role);
  const ooo = isVacationActive(person.data.vacation_until ?? undefined, person.data.vacation_from ?? undefined);

  const podName = (id: string | null | undefined) => {
    if (!id) return null;
    const pod = pods.find((p) => p.id === id);
    return safeText(pod?.data.pod_name, id);
  };

  return (
    <article className={`pipeline-card status-${status.replace(/\s+/g, "-").toLowerCase()}`}>
      <header className="pipeline-card-header">
        <div className="pipeline-card-identity">
          <div className="pipeline-card-name-row">
            <strong>{fullName(person)}</strong>
            {isExternal ? <Chip tone="neutral">External</Chip> : null}
            {ooo ? <Chip tone="warning">OOO</Chip> : null}
          </div>
          <span className="muted">
            {hasEmail ? safeText(person.data.email) : <em>no email</em>} · {roleShort(person.data.role)}
          </span>
          <span className="muted small">
            {attachments.length === 0
              ? "No client attached"
              : `Attached to ${attachments.map((a) => podName(a.data.pod_id) ?? "Unknown").join(", ")}`}
          </span>
        </div>
        <div className="pipeline-card-actions">
          {!hasEmail ? <MissingEmailWarning /> : null}
          <button className="secondary-button small" type="button" onClick={onEdit}>
            Edit
          </button>
          <button className="danger-button small" type="button" onClick={onDelete} title="Delete person">
            Delete
          </button>
        </div>
      </header>

      <div className="pipeline-card-row">
        <InlineEditField
          kind="select"
          label="Status"
          value={status}
          options={PERSON_STATUSES.map((s) => ({ value: s, label: s }))}
          onCommit={onCommitStatus}
          disabled={isInactive}
          disabledReason="Reactivate first to change status"
        />
        {isInactive ? <Chip tone="neutral">Inactive</Chip> : null}
        {isLeaving ? <Chip tone="warning">Leaving</Chip> : null}
        {isMoving ? <Chip tone="warning">Moving</Chip> : null}
      </div>

      {isOnboarding ? (
        <section className="pipeline-card-section">
          <InlineEditField
            kind="date"
            label="Expected start"
            value={toDateInput(person.data.expected_start_date)}
            onCommit={(v) => onCommitField("expected_start_date", v)}
          />
          <CertProgressDots
            person={person}
            disabled={!hasEmail}
            disabledReason="Add email to this person before editing certification."
            onEdit={onEdit}
          />
        </section>
      ) : null}

      {isMoving ? (
        <section className="pipeline-card-section">
          <div className="two-col-form">
            <label>
              Target client
              <select
                defaultValue={person.data.move_to_pod_id ?? ""}
                onBlur={(event) => onCommitField("move_to_pod_id", event.currentTarget.value)}
              >
                <option value="">Choose client</option>
                {pods.map((p) => (
                  <option key={p.id} value={p.id}>{safeText(p.data.pod_name, p.id)}</option>
                ))}
              </select>
            </label>
            <InlineEditField
              kind="date"
              label="Move date"
              value={toDateInput(person.data.move_date)}
              onCommit={(v) => onCommitField("move_date", v)}
            />
          </div>
          <div className="pipeline-card-actions-row">
            <button className="secondary-button small" type="button" onClick={onPlanTransition}>
              Replace transition
            </button>
            <button className="ghost-button small" type="button" onClick={onOffboard}>
              Offboard
            </button>
          </div>
        </section>
      ) : null}

      {isLeaving ? (
        <section className="pipeline-card-section">
          <p className="muted small">Marked Leaving — confirm offboarding when ready.</p>
          <button className="secondary-button small" type="button" onClick={onOffboard}>
            Offboard now
          </button>
        </section>
      ) : null}

      {!isInactive && !isLeaving && !isMoving && !isOnboarding ? (
        <section className="pipeline-card-actions-row">
          <button className="primary-button small" type="button" onClick={onPlanTransition}>
            Plan transition
          </button>
          <button className="secondary-button small" type="button" onClick={onAssign} disabled={!hasEmail}>
            Assign to pod
          </button>
          <button className="ghost-button small" type="button" onClick={onOffboard}>
            Offboard
          </button>
        </section>
      ) : null}

      {isOnboarding ? (
        <section className="pipeline-card-actions-row">
          {isFullyCertified(person.data) && onGraduate ? (
            <button className="primary-button small graduate" type="button" onClick={onGraduate}>
              🎓 Graduate to Active
            </button>
          ) : null}
          <button className="secondary-button small" type="button" onClick={onAssign} disabled={!hasEmail}>
            Assign to pod
          </button>
          <button className="ghost-button small" type="button" onClick={onPlanTransition}>
            Plan transition
          </button>
        </section>
      ) : null}

      {isInactive ? (
        <section className="pipeline-card-section">
          <p className="muted small">This person is inactive. Click Reactivate to set them back to Active.</p>
          <button className="primary-button small" type="button" onClick={onReactivate}>
            Reactivate
          </button>
        </section>
      ) : null}
    </article>
  );
}
