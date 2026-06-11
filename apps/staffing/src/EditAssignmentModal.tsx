import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { fullName, safeText } from "./helpers";
import { SearchableSelect } from "./SearchableSelect";
import type { AssignmentData, PersonData, PodData, Row } from "./types";

const ASSIGNMENT_STATUSES = ["Active", "Backup", "Onboarding", "Leaving"];
const ASSIGNMENT_ROLES = ["DS", "FDE", "GTM", "SA"];

type EditAssignmentModalProps = {
  open: boolean;
  onClose: () => void;
  assignment: Row<AssignmentData> | null;
  pods: Row<PodData>[];
  people: Row<PersonData>[];
  isMutating: boolean;
  onSave: (payload: {
    row_id: string;
    pod_id: string;
    role: string;
    status: string;
    person_id: string | null;
    is_primary: boolean;
    notes: string;
    allocation_pct: string;
  }) => Promise<boolean>;
  onDelete: (rowId: string) => Promise<boolean>;
};

export function EditAssignmentModal({
  open,
  onClose,
  assignment,
  pods,
  people,
  isMutating,
  onSave,
  onDelete,
}: EditAssignmentModalProps) {
  const [podId, setPodId] = useState("");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("FDE");
  const [status, setStatus] = useState("Active");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [allocationPct, setAllocationPct] = useState("");

  useEffect(() => {
    if (open && assignment) {
      setPodId(assignment.data.pod_id ?? "");
      setPersonId(assignment.data.person_id ?? "");
      setRole(assignment.data.role ?? "FDE");
      setStatus(assignment.data.status ?? "Active");
      setIsPrimary(Boolean(assignment.data.is_primary));
      setNotes(assignment.data.notes ?? "");
      setAllocationPct(
        assignment.data.allocation_pct != null ? String(assignment.data.allocation_pct) : "",
      );
    }
  }, [open, assignment]);

  const podOptions = useMemo(
    () => pods.map((p) => ({ value: p.id, label: safeText(p.data.pod_name, p.id), hint: p.data.tier ?? undefined })),
    [pods],
  );
  const personOptions = useMemo(
    () => people.map((p) => {
      const noEmail = !p.data.email || !String(p.data.email).trim();
      return {
        value: p.id,
        label: fullName(p),
        hint: noEmail ? "needs email" : undefined,
        disabled: noEmail,
        disabledReason: "Add email to this person before assigning them.",
      };
    }),
    [people],
  );

  if (!assignment) return null;

  const handleSave = async () => {
    const ok = await onSave({
      row_id: assignment.id,
      pod_id: podId,
      role,
      status,
      person_id: status === "Open" ? null : personId || null,
      is_primary: isPrimary,
      notes: notes.trim(),
      allocation_pct: allocationPct.trim(),
    });
    if (ok) onClose();
  };

  const handleDelete = async () => {
    const ok = await onDelete(assignment.id);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit assignment"
      footer={
        <>
          <button className="danger-button" type="button" onClick={() => void handleDelete()} disabled={isMutating}>
            Delete
          </button>
          <span />
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={isMutating}>
            Save
          </button>
        </>
      }
    >
      <label>
        Client
        <SearchableSelect value={podId} onChange={setPodId} options={podOptions} ariaLabel="Client" />
      </label>
      <label>
        Person
        <SearchableSelect value={personId} onChange={setPersonId} options={personOptions} ariaLabel="Person" />
      </label>
      <div className="two-col-form">
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {ASSIGNMENT_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {ASSIGNMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="two-col-form">
        <div className="inline-check">
          <input
            id="edit-assign-primary"
            type="checkbox"
            checked={isPrimary}
            onChange={(event) => setIsPrimary(event.target.checked)}
          />
          <label htmlFor="edit-assign-primary">Primary assignment</label>
        </div>
        <label>
          Allocation %
          <input
            type="number"
            min={0}
            max={100}
            placeholder="auto (split evenly)"
            value={allocationPct}
            onChange={(event) => setAllocationPct(event.target.value)}
          />
        </label>
      </div>
      <label>
        Notes
        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
    </Modal>
  );
}
