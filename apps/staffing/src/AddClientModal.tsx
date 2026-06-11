import { useState } from "react";
import { Modal } from "./Modal";
import type { Row, PodData } from "./types";

type AddClientModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { pod_name: string; tier: string }) => Promise<Row<PodData> | null>;
  onCreated: (pod: Row<PodData>) => void;
  isMutating: boolean;
};

export function AddClientModal({ open, onClose, onSubmit, onCreated, isMutating }: AddClientModalProps) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState("Tier 3");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setTier("Tier 3");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Client name is required.");
      return;
    }
    setError(null);
    const created = await onSubmit({ pod_name: name.trim(), tier });
    if (created) {
      onCreated(created);
      reset();
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create client"
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
            Create client
          </button>
        </>
      }
    >
      {error ? <p className="alert danger small">{error}</p> : null}
      <label>
        Client name
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </label>
      <label>
        Tier
        <select value={tier} onChange={(event) => setTier(event.target.value)}>
          <option>Tier 1</option>
          <option>Tier 2</option>
          <option>Tier 3</option>
          <option>Tier 4</option>
        </select>
      </label>
    </Modal>
  );
}
