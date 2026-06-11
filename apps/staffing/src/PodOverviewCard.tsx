import { useMemo } from "react";
import {
  firstName,
  fullName,
  isExternalFdeRole,
  isOnboardingStatus,
  isVacationActive,
  safeText,
  tierClass,
} from "./helpers";
import { effectiveAllocationPct, isComando } from "./selectors";
import type { AssignmentData, PersonData, PodData, PodSummary, Row } from "./types";

type ChipTag = "external" | "comando" | "onboarding" | "away" | "neutral";

type Seat = {
  filled: boolean;
  assignment: Row<AssignmentData>;
  personLabel: string;
  tag: ChipTag;
  allocationPct: number | null;
};

type RoleRowKey = "ds" | "fde" | "gtm" | "sa";
const ROLE_ROWS: { key: RoleRowKey; label: string; showAllocation: boolean }[] = [
  { key: "ds", label: "DS", showAllocation: true },
  { key: "fde", label: "FDE", showAllocation: true },
  { key: "gtm", label: "GTM", showAllocation: false },
  { key: "sa", label: "SA", showAllocation: false },
];

type PodOverviewCardProps = {
  summary: PodSummary;
  peopleById: Map<string, Row<PersonData>>;
  allAssignments: Row<AssignmentData>[];
  pods: Row<PodData>[];
  onClick: () => void;
};

function priorityTag(
  assignment: Row<AssignmentData>,
  person: Row<PersonData> | undefined,
  allAssignments: Row<AssignmentData>[],
  pods: Row<PodData>[],
): ChipTag {
  if (!person) return "neutral";
  if (isExternalFdeRole(person.data.role)) return "external";
  if (isComando(person.id, allAssignments, pods)) return "comando";
  if (isOnboardingStatus(person.data.status) || assignment.data.status === "Onboarding") {
    return "onboarding";
  }
  if (isVacationActive(person.data.vacation_until ?? undefined, person.data.vacation_from ?? undefined)) {
    return "away";
  }
  return "neutral";
}

export function PodOverviewCard({ summary, peopleById, allAssignments, pods, onClick }: PodOverviewCardProps) {
  const seatsByRole = useMemo(() => {
    const isOpen = (a: Row<AssignmentData>) => !a.data.person_id || a.data.status === "Open";
    const labelFor = (a: Row<AssignmentData>): string => {
      const person = a.data.person_id ? peopleById.get(a.data.person_id) : undefined;
      return person ? fullName(person) : "Open";
    };
    const seatFor = (assignment: Row<AssignmentData>): Seat => {
      const person = assignment.data.person_id ? peopleById.get(assignment.data.person_id) : undefined;
      return {
        filled: !isOpen(assignment),
        assignment,
        personLabel: labelFor(assignment),
        tag: priorityTag(assignment, person, allAssignments, pods),
        allocationPct: effectiveAllocationPct(assignment, allAssignments, pods),
      };
    };
    const sort = (rows: Row<AssignmentData>[]): Seat[] => {
      const seats = rows.map(seatFor);
      const filled = seats.filter((s) => s.filled);
      const open = seats.filter((s) => !s.filled);
      return [...filled, ...open];
    };
    return {
      ds: sort(summary.ds),
      fde: sort([...summary.fde, ...summary.externalFde]),
      gtm: sort(summary.gtm),
      sa: sort(summary.sa),
    };
  }, [summary, peopleById, allAssignments, pods]);

  const allSeats = [...seatsByRole.ds, ...seatsByRole.fde, ...seatsByRole.gtm, ...seatsByRole.sa];
  const filledCount = allSeats.filter((s) => s.filled).length;
  const totalCount = allSeats.length;
  const podName = safeText(summary.pod.data.pod_name, summary.pod.id);
  const tier = safeText(summary.pod.data.tier);

  return (
    <button
      type="button"
      className={`pod-overview-card ${tierClass(summary.pod.data.tier)}`}
      onClick={onClick}
      aria-label={`${podName} — ${filledCount} of ${totalCount} seats filled${summary.gapCount > 0 ? `, ${Math.round(summary.gapCount)}% gap` : ""}`}
    >
      <header className="overview-card-header">
        <strong>{podName}</strong>
        <span className={`tier-tag ${tierClass(summary.pod.data.tier)}`}>{tier}</span>
      </header>
      <div className="seat-rows" role="img" aria-hidden>
        {totalCount === 0 ? (
          <span className="muted tiny">No seats yet</span>
        ) : (
          ROLE_ROWS.map((row) => {
            if (seatsByRole[row.key].length === 0) return null;
            return (
              <div className="seat-row" key={row.key}>
                <span className="seat-row-label">{row.label}</span>
                {seatsByRole[row.key].map((seat) => {
                  const showPct = row.showAllocation && seat.allocationPct != null;
                  const pctSuffix = showPct ? ` · ${seat.allocationPct}%` : "";
                  return (
                    <span
                      key={seat.assignment.id}
                      className={`seat seat-tag-${seat.tag}${seat.filled ? " filled" : " open"}`}
                      title={`${row.label} · ${seat.personLabel}${pctSuffix}`}
                    >
                      {seat.filled ? `${firstName(seat.personLabel)}${pctSuffix}` : ""}
                    </span>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
      <footer className="overview-card-footer">
        <span className="muted small">
          {filledCount}/{totalCount} seat{totalCount === 1 ? "" : "s"}
        </span>
        {summary.gapCount > 0 ? (
          <span className="badge danger" aria-label={`${Math.round(summary.gapCount)} percent gap`}>
            {Math.round(summary.gapCount)}% gap
          </span>
        ) : (
          <span className="badge success">Staffed</span>
        )}
      </footer>
    </button>
  );
}
