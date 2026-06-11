// Pure config-display helpers for the Agent detail view. No React/SDK deps.
// Keys are raw AGENT_METADATA column names (SCREAMING_SNAKE_CASE).

export type Section =
  | "Details"
  | "Skills Behavior"
  | "LLM"
  | "STT"
  | "TTS / Voice"
  | "Turn-taking"
  | "Multilingual"
  | "Initial message"
  | "Timeouts"
  | "Enhancer / Tasks"
  | "Attachments"
  | "PII"
  | "Other";

// The set of sections classify() can return (used by the invariant test).
export const SECTIONS: Section[] = [
  "Details", "Skills Behavior", "LLM", "STT", "TTS / Voice", "Turn-taking",
  "Multilingual", "Initial message", "Timeouts", "Enhancer / Tasks",
  "Attachments", "PII", "Other",
];

// Display order in the UI (independent of the rule order below).
export const SECTION_ORDER: Section[] = [
  "Details", "Skills Behavior", "LLM", "STT", "TTS / Voice", "Turn-taking",
  "Multilingual", "Initial message", "Timeouts", "Enhancer / Tasks",
  "Attachments", "PII", "Other",
];

// Ordered rule list — first match wins. Specific rules precede broad ones.
const RULES: Array<{ section: Section; test: (k: string) => boolean }> = [
  { section: "Skills Behavior", test: (k) => k === "IS_MULTI_SKILL" || k === "SWITCH_MODE" || k.startsWith("BASE_SKILL") },
  { section: "LLM", test: (k) => k.startsWith("LLM_") },
  { section: "STT", test: (k) =>
      k.startsWith("TRANSCRIBER_") || k.startsWith("DENOISER") ||
      k.includes("TRANSCRIPTION") || k.startsWith("TRANSLATION") },
  { section: "TTS / Voice", test: (k) => k.startsWith("VOICE_") },
  { section: "Turn-taking", test: (k) => k.startsWith("EOT_") || k.startsWith("INTERRUPT_") },
  { section: "Multilingual", test: (k) =>
      k.startsWith("MULTILINGUAL") || k === "ENABLED_LOCALES" ||
      k === "DEFAULT_LOCALE" || k === "LOCALE" },
  { section: "Initial message", test: (k) => k.startsWith("INIT_") || k.startsWith("INITIAL_") },
  { section: "Timeouts", test: (k) => k.includes("TIMEOUT") || k.endsWith("_DAYS") },
  { section: "Enhancer / Tasks", test: (k) => k.startsWith("TASK_") || k.startsWith("BACKOFFICE") },
  { section: "Attachments", test: (k) => k.startsWith("ATTACHMENTS_") },
  { section: "PII", test: (k) => k.startsWith("PII_") || k.includes("REDACT") },
  { section: "Details", test: (k) =>
      k.startsWith("AGENT_") || k.startsWith("TENANT_") || k === "GENDER" ||
      k === "TIMEZONE" || k === "RAW_TIMEZONE" || k === "MODE" || k === "DESCRIPTION" },
];

export function classify(key: string): Section {
  for (const rule of RULES) if (rule.test(key)) return rule.section;
  return "Other";
}

// An observer's job is to batch-transcribe recordings/transcripts it ingests
// from a bucket, so STT is its only relevant model. It never synthesizes speech
// (TTS N/A) and its LLM_MODEL is leftover boilerplate (a *-realtime voice
// model), so LLM and TTS/Voice are hidden.
export function isObserver(agentType: string | null | undefined): boolean {
  return (agentType ?? "").toLowerCase() === "observer";
}

// A backoffice agent's real model is LLM_TASK_MODEL (surfaced as agent_model by
// the data fn); its STT/TTS are leftover boilerplate, so both are hidden.
export function isBackoffice(agentType: string | null | undefined): boolean {
  return (agentType ?? "").toLowerCase() === "backoffice";
}

// A chat agent is text-based: it neither transcribes speech (STT) nor
// synthesizes it (TTS), so both are boilerplate and hidden.
export function isChat(agentType: string | null | undefined): boolean {
  return (agentType ?? "").toLowerCase() === "chat";
}

// Latency = avg(LLM-turn + tool) and only exists for live voice calls. Observer
// and backoffice are batch/async (0 turns); chat barely registers (noise), so
// latency is hidden for all three and shown for call types (and unknowns).
export function showLatency(agentType: string | null | undefined): boolean {
  const t = (agentType ?? "").toLowerCase();
  return t !== "observer" && t !== "backoffice" && t !== "chat";
}

// Detail-view sections hidden per agent type (irrelevant / boilerplate config).
export function hiddenSections(agentType: string | null | undefined): Section[] {
  if (isObserver(agentType)) return ["LLM", "TTS / Voice"];
  if (isBackoffice(agentType)) return ["STT", "TTS / Voice"];
  return [];
}

const ACRONYMS = new Set(["LLM", "STT", "TTS", "PII", "EOT", "AWS", "OCR", "VAD", "SMS", "URL", "ID"]);

export function humanizeLabel(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function formatValue(v: unknown): { text: string; structured: boolean } {
  if (v === null) return { text: "null", structured: false };
  if (v === undefined) return { text: "—", structured: false };
  if (typeof v === "boolean") return { text: v ? "true" : "false", structured: false };
  if (typeof v === "number") return { text: String(v), structured: false };
  if (typeof v === "string") return { text: v, structured: false };
  // object / array
  let preview: string;
  try {
    preview = JSON.stringify(v);
  } catch {
    preview = String(v);
  }
  if (preview.length > 120) preview = preview.slice(0, 117) + "…";
  return { text: preview, structured: true };
}
