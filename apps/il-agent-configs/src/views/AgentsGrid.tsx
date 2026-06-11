import { useMemo } from "react";
import type { OverviewResponse, PodOverview, AgentSummary, Tier as ApiTier } from "../lib/types";
import { AgentCard } from "./AgentCard";
import { AgentFilters } from "../components/AgentFilters";
import { type AgentFilterState, agentMatches } from "../lib/agentFilters";

type FlatAgent = { pod: PodOverview; agent: AgentSummary; tier: ApiTier };

const TIER_RANK: Record<string, number> = {
  "Tier 1": 0, "Tier 2": 1, "Tier 3": 2, Strategic: 3, Unspecified: 4,
};

export function AgentsGrid(props: {
  data: OverviewResponse | null;
  error: string | null;
  filters: AgentFilterState;
  setFilters: (f: AgentFilterState) => void;
  onOpen: (pod: PodOverview, agent: AgentSummary) => void;
}) {
  const { data, error, filters } = props;

  const flat = useMemo<FlatAgent[]>(() => {
    if (!data || data.ok !== true) return [];
    const out: FlatAgent[] = [];
    for (const [tier, pods] of Object.entries(data.tiers)) {
      for (const pod of pods ?? []) {
        for (const agent of pod.agents) out.push({ pod, agent, tier: tier as ApiTier });
      }
    }
    out.sort((a, b) => {
      const tr = (TIER_RANK[a.tier] ?? 99) - (TIER_RANK[b.tier] ?? 99);
      if (tr !== 0) return tr;
      const c = (a.pod.customer ?? a.pod.pod_id).localeCompare(b.pod.customer ?? b.pod.pod_id);
      if (c !== 0) return c;
      return (a.agent.use_case ?? "").localeCompare(b.agent.use_case ?? "");
    });
    return out;
  }, [data]);

  const rows = flat.filter((f) => {
    if (filters.tier !== "all" && f.tier !== filters.tier) return false;
    return agentMatches(f.agent, f.pod, filters);
  });

  if (error) {
    return (
      <div className="tab">
        <header className="tab-header"><div><h1>Agents</h1></div></header>
        <div className="error-banner">Failed to load agents: {error}</div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="tab">
        <header className="tab-header"><div><h1>Agents</h1></div></header>
        <div className="empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="tab">
      <header className="tab-header">
        <div>
          <h1>Agents</h1>
          <p className="muted">All IL agents · click a card for full configuration</p>
        </div>
      </header>

      <AgentFilters data={data} filters={filters} setFilters={props.setFilters} />

      <div className="agent-grid">
        {rows.map((f) => (
          <AgentCard key={f.agent.pod_agent_id} pod={f.pod} agent={f.agent} onOpen={props.onOpen} />
        ))}
      </div>
      {rows.length === 0 && <div className="empty">No agents match the current filters.</div>}
    </div>
  );
}
