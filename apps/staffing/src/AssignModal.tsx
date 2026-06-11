import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { fullName, roleShort, safeText } from "./helpers";
import { SearchableSelect } from "./SearchableSelect";
import type { AssignableRole, Row, PersonData, PodData, AssignmentData } from "./types";

const ASSIGNMENT_STATUSES = ["Active", "Backup", "Onboarding", "Leaving"];
const ASSIGNMENT_ROLES: AssignableRole[] = ["DS", "FDE", "GTM", "SA"];

export type AssignPrefill = {
  pod_id?: string;
  role?: AssignableRole;
  assignment_row_id?: string;
  person_id?: string;
};

type AssignModalProps = {
  open: boolean;
  onClose: () => void;
  prefill: AssignPrefill;
  pods: Row<PodData>[];
  people: Row<PersonData>[];
  isMutating: boolean;
  onSubmit: (payload: {
    assignment_row_id?: string;
    pod_id: string;
    role: string;
    status: string;
    person_id: string;
    is_primary: boolean;
    notes: string;
    allocation_pct: string;
  }) => Promise<Row<AssignmentData> | null>;
  onRequestNewPerson: (returnPrefill: AssignPrefill & { role: AssignableRole; pod_id: string }) => void;
};

export function AssignModal({ open, onClose, prefill, pods, people, isMutating, onSubmit, onRequestNewPerson }: AssignModalProps) {
  const [podId, setPodId] = useState("");
  const [role, setRole] = useState<AssignableRole>("FDE");
  const [personId, setPersonId] = useState("");
  const [status, setStatus] = useState("Active");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [allocationPct, setAllocationPct] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPodId(prefill.pod_id ?? pods[0]?.id ?? "");
      setRole(prefill.role ?? "FDE");
      setPersonId(prefill.person_id ?? "");
      setStatus("Active");
      setIsPrimary(false);
      setNotes("");
      setAllocationPct("");
      setError(null);
    }
  }, [open, prefill, pods]);

  const targetPerson = people.find((p) => p.id === personId);
  const targetHasEmail = !targetPerson || Boolean(targetPerson.data.email && String(targetPerson.data.email).trim());
  const canSubmit = Boolean(podId) && Boolean(personId) && targetHasEmail;

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
        hint: `${roleShort(p.data.role)}${noEmail ? " · needs email" : ""}`,
        disabled: noEmail,
        disabledReason: "Add email to this person before assigning them.",
      };
    }),
    [people],
  );

  const handleSubmit = async () => {
    if (!podId) { setError("Choose a client."); return; }
    if (!personId) { setError("Choose a person."); return; }
    if (!targetHasEmail) {
      setError("Add email to this person before assigning them to a pod.");
      return;
    }
    setError(null);
    const result = await onSubmit({
      assignment_row_id: prefill.assignment_row_id,
      pod_id: podId,
      role,
      status,
      person_id: personId,
      is_primary: isPrimary,
      notes: notes.trim(),
      allocation_pct: allocationPct.trim(),
    });
    if (result) onClose();
  };

  const handlePersonChange = (value: string) => {
    if (value === "__new") {
      onRequestNewPerson({
        ...prefill,
        pod_id: podId || prefill.pod_id || pods[0]?.id || "",
        role,
      });
      return;
    }
    setPersonId(value);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prefill.assignment_row_id ? "Fill open slot" : "Assign person to pod"}
      wide
      footer={
        <>
          <span />
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isMutating || !canSubmit}
          >
            {prefill.assignment_row_id ? "Fill slot" : "Assign"}
          </button>
        </>
      }
    >
      {error ? <p className="alert danger small">{error}</p> : null}
      <div className="two-col-form">
        <label>
          Client
          <SearchableSelect
            value={podId}
            onChange={setPodId}
            options={podOptions}
            placeholder="Choose client"
            emptyOption={{ value: "", label: "Choose client" }}
            ariaLabel="Client"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as AssignableRole)}>
            {ASSIGNMENT_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </div>
      <div className="two-col-form">
        <label>
          Person
          <SearchableSelect
            value={personId}
            onChange={handlePersonChange}
            options={personOptions}
            placeholder="Choose person"
            emptyOption={{ value: "", label: "Choose person" }}
            extraTopOption={{ value: "__new", label: "+ Create new person…" }}
            ariaLabel="Person"
          />
          {personId && !targetHasEmail ? (
            <span className="muted tiny danger">This person needs an email before being assigned.</span>
          ) : null}
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
            id="assign-primary"
            type="checkbox"
            checked={isPrimary}
            onChange={(event) => setIsPrimary(event.target.checked)}
          />
          <label htmlFor="assign-primary">Primary assignment</label>
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
