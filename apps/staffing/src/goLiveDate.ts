// Heuristic parser for go-live `target_date` text labels.
//
// Returns an ISO date (YYYY-MM-DD) or null if unparseable.
//   "2026-06-15"     -> "2026-06-15"
//   "Mid May"        -> "<year>-05-15"
//   "End of May"     -> "<year>-05-31"
//   "Start of June"  -> "<year>-06-01"
//   "Early June"     -> "<year>-06-01"
//   "Late June"      -> "<year>-06-30"
//   "TBD" / ""       -> null

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function lastDayOfMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseTargetDate(value: string | null | undefined, defaultYear: number): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^tbd$/i.test(raw)) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const lower = raw.toLowerCase();
  const monthMatch = lower.match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/);
  if (!monthMatch) return null;
  const month = MONTHS[monthMatch[1]];
  if (!month) return null;

  let day: number;
  if (/\b(mid|middle)\b/.test(lower)) day = 15;
  else if (/\bend(\s+of)?\b|\blate\b/.test(lower)) day = lastDayOfMonth(defaultYear, month);
  else if (/\b(start|begin(ning)?|early)\b/.test(lower)) day = 1;
  else day = 15;

  return `${defaultYear}-${pad(month)}-${pad(day)}`;
}
