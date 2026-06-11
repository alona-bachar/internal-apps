import { currentCertAttempt } from "./helpers";
import type { PersonData } from "./types";

type CertProgressDotsProps = {
  person: { data: PersonData };
  disabled?: boolean;
  disabledReason?: string;
  onEdit?: () => void;
};

function classify(status: string): { tone: "success" | "warning" | "danger" | "neutral"; glyph: string } {
  const normalized = status.trim().toLowerCase();
  if (!normalized || normalized === "not scheduled") return { tone: "neutral", glyph: "○" };
  if (normalized === "passed") return { tone: "success", glyph: "●" };
  if (normalized === "failed" || normalized === "blocked") return { tone: "danger", glyph: "✕" };
  return { tone: "warning", glyph: "◐" };
}

export function CertProgressDots({ person, disabled, disabledReason, onEdit }: CertProgressDotsProps) {
  const current = currentCertAttempt(person.data);
  const meta = classify(current.status);
  const label = current.status
    ? current.attempt
      ? `Cert ${current.attempt} · ${current.status}`
      : current.status
    : "Cert · Not scheduled";

  return (
    <button
      type="button"
      className={`cert-status-chip tone-${meta.tone}${disabled ? " disabled" : ""}`}
      onClick={disabled ? undefined : onEdit}
      disabled={disabled}
      title={disabled ? disabledReason : "Edit certification details"}
      aria-label={label}
    >
      <span className="cert-status-glyph" aria-hidden>{meta.glyph}</span>
      <span className="cert-status-label">{label}</span>
    </button>
  );
}
