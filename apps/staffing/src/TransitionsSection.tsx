import { fullName, safeText } from "./helpers";
import { EmptyState } from "./EmptyState";
import type { PersonData, PodData, Row } from "./types";
import type { PodTransitions } from "./selectors";

type TransitionsSectionProps = {
  transitions: PodTransitions;
  pods: Row<PodData>[];
  currentPodId: string;
  onEditPerson: (person: Row<PersonData>) => void;
};

export function TransitionsSection({ transitions, pods, currentPodId, onEditPerson }: TransitionsSectionProps) {
  const podName = (id: string | null | undefined) => {
    if (!id) return null;
    const pod = pods.find((p) => p.id === id);
    return safeText(pod?.data.pod_name, id);
  };

  const isEmpty = transitions.incoming.length === 0 && transitions.outgoing.length === 0;

  return (
    <section className="pod-detail-section">
      <header className="section-header-row">
        <div>
          <p className="eyebrow">Transitions (next 30 days)</p>
          <h3>Planned moves</h3>
        </div>
      </header>
      {isEmpty ? (
        <EmptyState compact title="No transitions planned in the next 30 days." />
      ) : (
        <div className="transitions-grid">
          <div>
            <h4 className="small-heading">Incoming</h4>
            {transitions.incoming.length === 0 ? (
              <p className="muted small">None</p>
            ) : (
              <ul className="transitions-list">
                {transitions.incoming.map(({ person, moveDate }) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="transition-row-button"
                      onClick={() => onEditPerson(person)}
                      title="Edit person details"
                    >
                      <strong>{fullName(person)}</strong>
                      <span className="muted"> arrives {moveDate}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="small-heading">Outgoing</h4>
            {transitions.outgoing.length === 0 ? (
              <p className="muted small">None</p>
            ) : (
              <ul className="transitions-list">
                {transitions.outgoing.map(({ person, targetPodId, moveDate, reason }) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="transition-row-button"
                      onClick={() => onEditPerson(person)}
                      title="Edit person details"
                    >
                      <strong>{fullName(person)}</strong>
                      <span className="muted">
                        {" → "}
                        {reason === "leaving"
                          ? "Leaving the company"
                          : `${podName(targetPodId) ?? "another client"}${moveDate ? ` on ${moveDate}` : ""}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
