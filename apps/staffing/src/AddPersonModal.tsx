import { useState } from "react";
import { Modal } from "./Modal";
import type { Row, PersonData } from "./types";

const PERSON_ROLES = [
  "Deployment Strategist",
  "Forward Deployed Engineer",
  "External Forward Deployed Engineer",
  "Forward Deployed Engineer - Solution",
  "Field CTO, Israel",
  "GTM",
  "Solution Architect",
];
const PERSON_STATUSES = ["Active", "Onboarding", "Move to other client", "Leaving"];

type AddPersonModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: {
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    status: string;
  }) => Promise<Row<PersonData> | null>;
  onCreated: (person: Row<PersonData>) => void;
  isMutating: boolean;
};

export function AddPersonModal({ open, onClose, onSubmit, onCreated, isMutating }: AddPersonModalProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Forward Deployed Engineer");
  const [status, setStatus] = useState("Active");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("Forward Deployed Engineer");
    setStatus("Active");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }
    setError(null);
    const created = await onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      role,
      status,
    });
    if (created) {
      onCreated(created);
      reset();
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add new person"
      footer={
        <>
          <span />
          <button className="secondary-button" type="button" onClick={handleClose}>Cancel</button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isMutating}
          >
            Create person
          </button>
        </>
      }
    >
      <p className="muted small">
        Minimal fields only. Email is optional now; you'll be prompted to add it before pod assignment or
        certification.
      </p>
      {error ? <p className="alert danger small">{error}</p> : null}
      <div className="two-col-form">
        <label>
          First name
          <input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoFocus />
        </label>
        <label>
          Last name (optional)
          <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
        </label>
      </div>
      <label>
        Email (optional)
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <span className="muted tiny">Required later before pod assignment or onboarding cert.</span>
      </label>
      <div className="two-col-form">
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {PERSON_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {PERSON_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}
