import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import { isOnboardingStatus, safeText, toDateInput } from "./helpers";
import { SearchableSelect } from "./SearchableSelect";
import type { PersonData, PodData, Row } from "./types";

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
const CERT_STATUSES = ["", "Not Scheduled", "Scheduled", "In Progress", "Passed", "Blocked", "Failed"];
const OVERALL_CERT_STATUSES = ["", "Not Scheduled", "Scheduled 1", "Scheduled 2", "Scheduled 3", "In Progress", "Passed", "Blocked", "Failed"];

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  expected_start_date: string;
  certification_status: string;
  vacation_from: string;
  vacation_until: string;
  notes: string;
  cert1_status: string;
  cert1_date: string;
  cert2_status: string;
  cert2_date: string;
  cert3_status: string;
  cert3_date: string;
  move_to_pod_id: string;
  move_date: string;
};

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  role: "Forward Deployed Engineer",
  status: "Active",
  expected_start_date: "",
  certification_status: "",
  vacation_from: "",
  vacation_until: "",
  notes: "",
  cert1_status: "",
  cert1_date: "",
  cert2_status: "",
  cert2_date: "",
  cert3_status: "",
  cert3_date: "",
  move_to_pod_id: "",
  move_date: "",
};

type EditPersonModalProps = {
  open: boolean;
  onClose: () => void;
  person: Row<PersonData> | null;
  pods: Row<PodData>[];
  isMutating: boolean;
  focusEmail?: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
};

/**
 * Setting a cert attempt's date auto-fills the attempt status to "Scheduled"
 * (if blank) and bumps the overall certification_status to "Scheduled N".
 */
function applyCertDateAutoStatus(form: FormState, attempt: 1 | 2 | 3, value: string): FormState {
  if (!value) return form;
  const next = { ...form };
  const statusKey = `cert${attempt}_status` as keyof FormState;
  if (!String(next[statusKey] ?? "").trim()) next[statusKey] = "Scheduled";
  if (!String(next.certification_status ?? "").trim() || /^scheduled/i.test(String(next.certification_status))) {
    next.certification_status = `Scheduled ${attempt}`;
  }
  return next;
}

export function EditPersonModal({
  open,
  onClose,
  person,
  pods,
  isMutating,
  focusEmail,
  onSave,
}: EditPersonModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open && person) {
      setForm({
        first_name: person.data.first_name ?? "",
        last_name: person.data.last_name ?? "",
        email: person.data.email ?? "",
        role: person.data.role ?? "Forward Deployed Engineer",
        status: person.data.status === "Inactive" ? "Active" : (person.data.status ?? "Active"),
        expected_start_date: toDateInput(person.data.expected_start_date),
        certification_status: person.data.certification_status ?? "",
        vacation_from: toDateInput(person.data.vacation_from),
        vacation_until: toDateInput(person.data.vacation_until),
        notes: person.data.notes ?? "",
        cert1_status: person.data.cert1_status ?? "",
        cert1_date: toDateInput(person.data.cert1_date),
        cert2_status: person.data.cert2_status ?? "",
        cert2_date: toDateInput(person.data.cert2_date),
        cert3_status: person.data.cert3_status ?? "",
        cert3_date: toDateInput(person.data.cert3_date),
        move_to_pod_id: person.data.move_to_pod_id ?? "",
        move_date: toDateInput(person.data.move_date),
      });
      setError(null);
    }
  }, [open, person]);

  useEffect(() => {
    if (open && focusEmail) window.setTimeout(() => emailRef.current?.focus(), 30);
  }, [open, focusEmail]);

  const podOptions = useMemo(
    () => pods.map((p) => ({ value: p.id, label: safeText(p.data.pod_name, p.id), hint: p.data.tier ?? undefined })),
    [pods],
  );

  if (!person) return null;

  const isOnboarding = isOnboardingStatus(form.status);
  const isMoving = form.status === "Move to other client";

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const updateCertDate = (attempt: 1 | 2 | 3, value: string) => {
    setForm((current) => applyCertDateAutoStatus({ ...current, [`cert${attempt}_date`]: value }, attempt, value));
  };

  const certIsSet = Boolean(
    form.cert1_status || form.cert2_status || form.cert3_status || form.certification_status,
  );

  const handleSave = async () => {
    if (!form.first_name.trim()) { setError("First name is required."); return; }
    if (certIsSet && !form.email.trim()) {
      setError("Add an email before recording certification.");
      emailRef.current?.focus();
      return;
    }
    setError(null);
    const ok = await onSave({
      row_id: person.id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim() || null,
      email: form.email.trim() || null,
      role: form.role,
      status: form.status,
      expected_start_date: form.expected_start_date || null,
      certification_status: isOnboarding ? form.certification_status || null : null,
      vacation_from: form.vacation_from || null,
      vacation_until: form.vacation_until || null,
      notes: form.notes.trim() || null,
      cert1_status: isOnboarding ? form.cert1_status || null : null,
      cert1_date: isOnboarding ? form.cert1_date || null : null,
      cert2_status: isOnboarding ? form.cert2_status || null : null,
      cert2_date: isOnboarding ? form.cert2_date || null : null,
      cert3_status: isOnboarding ? form.cert3_status || null : null,
      cert3_date: isOnboarding ? form.cert3_date || null : null,
      move_to_pod_id: isMoving ? form.move_to_pod_id || null : null,
      move_date: isMoving ? form.move_date || null : null,
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit person"
      wide
      footer={
        <>
          <span />
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={isMutating}>
            Save person
          </button>
        </>
      }
    >
      {error ? <p className="alert danger small">{error}</p> : null}
      <div className="two-col-form">
        <label>
          First name
          <input value={form.first_name} onChange={(event) => update("first_name", event.target.value)} />
        </label>
        <label>
          Last name
          <input value={form.last_name} onChange={(event) => update("last_name", event.target.value)} />
        </label>
      </div>
      <label>
        Email
        <input
          type="email"
          ref={emailRef}
          value={form.email}
          onChange={(event) => update("email", event.target.value)}
        />
        {!form.email.trim() ? (
          <span className="muted tiny">Optional — required before pod assignment or certification.</span>
        ) : null}
      </label>
      <div className="two-col-form">
        <label>
          Role
          <select value={form.role} onChange={(event) => update("role", event.target.value)}>
            {PERSON_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={(event) => update("status", event.target.value)}>
            {PERSON_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="two-col-form">
        <label>
          Expected start
          <input
            type="date"
            value={form.expected_start_date}
            onChange={(event) => update("expected_start_date", event.target.value)}
          />
        </label>
      </div>
      <fieldset className="modal-section">
        <legend>Out of office</legend>
        <div className="two-col-form">
          <label>
            From
            <input type="date" value={form.vacation_from} onChange={(event) => update("vacation_from", event.target.value)} />
          </label>
          <label>
            Until
            <input type="date" value={form.vacation_until} onChange={(event) => update("vacation_until", event.target.value)} />
          </label>
        </div>
      </fieldset>
      {isOnboarding ? (
        <fieldset className="modal-section">
          <legend>Certification</legend>
          {!form.email.trim() ? (
            <p className="alert warning small">Email required before recording certification.</p>
          ) : null}
          <label>
            Overall status
            <select
              value={form.certification_status}
              onChange={(event) => update("certification_status", event.target.value)}
              disabled={!form.email.trim()}
            >
              {OVERALL_CERT_STATUSES.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
            </select>
          </label>
          <p className="muted tiny">Cert 2 / 3 are retakes after a failed first attempt. Setting a date auto-fills the attempt status to <strong>Scheduled</strong>.</p>
          <table className="cert-table">
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3] as const).map((attempt) => (
                <tr key={attempt}>
                  <td className="cert-table-attempt">Cert {attempt}</td>
                  <td>
                    <select
                      value={form[`cert${attempt}_status` as keyof FormState] as string}
                      onChange={(event) => update(`cert${attempt}_status` as keyof FormState, event.target.value as never)}
                      disabled={!form.email.trim()}
                    >
                      {CERT_STATUSES.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      value={form[`cert${attempt}_date` as keyof FormState] as string}
                      onChange={(event) => updateCertDate(attempt, event.target.value)}
                      disabled={!form.email.trim()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      ) : null}
      {isMoving ? (
        <fieldset className="modal-section">
          <legend>Move plan</legend>
          <div className="two-col-form">
            <label>
              Target client
              <SearchableSelect
                value={form.move_to_pod_id}
                onChange={(value) => update("move_to_pod_id", value)}
                options={podOptions}
                placeholder="Choose client"
                emptyOption={{ value: "", label: "Choose client" }}
                ariaLabel="Target client"
              />
            </label>
            <label>
              Move date
              <input type="date" value={form.move_date} onChange={(event) => update("move_date", event.target.value)} />
            </label>
          </div>
        </fieldset>
      ) : null}
      <label>
        Notes
        <textarea rows={3} value={form.notes} onChange={(event) => update("notes", event.target.value)} />
      </label>
    </Modal>
  );
}
