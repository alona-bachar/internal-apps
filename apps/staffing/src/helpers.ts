import type {
  AssignmentData,
  PersonData,
  Row,
  RoleKind,
  WeeklyData,
} from "./types";

export const FDE_ROLE_STRINGS = [
  "Forward Deployed Engineer",
  "Forward Deployed Engineer - Solution",
  "FDE",
];

export const EXTERNAL_FDE_ROLE_STRINGS = [
  "External Forward Deployed Engineer",
  "External FDE",
];

export const DS_ROLE_STRINGS = [
  "Deployment Strategist",
  "DS",
];

export const GTM_ROLE_STRINGS = [
  "GTM",
  "Go-to-market",
  "Go to market",
];

export const SA_ROLE_STRINGS = [
  "SA",
  "Solution Architect",
  "Solutions Architect",
];

export function safeText(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function normalizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function parseTier(value?: string | null) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : 999;
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function toDateInput(value?: string | null) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function dateOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function fullName(row?: Row<PersonData>) {
  if (!row) return "Unassigned";
  return [row.data.first_name, row.data.last_name].filter(Boolean).join(" ") || row.id;
}

function matchesAny(role: string | null | undefined, candidates: string[]) {
  if (!role) return false;
  const trimmed = role.trim();
  return candidates.some((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
}

export function isDsRole(role?: string | null) {
  return matchesAny(role, DS_ROLE_STRINGS);
}

export function isExternalFdeRole(role?: string | null) {
  return matchesAny(role, EXTERNAL_FDE_ROLE_STRINGS);
}

export function isFdeRole(role?: string | null) {
  return matchesAny(role, FDE_ROLE_STRINGS);
}

export function isGtmRole(role?: string | null) {
  return matchesAny(role, GTM_ROLE_STRINGS);
}

export function isSaRole(role?: string | null) {
  return matchesAny(role, SA_ROLE_STRINGS);
}

export function roleShort(role?: string | null) {
  if (isDsRole(role)) return "DS";
  if (isExternalFdeRole(role)) return "External FDE";
  if (isFdeRole(role)) return "FDE";
  if (isGtmRole(role)) return "GTM";
  if (isSaRole(role)) return "SA";
  return safeText(role);
}

export function assignmentKind(
  assignment: Row<AssignmentData>,
  peopleById: Map<string, Row<PersonData>>,
): RoleKind {
  const roleRaw = String(assignment.data.role ?? "").trim().toLowerCase();
  if (roleRaw === "ds") return "DS";
  if (roleRaw === "gtm") return "GTM";
  if (roleRaw === "sa") return "SA";
  if (roleRaw === "fde") {
    const person = assignment.data.person_id ? peopleById.get(assignment.data.person_id) : undefined;
    if (isExternalFdeRole(person?.data.role)) return "External FDE";
    return "FDE";
  }
  if (isGtmRole(assignment.data.role)) return "GTM";
  if (isSaRole(assignment.data.role)) return "SA";
  const person = assignment.data.person_id ? peopleById.get(assignment.data.person_id) : undefined;
  if (isDsRole(person?.data.role)) return "DS";
  if (isGtmRole(person?.data.role)) return "GTM";
  if (isSaRole(person?.data.role)) return "SA";
  if (isExternalFdeRole(person?.data.role)) return "External FDE";
  return "FDE";
}

export function statusClass(status?: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("open") || normalized.includes("blocked") || normalized.includes("failed")) return "danger";
  if (normalized.includes("onboarding") || normalized.includes("move") || normalized.includes("scheduled") || normalized.includes("leaving")) return "warning";
  if (normalized.includes("active") || normalized.includes("passed")) return "success";
  return "neutral";
}

export function latestValue(data: WeeklyData | undefined, prefix: string) {
  if (!data) return undefined;
  const keys = Object.keys(data)
    .filter((key) => key.startsWith(prefix) && data[key])
    .sort();
  if (!keys.length) return undefined;
  return String(data[keys[keys.length - 1]]);
}

export function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isVacationActive(
  until?: string | null,
  todayOrFrom?: string,
  todayMaybe?: string,
): boolean {
  // Two signatures supported:
  //   isVacationActive(until, today?)  — legacy (no from-range)
  //   isVacationActive(until, from, today?) — range
  let from: string | null = null;
  let today: string;
  if (todayMaybe !== undefined) {
    from = todayOrFrom ?? null;
    today = todayMaybe;
  } else {
    today = todayOrFrom ?? todayDateString();
  }
  if (!until) return false;
  const untilStr = String(until).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilStr)) return false;
  if (untilStr < today) return false;
  if (from) {
    const fromStr = String(from).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr) && fromStr > today) return false;
  }
  return true;
}

export function isOnboardingStatus(status?: string | null) {
  return String(status ?? "").toLowerCase() === "onboarding";
}

export function initials(value: string, max = 2): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .filter(Boolean)
    .slice(0, max)
    .join("");
}

export function firstName(value: string): string {
  const first = value.split(/\s+/).filter(Boolean)[0] ?? "";
  return first.length > 10 ? first.slice(0, 9) + "…" : first;
}

/**
 * Cert workflow is retry-based: a person attempts cert 1; if they fail,
 * they re-take as cert 2; if they fail again, cert 3. Passing ANY attempt
 * means they're ready to graduate.
 */
export type CertAttempt = {
  attempt: 1 | 2 | 3 | null;
  status: string;
};

export function currentCertAttempt(data: {
  cert1_status?: string | null;
  cert2_status?: string | null;
  cert3_status?: string | null;
  certification_status?: string | null;
}): CertAttempt {
  const explicit: (string | null | undefined)[] = [data.cert1_status, data.cert2_status, data.cert3_status];
  // Find the latest attempt with a status set.
  for (let i = 2; i >= 0; i--) {
    const value = explicit[i];
    if (value && String(value).trim()) {
      return { attempt: (i + 1) as 1 | 2 | 3, status: String(value).trim() };
    }
  }
  const overall = String(data.certification_status ?? "").trim();
  if (!overall) return { attempt: null, status: "" };
  const lower = overall.toLowerCase();
  if (lower === "scheduled 2") return { attempt: 2, status: "Scheduled" };
  if (lower === "scheduled 3") return { attempt: 3, status: "Scheduled" };
  if (lower === "scheduled 1" || lower === "scheduled") return { attempt: 1, status: "Scheduled" };
  return { attempt: null, status: overall };
}

/**
 * Person is ready to graduate when any cert attempt has been passed.
 */
export function isFullyCertified(data: {
  cert1_status?: string | null;
  cert2_status?: string | null;
  cert3_status?: string | null;
  certification_status?: string | null;
}): boolean {
  const explicit = [data.cert1_status, data.cert2_status, data.cert3_status];
  if (explicit.some((s) => String(s ?? "").trim().toLowerCase() === "passed")) return true;
  return String(data.certification_status ?? "").trim().toLowerCase() === "passed";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Returns 42 dates (6 weeks) starting from the Sunday of the week
 * containing the first of the given month. Used to render a month grid.
 */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

export function tierClass(tier?: string | null) {
  const text = String(tier ?? "").trim().toLowerCase();
  if (!text) return "tier-unknown";
  if (text.includes("strategic")) return "tier-strategic";
  const match = text.match(/(\d)/);
  if (match) return `tier-${match[1]}`;
  return "tier-unknown";
}

export function isMoveStatus(status?: string | null) {
  return String(status ?? "").toLowerCase() === "move to other client";
}
