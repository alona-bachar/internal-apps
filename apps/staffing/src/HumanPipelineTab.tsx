import { useMemo, useState } from "react";
import { fullName, isMoveStatus, safeText } from "./helpers";
import { PipelineStats, SEGMENT_HINTS, SEGMENT_ORDER, type PipelineSegment } from "./PipelineStats";
import { PipelineToolbar } from "./PipelineToolbar";
import { PersonCard } from "./PersonCard";
import { HumanPipelineCalendar } from "./HumanPipelineCalendar";
import { EmptyState } from "./EmptyState";
import type { AssignmentData, PersonData, PodData, Row } from "./types";

type ViewMode = "calendar" | "cards";

type HumanPipelineTabProps = {
  people: Row<PersonData>[];
  assignments: Row<AssignmentData>[];
  pods: Row<PodData>[];
  onNewPerson: () => void;
  onEditPerson: (person: Row<PersonData>) => void;
  onCommitPersonStatus: (person: Row<PersonData>, status: string) => void;
  onCommitPersonField: (person: Row<PersonData>, field: keyof PersonData, value: string) => void;
  onAssign: (person: Row<PersonData>) => void;
  onPlanTransition: (person: Row<PersonData>) => void;
  onOffboard: (person: Row<PersonData>) => void;
  onReactivate: (person: Row<PersonData>) => void;
  onGraduate: (person: Row<PersonData>) => void;
  onDelete: (person: Row<PersonData>) => void;
};

function bucketForPerson(person: Row<PersonData>): PipelineSegment | null {
  const status = String(person.data.status ?? "").trim();
  if (status === "Inactive") return null;
  if (status === "Onboarding") return "Onboarding";
  if (status === "Leaving" || isMoveStatus(status) || person.data.move_to_pod_id) return "Moving";
  return "Active";
}

function sortPeople(segment: PipelineSegment, people: Row<PersonData>[]): Row<PersonData>[] {
  const copy = [...people];
  if (segment === "Onboarding") {
    copy.sort((a, b) => String(a.data.expected_start_date ?? "ZZZZ").localeCompare(
      String(b.data.expected_start_date ?? "ZZZZ"),
    ) || fullName(a).localeCompare(fullName(b)));
  } else if (segment === "Moving") {
    copy.sort((a, b) => String(a.data.move_date ?? "ZZZZ").localeCompare(
      String(b.data.move_date ?? "ZZZZ"),
    ) || fullName(a).localeCompare(fullName(b)));
  } else {
    copy.sort((a, b) => String(a.data.role ?? "").localeCompare(String(b.data.role ?? ""))
      || fullName(a).localeCompare(fullName(b)));
  }
  return copy;
}

export function HumanPipelineTab({
  people,
  assignments,
  pods,
  onNewPerson,
  onEditPerson,
  onCommitPersonStatus,
  onCommitPersonField,
  onAssign,
  onPlanTransition,
  onOffboard,
  onReactivate,
  onGraduate,
  onDelete,
}: HumanPipelineTabProps) {
  const [segment, setSegment] = useState<PipelineSegment>("Onboarding");
  const [query, setQuery] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");

  const attachmentsByPerson = useMemo(() => {
    const map = new Map<string, Row<AssignmentData>[]>();
    for (const a of assignments) {
      const personId = a.data.person_id;
      if (!personId) continue;
      const list = map.get(personId) ?? [];
      list.push(a);
      map.set(personId, list);
    }
    return map;
  }, [assignments]);

  const hasActiveAssignment = (personId: string): boolean => {
    const list = attachmentsByPerson.get(personId) ?? [];
    return list.some((a) => a.data.status !== "Open");
  };

  const counts = useMemo(() => {
    const buckets: Record<PipelineSegment, number> = { Onboarding: 0, Active: 0, Moving: 0 };
    for (const person of people) {
      const b = bucketForPerson(person);
      if (b) buckets[b] += 1;
    }
    return buckets;
  }, [people]);

  const unassignedCount = useMemo(() => {
    return people.filter((p) => {
      if (bucketForPerson(p) === null) return false;
      return !hasActiveAssignment(p.id);
    }).length;
  }, [people, attachmentsByPerson]);

  const segmentPeople = useMemo(() => {
    let inSegment = people.filter((p) => bucketForPerson(p) === segment);
    if (unassignedOnly) inSegment = inSegment.filter((p) => !hasActiveAssignment(p.id));
    return sortPeople(segment, inSegment);
  }, [people, segment, unassignedOnly, attachmentsByPerson]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return segmentPeople;
    return segmentPeople.filter((person) => {
      const haystack = [
        fullName(person),
        person.data.email,
        person.data.role,
        person.data.status,
        person.data.notes,
        (attachmentsByPerson.get(person.id) ?? [])
          .map((a) => safeText(pods.find((p) => p.id === a.data.pod_id)?.data.pod_name, a.data.pod_id ?? ""))
          .join(" "),
      ].join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, segmentPeople, attachmentsByPerson, pods]);

  return (
    <>
      <PipelineStats
        counts={counts}
        unassignedCount={unassignedCount}
        activeSegment={segment}
        onSegmentChange={setSegment}
        unassignedOnly={unassignedOnly}
      />

      <div className="go-lives-toolbar">
        <div className="segmented-control" role="tablist" aria-label="Pipeline view mode">
          <button
            type="button"
            role="tab"
            className={viewMode === "cards" ? "active" : ""}
            onClick={() => setViewMode("cards")}
          >
            Cards
          </button>
          <button
            type="button"
            role="tab"
            className={viewMode === "calendar" ? "active" : ""}
            onClick={() => setViewMode("calendar")}
          >
            Calendar
          </button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <HumanPipelineCalendar people={people} pods={pods} onEventClick={onEditPerson} />
      ) : (
        <PipelineCardsView
          query={query}
          onQueryChange={setQuery}
          segment={segment}
          onSegmentChange={setSegment}
          unassignedOnly={unassignedOnly}
          onUnassignedOnlyChange={setUnassignedOnly}
          onNewPerson={onNewPerson}
          filtered={filtered}
          attachmentsByPerson={attachmentsByPerson}
          pods={pods}
          onEditPerson={onEditPerson}
          onCommitPersonStatus={onCommitPersonStatus}
          onCommitPersonField={onCommitPersonField}
          onAssign={onAssign}
          onPlanTransition={onPlanTransition}
          onOffboard={onOffboard}
          onReactivate={onReactivate}
          onGraduate={onGraduate}
          onDelete={onDelete}
        />
      )}
    </>
  );
}

type PipelineCardsViewProps = {
  query: string;
  onQueryChange: (v: string) => void;
  segment: PipelineSegment;
  onSegmentChange: (s: PipelineSegment) => void;
  unassignedOnly: boolean;
  onUnassignedOnlyChange: (v: boolean) => void;
  onNewPerson: () => void;
  filtered: Row<PersonData>[];
  attachmentsByPerson: Map<string, Row<AssignmentData>[]>;
  pods: Row<PodData>[];
  onEditPerson: (person: Row<PersonData>) => void;
  onCommitPersonStatus: (person: Row<PersonData>, status: string) => void;
  onCommitPersonField: (person: Row<PersonData>, field: keyof PersonData, value: string) => void;
  onAssign: (person: Row<PersonData>) => void;
  onPlanTransition: (person: Row<PersonData>) => void;
  onOffboard: (person: Row<PersonData>) => void;
  onReactivate: (person: Row<PersonData>) => void;
  onGraduate: (person: Row<PersonData>) => void;
  onDelete: (person: Row<PersonData>) => void;
};

function PipelineCardsView({
  query,
  onQueryChange,
  segment,
  onSegmentChange,
  unassignedOnly,
  onUnassignedOnlyChange,
  onNewPerson,
  filtered,
  attachmentsByPerson,
  pods,
  onEditPerson,
  onCommitPersonStatus,
  onCommitPersonField,
  onAssign,
  onPlanTransition,
  onOffboard,
  onReactivate,
  onGraduate,
  onDelete,
}: PipelineCardsViewProps) {
  return (
    <>
      <PipelineToolbar
        query={query}
        onQueryChange={onQueryChange}
        segment={segment}
        onSegmentChange={onSegmentChange}
        unassignedOnly={unassignedOnly}
        onUnassignedOnlyChange={onUnassignedOnlyChange}
        onNewPerson={onNewPerson}
      />
      <p className="muted tiny segment-hint">
        {SEGMENT_HINTS[segment]}
        {unassignedOnly ? " · showing only people without an active pod" : ""}
      </p>
      <section className="pipeline-cards" aria-label={`${segment} people`}>
        {filtered.length === 0 ? (
          <EmptyState
            title={`No people${unassignedOnly ? " unassigned" : ""} in ${segment}`}
            description={query ? "Adjust the search to find someone." : SEGMENT_HINTS[segment]}
            action={query ? (
              <button className="secondary-button" type="button" onClick={() => onQueryChange("")}>
                Clear search
              </button>
            ) : undefined}
          />
        ) : (
          filtered.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              attachments={attachmentsByPerson.get(person.id) ?? []}
              pods={pods}
              onEdit={() => onEditPerson(person)}
              onCommitStatus={(status) => onCommitPersonStatus(person, status)}
              onCommitField={(field, value) => onCommitPersonField(person, field, value)}
              onAssign={() => onAssign(person)}
              onPlanTransition={() => onPlanTransition(person)}
              onOffboard={() => onOffboard(person)}
              onReactivate={() => onReactivate(person)}
              onGraduate={() => onGraduate(person)}
              onDelete={() => onDelete(person)}
            />
          ))
        )}
      </section>
      <p className="muted tiny">{SEGMENT_ORDER.includes(segment) ? defaultSortHint(segment) : ""}</p>
    </>
  );
}

function defaultSortHint(segment: PipelineSegment): string {
  switch (segment) {
    case "Onboarding": return "Sorted by expected start date.";
    case "Active": return "Sorted by role then name.";
    case "Moving": return "Sorted by move date.";
  }
}
