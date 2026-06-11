// Shared filter state + predicate for the Agents and Overview views.
import type { AgentSummary, OverviewResponse, PodOverview, Tier } from "./types";
import { latencySeverity, type LatencySeverity } from "./latency";

export type AgentFilterState = {
  search: string;
  tier: "all" | Tier;
  latency: "all" | LatencySeverity;
  // Each model filter is a set of selected models; empty = no filter (all).
  // An agent matches when its model is in the set (OR within a kind).
  llm: string[];
  stt: string[];
  tts: string[];
};

export const EMPTY_FILTERS: AgentFilterState = {
  search: "",
  tier: "all",
  latency: "all",
  llm: [],
  stt: [],
  tts: [],
};

// Per-agent predicate. Tier is handled by each view (grouping differs), so it
// is intentionally NOT applied here.
export function agentMatches(agent: AgentSummary, pod: PodOverview, f: AgentFilterState): boolean {
  if (f.latency !== "all" && latencySeverity(agent.latency_ms) !== f.latency) return false;
  if (f.llm.length > 0 && !f.llm.includes(agent.agent_model ?? "")) return false;
  if (f.stt.length > 0 && !f.stt.includes(agent.stt_model ?? "")) return false;
  if (f.tts.length > 0 && !f.tts.includes(agent.tts_model ?? "")) return false;
  if (f.search) {
    const hay = [
      agent.platform_agent_id ?? "", agent.use_case ?? "", agent.agent_name ?? "",
      pod.customer ?? "", pod.pod_id, pod.ds.join(" "), pod.fde.join(" "),
    ].join(" ").toLowerCase();
    if (!hay.includes(f.search.toLowerCase())) return false;
  }
  return true;
}

// True if any per-agent filter (excluding tier) is active — used to decide
// whether to prune pods/agents in the Overview.
export function hasActiveAgentFilter(f: AgentFilterState): boolean {
  return f.search !== "" || f.latency !== "all" || f.llm.length > 0 || f.stt.length > 0 || f.tts.length > 0;
}

// Distinct dropdown options across all agents in the overview.
export function modelOptions(data: OverviewResponse | null): { llm: string[]; stt: string[]; tts: string[] } {
  const llm = new Set<string>(), stt = new Set<string>(), tts = new Set<string>();
  if (data && data.ok === true) {
    for (const pods of Object.values(data.tiers)) {
      for (const pod of pods ?? []) {
        for (const a of pod.agents) {
          if (a.agent_model) llm.add(a.agent_model);
          if (a.stt_model) stt.add(a.stt_model);
          if (a.tts_model) tts.add(a.tts_model);
        }
      }
    }
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return { llm: sorted(llm), stt: sorted(stt), tts: sorted(tts) };
}
