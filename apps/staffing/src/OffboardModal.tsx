import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { fullName, safeText } from "./helpers";
import type { AssignmentData, PersonData, PodData, Row } from "./types";

type Choice = "leaving" | "leaving_and_open_slot" | "delete";

type OffboardModalProps = {
  open: boolean;
  onClose: () => void;
  person: Row<PersonData> | null;
  assignments: Row<AssignmentData>[];
  pods: Row<PodData>[];
  isMutating: boolean;
  onSubmit: (payload: {
    row_id: string;
    assignment_actions: { row_id: string; choice: Choice }[];
  }) => Promise<boolean>;
};

export function OffboardModal({
  open,
  onClose,
  person,
  assignments,
  pods,
  isMutating,
  onSubmit,
}: OffboardModalProps) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  useEffect(() => {
    if (open && person) {
      const initial: Record<string, Choice> = {};
      for (const a of assignments) {
        if (a.data.person_id === person.id && a.data.status !== "Open") {
          initial[a.id] = "leaving";
        }
      }
      setChoices(initial);
    }
  }, [open, person, assignments]);

  if (!person) return null;

  const personAssignments = assignments.filter(
    (a) => a.data.person_id === person.id && a.data.status !== "Open",
  );

  const handleSubmit = async () => {
    const actions = personAssignments.map((a) => ({
      row_id: a.id,
      choice: choices[a.id] ?? "leaving",
    }));
    const ok = await onSubmit({ row_id: person.id, assignment_actions: actions });
    if (ok) onClose();
  };

  const podName = (id: string | null | undefined) =>
    id ? safeText(pods.find((p) => p.id === id)?.data.pod_name, id) : "Unknown";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Offboard ${fullName(person)}`}
      wide
      footer={
        <>
          <span />
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="danger-button" type="button" onClick={() => void handleSubmit()} disabled={isMutating}>
            Confirm offboard
          </button>
        </>
      }
    >
      <p className="muted small">
        This sets <strong>{fullName(person)}</strong> to Inactive. Choose what to do with each active assignment.
      </p>
      {personAssignments.length === 0 ? (
        <p className="muted small">No active assignments. Confirming will set the person Inactive.</p>
      ) : (
        <table className="offboard-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Role</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {personAssignments.map((a) => (
              <tr key={a.id}>
                <td>{podName(a.data.pod_id)}</td>
                <td>{safeText(a.data.role)}</td>
                <td>{safeText(a.data.status)}</td>
                <td>
                  <select
                    value={choices[a.id] ?? "leaving"}
                    onChange={(event) =>
                      setChoices((current) => ({ ...current, [a.id]: event.target.value as Choice }))
                    }
                  >
                    <option value="leaving">Set Leaving</option>
                    <option value="leaving_and_open_slot">Set Leaving + create open slot</option>
                    <option value="delete">Delete row</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
