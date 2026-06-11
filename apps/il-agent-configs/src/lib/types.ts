// Shared TypeScript types for the IL Agent Configs app.
//
// These mirror the response shapes returned by:
//   - functions/il-agent-configs-data/il-agent-configs-data.ts
//   - functions/il-pod-slack-poster (Task 1.5 / Phase 3)
//
// Keep this file in sync with the function handlers when their response
// shapes change. The app talks to the function through src/lib/api.ts.

export type Tier = "Tier 1" | "Tier 2" | "Tier 3" | "Strategic" | "Unspecified";

// Display order for the canonical numeric tiers. Other tiers (Strategic,
// Unspecified) are appended where needed at the call site.
export const TIER_ORDER: Tier[] = ["Tier 1", "Tier 2", "Tier 3"];

// Full tier display order including the API-only tiers.
export const ALL_TIERS_ORDER: Tier[] = ["Tier 1", "Tier 2", "Tier 3", "Strategic", "Unspecified"];

// Top-level navigation tabs.
export type Tab = "overview" | "agents" | "changes";

export type AgentSummary = {
  pod_agent_id: string;
  use_case: string;
  agent_name: string | null;
  platform_agent_id: string | null;
  conversations_24h: number | null;
  conversations_week_avg: number | null;
  open_issues: number | null;
  agent_type: string | null;
  // Each model field is a "provider · model" string; the *_fallback is the
  // backup endpoint (or null when none is configured → UI shows "no fallback").
  agent_model: string | null;
  agent_model_fallback: string | null;
  stt_model: string | null;
  stt_model_fallback: string | null;
  tts_model: string | null;
  tts_model_fallback: string | null;
  skills_behavior: string | null;
  latency_ms: number | null;
  latency_breakdown: {
    llm_ms: number | null;
    tool_ms: number | null;
  } | null;
};

export type PodOverview = {
  pod_id: string;
  customer: string | null;
  tier: Tier;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
  ds: string[];
  fde: string[];
  agents: AgentSummary[];
};

export type OverviewResponse =
  | { ok: true; tiers: Partial<Record<Tier, PodOverview[]>> }
  | { ok: false; error: string };

export type ConfigField = {
  path: string;
  value: unknown;
};

export type AgentDetailResponse =
  | { ok: true; use_case: string; platform_agent_id: string; fields: ConfigField[] }
  | { ok: false; error: string };

export type ConfigChange = {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  customer: string | null;
  field_path: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string | null;
  changed_by: string | null;
};

export type ChangesResponse =
  | { ok: true; changes: ConfigChange[] }
  | { ok: false; error: string };

export type SlackPostResponse =
  | {
      ok: true;
      posted: Array<{ pod_id: string; channel: string; ts: string }>;
      skipped: Array<{ pod_id: string; reason: string }>;
    }
  | { ok: false; error: string };
