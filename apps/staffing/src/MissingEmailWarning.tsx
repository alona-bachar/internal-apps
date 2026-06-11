import { Chip } from "./Chip";

type MissingEmailWarningProps = {
  variant?: "chip" | "block";
};

export function MissingEmailWarning({ variant = "chip" }: MissingEmailWarningProps) {
  if (variant === "block") {
    return (
      <div className="missing-email-block" role="alert">
        <strong>Email required</strong>
        <p>Add an email before this person can be assigned to a pod or have certification recorded.</p>
      </div>
    );
  }
  return (
    <Chip tone="warning" ariaLabel="Email needed before pod assignment or certification">
      ⚠ Email needed before pod / cert
    </Chip>
  );
}
