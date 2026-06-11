import { TIER_ORDER, ALL_TIERS_ORDER } from "../lib/types";
import type {
  OverviewResponse,
  AgentSummary,
  PodOverview,
  Tab,
} from "../lib/types";
import { TierBadge } from "../components/TierBadge";
import { PeoplePills } from "../components/PeoplePills";
import { StatCard } from "../components/StatCard";
import { AgentFilters } from "../components/AgentFilters";
import { type AgentFilterState, agentMatches } from "../lib/agentFilters";

export function OverviewTab(props: {
  data: OverviewResponse | null;
  error: string | null;
  filters: AgentFilterState;
  setFilters: (f: AgentFilterState) => void;
  onJumpToTab: (t: Tab) => void;
  onOpenDrawer: (pod: PodOverview, agent: AgentSummary) => void;
}) {
  const { data, error, filters } = props;

  if (error) {
    return (
      <div className="tab">
        <header className="tab-header">
          <div>
            <h1>IL site</h1>
            <p className="muted">Volume metrics coming online soon.</p>
          </div>
        </header>
        <div className="error-banner">Failed to load overview: {error}</div>
      </div>
    );
  }

  if (data === null) {
    return <OverviewSkeleton />;
  }

  if (data.ok === false) {
    return (
      <div className="tab">
        <header className="tab-header">
          <div>
            <h1>IL site</h1>
            <p className="muted">Volume metrics coming online soon.</p>
          </div>
        </header>
        <div className="error-banner">Failed to load overview: {data.error}</div>
      </div>
    );
  }

  const tiers = data.tiers;
  const allPods: PodOverview[] = TIER_ORDER.flatMap((tier) => tiers[tier] ?? []);
  const totalPods = allPods.length;
  const totalAgents = allPods.reduce((s, p) => s + p.agents.length, 0);
  const totalCustomersWithSlack = allPods.filter((p) => p.slack_channel_id != null).length;
  const totalCustomers = new Set(
    allPods.map((p) => p.customer).filter((c): c is string => c != null),
  ).size;

  return (
    <div className="tab">
      <header className="tab-header">
        <div>
          <h1>IL site · {totalAgents} agent{totalAgents === 1 ? "" : "s"} · {totalCustomers} customer{totalCustomers === 1 ? "" : "s"}</h1>
        </div>
      </header>

      <AgentFilters data={data} filters={filters} setFilters={props.setFilters} />

      <section className="stat-row">
        <StatCard
          tone="blue"
          title={String(totalPods)}
          subtitle="# of pods"
          onClick={() => props.onJumpToTab("agents")}
        />
        <StatCard
          tone="blue"
          title={String(totalAgents)}
          subtitle="# of agents"
          onClick={() => props.onJumpToTab("agents")}
        />
        <StatCard
          tone="green"
          title={String(totalCustomersWithSlack)}
          subtitle="# of customers with Slack"
          onClick={() => props.onJumpToTab("agents")}
        />
      </section>

      {totalPods === 0 && (
        <div className="empty-state">No pods found.</div>
      )}

      {ALL_TIERS_ORDER.map((tier) => {
        if (filters.tier !== "all" && tier !== filters.tier) return null;
        // Filter each pod's agents; keep pods that still have a matching agent.
        const fps = (tiers[tier] ?? [])
          .map((p) => ({ p, agents: p.agents.filter((a) => agentMatches(a, p, filters)) }))
          .filter((x) => x.agents.length > 0);
        if (fps.length === 0) return null;
        const customers = new Set(
          fps.map((x) => x.p.customer).filter((c): c is string => c != null),
        );
        const tierAgentCount = fps.reduce((s, x) => s + x.agents.length, 0);

        return (
          <section key={tier} className="tier-section">
            <div className="tier-head">
              <TierBadge tier={tier} />
              <span className="tier-meta">
                {customers.size} customer{customers.size === 1 ? "" : "s"} ·{" "}
                {fps.length} pod{fps.length === 1 ? "" : "s"} ·{" "}
                {tierAgentCount} agent{tierAgentCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="ov-table">
              <div className="ov-head">
                <div>Customer</div>
                <div>Agents</div>
                <div>Owner</div>
                <div>Slack</div>
                <div className="t-num">24h calls</div>
              </div>
              {fps.map(({ p, agents: fa }) => {
                const podCalls = fa.reduce(
                  (s, a) => s + (a.conversations_24h ?? 0),
                  0,
                );
                const hasCalls = fa.some((a) => a.conversations_24h != null);
                const firstAgent = fa[0];
                const isClickable = firstAgent != null;
                return (
                  <div
                    key={p.pod_id}
                    className={`ov-row ${isClickable ? "ov-row-clickable" : ""}`}
                    onClick={
                      isClickable
                        ? () => props.onOpenDrawer(p, firstAgent)
                        : undefined
                    }
                    role={isClickable ? "button" : undefined}
                    tabIndex={isClickable ? 0 : undefined}
                  >
                    <div className="ov-customer">
                      <span className="ov-customer-name">{p.customer ?? "—"}</span>
                      <TierBadge tier={p.tier} />
                    </div>
                    <div className="ov-agent">
                      <span className="pill pill-neutral">{fa.length}</span>
                      <span className="t-slug mono">
                        {fa.map((a) => a.agent_name ?? a.use_case).join(", ") || "—"}
                      </span>
                    </div>
                    <div className="ov-owner">
                      <PeoplePills label="DS" people={p.ds} />
                      <PeoplePills label="FDE" people={p.fde} />
                    </div>
                    <div className="mono">
                      {p.slack_channel_name ?? (p.slack_channel_id ?? "—")}
                    </div>
                    <div className="t-num">
                      {hasCalls ? podCalls.toLocaleString() : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="tab">
      <header className="tab-header">
        <div>
          <div className="skeleton" style={{ width: "260px", height: "24px" }} />
          <div className="skeleton" style={{ width: "180px", height: "14px", marginTop: 8 }} />
        </div>
      </header>
      <section className="stat-row">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton-card">
            <div className="skeleton" style={{ width: "60%" }} />
            <div className="skeleton" style={{ width: "40%" }} />
          </div>
        ))}
      </section>
    </div>
  );
}
