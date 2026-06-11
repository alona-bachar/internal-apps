import {
  assignmentKind,
  isMoveStatus,
  isOnboardingStatus,
  isVacationActive,
  parseTier,
  safeText,
} from "./helpers";
import type {
  AssignmentData,
  FilterKey,
  PersonData,
  PodData,
  PodSummary,
  Row,
  SortKey,
  WeeklyData,
} from "./types";

export function buildPodSummaries(
  pods: Row<PodData>[],
  assignments: Row<AssignmentData>[],
  people: Row<PersonData>[],
  weeklyRows: Row<WeeklyData>[],
): PodSummary[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const weeklyByPodId = new Map(weeklyRows.map((row) => [row.data.pod_id || row.id, row]));

  return pods.map((pod) => {
    const podAssignments = assignments.filter((a) => a.data.pod_id === pod.id);
    const ds: Row<AssignmentData>[] = [];
    const fde: Row<AssignmentData>[] = [];
    const externalFde: Row<AssignmentData>[] = [];
    const gtm: Row<AssignmentData>[] = [];
    const sa: Row<AssignmentData>[] = [];

    podAssignments.forEach((assignment) => {
      const kind = assignmentKind(assignment, peopleById);
      if (kind === "DS") ds.push(assignment);
      else if (kind === "External FDE") externalFde.push(assignment);
      else if (kind === "GTM") gtm.push(assignment);
      else if (kind === "SA") sa.push(assignment);
      else fde.push(assignment);
    });

    const weekly = weeklyByPodId.get(pod.id);
    const openSlots = podAssignments.filter(
      (a) => !a.data.person_id || a.data.status === "Open",
    );
    const onboarding = podAssignments.filter((a) => {
      const person = a.data.person_id ? peopleById.get(a.data.person_id) : undefined;
      return a.data.status === "Onboarding" || person?.data.status === "Onboarding";
    });
    const leaving = podAssignments.filter((a) => {
      const person = a.data.person_id ? peopleById.get(a.data.person_id) : undefined;
      return a.data.status === "Leaving" || person?.data.status === "Leaving";
    });
    const vacation = podAssignments.filter((a) => {
      const person = a.data.person_id ? peopleById.get(a.data.person_id) : undefined;
      return isVacationActive(person?.data.vacation_until);
    });

    const isOpen = (a: Row<AssignmentData>) => !a.data.person_id || a.data.status === "Open";
    const openPct = (rows: Row<AssignmentData>[]): number =>
      rows.filter(isOpen).reduce((sum, a) => {
        const raw = a.data.allocation_pct;
        return sum + (typeof raw === "number" && Number.isFinite(raw) ? raw : 100);
      }, 0);

    const fdeAll = [...fde, ...externalFde];
    const filledDs = ds.filter((a) => a.data.person_id && a.data.status !== "Open").length;
    const filledFde = fdeAll.filter((a) => a.data.person_id && a.data.status !== "Open").length;
    const openDsPct = openPct(ds);
    const openFdePct = openPct(fdeAll);
    // If there's no DS slot at all (no filled and no open), surface 100% gap.
    // Once any open slot exists, trust its allocation_pct as the explicit need.
    const dsGapPct = ds.length === 0 && filledDs === 0 ? 100 : openDsPct;
    const fdeGapPct = fdeAll.length === 0 && filledFde === 0 ? 100 : openFdePct;
    const weeklyMissingPct = (Number(weekly?.data.fde_missing_count ?? 0) || 0) * 100;
    const gapCount = dsGapPct + fdeGapPct + weeklyMissingPct;
    const hasChanges = onboarding.length > 0 || leaving.length > 0 || vacation.length > 0;

    return {
      pod,
      assignments: podAssignments,
      weekly,
      ds,
      fde,
      externalFde,
      gtm,
      sa,
      openSlots,
      onboarding,
      leaving,
      vacation,
      gapCount,
      hasChanges,
      fullyStaffed: gapCount === 0,
      latestDsCoverage: latestWeekValue(weekly?.data, "ds_week_"),
      latestFdeCoverage: latestWeekValue(weekly?.data, "fde_week_"),
    };
  });
}

export function isCtoOfficePod(pod: Row<PodData> | undefined | null): boolean {
  return String(pod?.data.pod_name ?? "").trim().toLowerCase() === "cto office";
}

function isCrossCustomerRole(role?: string | null): boolean {
  const text = String(role ?? "").trim().toLowerCase();
  return text === "gtm" || text === "sa";
}

function distinctNonCtoCustomerPods(
  personId: string,
  assignments: Row<AssignmentData>[],
  pods: Row<PodData>[],
): string[] {
  const podById = new Map(pods.map((p) => [p.id, p]));
  const set = new Set<string>();
  for (const a of assignments) {
    if (a.data.person_id !== personId) continue;
    if (a.data.status === "Open") continue;
    if (isCrossCustomerRole(a.data.role)) continue;
    const podId = a.data.pod_id;
    if (!podId) continue;
    if (isCtoOfficePod(podById.get(podId))) continue;
    set.add(podId);
  }
  return [...set];
}

export function isComando(
  personId: string,
  assignments: Row<AssignmentData>[],
  pods: Row<PodData>[],
): boolean {
  const podById = new Map(pods.map((p) => [p.id, p]));
  let inCto = false;
  let inOther = false;
  for (const a of assignments) {
    if (a.data.person_id !== personId) continue;
    if (a.data.status === "Open") continue;
    const podId = a.data.pod_id;
    if (!podId) continue;
    if (isCtoOfficePod(podById.get(podId))) inCto = true;
    else inOther = true;
    if (inCto && inOther) return true;
  }
  return false;
}

export function effectiveAllocationPct(
  assignment: Row<AssignmentData>,
  assignments: Row<AssignmentData>[],
  pods: Row<PodData>[],
): number | null {
  if (isCrossCustomerRole(assignment.data.role)) return null;
  if (typeof assignment.data.allocation_pct === "number" && Number.isFinite(assignment.data.allocation_pct)) {
    return assignment.data.allocation_pct;
  }
  const personId = assignment.data.person_id;
  if (!personId) return null;
  const distinct = distinctNonCtoCustomerPods(personId, assignments, pods);
  if (distinct.length < 2) return null;
  return Math.round(100 / distinct.length);
}

function latestWeekValue(data: WeeklyData | undefined, prefix: string): string | undefined {
  if (!data) return undefined;
  const keys = Object.keys(data)
    .filter((key) => key.startsWith(prefix) && data[key])
    .sort();
  if (!keys.length) return undefined;
  return String(data[keys[keys.length - 1]]);
}

export function filterPodSummaries(
  summaries: PodSummary[],
  options: {
    query: string;
    tierFilter: string;
    filter: FilterKey;
    sort: SortKey;
    peopleById: Map<string, Row<PersonData>>;
  },
): PodSummary[] {
  const { query, tierFilter, filter, sort, peopleById } = options;
  const normalizedQuery = query.trim().toLowerCase();
  const list = summaries.filter((summary) => {
    const tier = safeText(summary.pod.data.tier, "Unspecified");
    const names = summary.assignments
      .map((a) => {
        if (!a.data.person_id) return "";
        const person = peopleById.get(a.data.person_id);
        return [person?.data.first_name, person?.data.last_name].filter(Boolean).join(" ");
      })
      .join(" ")
      .toLowerCase();
    const matchesQuery =
      !normalizedQuery ||
      String(summary.pod.data.pod_name ?? summary.pod.id).toLowerCase().includes(normalizedQuery) ||
      tier.toLowerCase().includes(normalizedQuery) ||
      names.includes(normalizedQuery);
    const matchesTier = tierFilter === "all" || tier === tierFilter;
    const matchesFilter =
      filter === "all" ||
      (filter === "gaps" && summary.gapCount > 0) ||
      (filter === "staffed" && summary.fullyStaffed);
    return matchesQuery && matchesTier && matchesFilter;
  });

  return [...list].sort((a, b) => {
    if (sort === "tier") {
      const tierDelta = parseTier(a.pod.data.tier) - parseTier(b.pod.data.tier);
      if (tierDelta) return tierDelta;
    }
    if (sort === "gaps") {
      const gapDelta = b.gapCount - a.gapCount;
      if (gapDelta) return gapDelta;
    }
    return String(a.pod.data.pod_name ?? a.pod.id).localeCompare(
      String(b.pod.data.pod_name ?? b.pod.id),
    );
  });
}

export function podTabStats(
  pods: Row<PodData>[],
  summaries: PodSummary[],
): { total: number; staffed: number; gaps: number; openSlots: number } {
  return {
    total: pods.length,
    staffed: summaries.filter((s) => s.fullyStaffed).length,
    gaps: summaries.filter((s) => s.gapCount > 0).length,
    openSlots: summaries.reduce((sum, s) => sum + s.openSlots.length, 0),
  };
}

export function availableTiers(pods: Row<PodData>[]): string[] {
  return [...new Set(pods.map((pod) => safeText(pod.data.tier, "Unspecified")))]
    .sort((a, b) => parseTier(a) - parseTier(b) || a.localeCompare(b));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function lastSundayOnOrBefore(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function weekColumnKey(prefix: "ds_week" | "fde_week", weekStart: Date): string {
  return `${prefix}_${weekStart.getFullYear()}_${pad2(weekStart.getMonth() + 1)}_${pad2(weekStart.getDate())}`;
}

export type CurrentWeekResolution = {
  weekStart: Date;
  weekLabel: string;
  dsCol: string | null;
  fdeCol: string | null;
  isFallback: boolean;
  fallbackWeekLabel?: string;
};

export function resolveCurrentWeek(
  weeklyData: WeeklyData | undefined,
  today: Date = new Date(),
): CurrentWeekResolution {
  const target = lastSundayOnOrBefore(today);
  const targetDs = weekColumnKey("ds_week", target);
  const targetFde = weekColumnKey("fde_week", target);
  const hasTargetDs = weeklyData && targetDs in weeklyData;
  const hasTargetFde = weeklyData && targetFde in weeklyData;
  if (hasTargetDs || hasTargetFde) {
    return {
      weekStart: target,
      weekLabel: isoDate(target),
      dsCol: hasTargetDs ? targetDs : null,
      fdeCol: hasTargetFde ? targetFde : null,
      isFallback: false,
    };
  }
  const data = weeklyData ?? {};
  const dsKeys = Object.keys(data).filter((k) => k.startsWith("ds_week_")).sort();
  const fdeKeys = Object.keys(data).filter((k) => k.startsWith("fde_week_")).sort();
  const latestDs = dsKeys[dsKeys.length - 1] ?? null;
  const latestFde = fdeKeys[fdeKeys.length - 1] ?? null;
  const latestKey = latestDs ?? latestFde ?? null;
  const fallbackWeekLabel = latestKey
    ? latestKey.replace(/^(ds_week|fde_week)_/, "").replace(/_/g, "-")
    : undefined;
  return {
    weekStart: target,
    weekLabel: isoDate(target),
    dsCol: latestDs,
    fdeCol: latestFde,
    isFallback: true,
    fallbackWeekLabel,
  };
}

export type PodTransitions = {
  incoming: { person: Row<PersonData>; moveDate: string }[];
  outgoing: { person: Row<PersonData>; targetPodId: string | null; moveDate: string; reason: "move" | "leaving" }[];
};

export function transitionsForPod(
  podId: string,
  people: Row<PersonData>[],
  assignments: Row<AssignmentData>[],
  horizonDays = 30,
  today: Date = new Date(),
): PodTransitions {
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + horizonDays);
  const horizonStr = isoDate(horizon);

  const incoming: PodTransitions["incoming"] = [];
  for (const person of people) {
    if (person.data.move_to_pod_id !== podId) continue;
    const moveDate = person.data.move_date;
    if (!moveDate) continue;
    const moveStr = String(moveDate).slice(0, 10);
    if (moveStr > horizonStr) continue;
    incoming.push({ person, moveDate: moveStr });
  }

  const outgoing: PodTransitions["outgoing"] = [];
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const seenPersonIds = new Set<string>();
  for (const a of assignments) {
    if (a.data.pod_id !== podId) continue;
    if (a.data.status === "Open") continue;
    if (!a.data.person_id) continue;
    const person = peopleById.get(a.data.person_id);
    if (!person) continue;
    if (seenPersonIds.has(person.id)) continue;
    if (isMoveStatus(person.data.status) || person.data.move_to_pod_id) {
      outgoing.push({
        person,
        targetPodId: person.data.move_to_pod_id ?? null,
        moveDate: String(person.data.move_date ?? "").slice(0, 10),
        reason: "move",
      });
      seenPersonIds.add(person.id);
    } else if (person.data.status === "Leaving") {
      outgoing.push({ person, targetPodId: null, moveDate: "", reason: "leaving" });
      seenPersonIds.add(person.id);
    }
  }
  return { incoming, outgoing };
}

export function isOnboardingPerson(person: Row<PersonData>) {
  return isOnboardingStatus(person.data.status);
}
