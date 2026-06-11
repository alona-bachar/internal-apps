import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { fullName, safeText, toDateInput } from "./helpers";
import { SearchableSelect } from "./SearchableSelect";
import type { AssignmentData, PersonData, PodData, Row } from "./types";

type PlanTransitionModalProps = {
  open: boolean;
  onClose: () => void;
  person: Row<PersonData> | null;
  pods: Row<PodData>[];
  assignments: Row<AssignmentData>[];
  isMutating: boolean;
  onSubmit: (payload: {
    row_id: string;
    target_pod_id: string;
    move_date: string;
    create_open_slot: boolean;
    source_pod_id?: string;
    source_role?: string;
  }) => Promise<boolean>;
};

export function PlanTransitionModal({
  open,
  onClose,
  person,
  pods,
  assignments,
  isMutating,
  onSubmit,
}: PlanTransitionModalProps) {
  const [targetPodId, setTargetPodId] = useState("");
  const [moveDate, setMoveDate] = useState("");
  const [createOpenSlot, setCreateOpenSlot] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && person) {
      setTargetPodId(person.data.move_to_pod_id ?? "");
      setMoveDate(toDateInput(person.data.move_date));
      setCreateOpenSlot(true);
      setError(null);
    }
  }, [open, person]);

  const podOptions = useMemo(
    () => pods.map((p) => ({ value: p.id, label: safeText(p.data.pod_name, p.id), hint: p.data.tier ?? undefined })),
    [pods],
  );

  if (!person) return null;

  const activeAssignment = assignments.find(
    (a) => a.data.person_id === person.id && a.data.status !== "Open",
  );
  const sourcePodId = activeAssignment?.data.pod_id ?? "";
  const sourceRole = activeAssignment?.data.role ?? "FDE";
  const sourcePodName = sourcePodId
    ? safeText(pods.find((p) => p.id === sourcePodId)?.data.pod_name, sourcePodId)
    : null;

  const existingTransition =
    person.data.move_to_pod_id && person.data.move_to_pod_id !== targetPodId
      ? safeText(pods.find((p) => p.id === person.data.move_to_pod_id)?.data.pod_name, person.data.move_to_pod_id)
      : null;

  const handleSubmit = async () => {
    if (!targetPodId) { setError("Choose a target client."); return; }
    if (!moveDate) { setError("Pick a move date."); return; }
    setError(null);
    const ok = await onSubmit({
      row_id: person.id,
      target_pod_id: targetPodId,
      move_date: moveDate,
      create_open_slot: createOpenSlot && Boolean(sourcePodId),
      source_pod_id: sourcePodId || undefined,
      source_role: sourceRole,
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Plan transition for ${fullName(person)}`}
      wide
      footer={
        <>
          <span />
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={isMutating}>
            {person.data.move_to_pod_id ? "Update transition" : "Plan transition"}
          </button>
        </>
      }
    >
      {existingTransition ? (
        <p className="alert warning small">
          A transition is already planned to <strong>{existingTransition}</strong>. Submitting will replace it.
        </p>
      ) : null}
      {error ? <p className="alert danger small">{error}</p> : null}
      <div className="two-col-form">
        <label>
          Target client
          <SearchableSelect
            value={targetPodId}
            onChange={setTargetPodId}
            options={podOptions}
            placeholder="Choose client"
            emptyOption={{ value: "", label: "Choose client" }}
            ariaLabel="Target client"
          />
        </label>
        <label>
          Move date
          <input type="date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} />
        </label>
      </div>
      {sourcePodId ? (
        <div className="inline-check">
          <input
            id="create-open-slot"
            type="checkbox"
            checked={createOpenSlot}
            onChange={(event) => setCreateOpenSlot(event.target.checked)}
          />
          <label htmlFor="create-open-slot">
            Also create an open <strong>{sourceRole}</strong> slot at <strong>{sourcePodName}</strong> as a backfill.
          </label>
        </div>
      ) : (
        <p className="muted small">No active assignment found — no backfill open slot will be created.</p>
      )}
    </Modal>
  );
}
