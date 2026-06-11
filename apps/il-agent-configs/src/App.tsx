import { useEffect, useMemo, useState } from "react";
import "./style.css";
import { useConfigsApi } from "./lib/api";
import type { OverviewResponse, PodOverview, AgentSummary, Tab, Tier as ApiTier } from "./lib/types";
import { NavTabs } from "./components/NavTabs";
import { OverviewTab } from "./views/OverviewTab";
import { ChangesTab } from "./views/ChangesTab";
import { AgentsGrid } from "./views/AgentsGrid";
import { AgentDetail } from "./views/AgentDetail";
import { SlackModal } from "./components/SlackModal";
import { type AgentFilterState, EMPTY_FILTERS } from "./lib/agentFilters";

// Translate a poster skip `reason` into human-readable text for the toast.
function friendlySkipReason(reason: string): string {
  const code = reason.startsWith("slack_error:")
    ? reason.slice("slack_error:".length)
    : reason;
  switch (code) {
    case "not_in_channel":
    case "channel_not_found":
      return "bot isn't in the channel — invite @podi";
    case "no_channel_configured":
      return "no Slack channel set";
    case "pod_not_found":
      return "pod not found";
    default:
      return reason.startsWith("slack_error:") ? `Slack error: ${code}` : code;
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedAgent, setSelectedAgent] = useState<{ pod: PodOverview; agent: AgentSummary } | null>(null);
  const [filters, setFilters] = useState<AgentFilterState>(EMPTY_FILTERS);
  const [slackModal, setSlackModal] = useState<{ open: boolean; preselected: string[] }>({ open: false, preselected: [] });
  const [toast, setToast] = useState<string | null>(null);

  const { getOverview, getAgentDetail, postSlack } = useConfigsApi();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getOverview();
        if (!cancelled) { setOverview(res); if (res.ok === false) setOverviewError(res.error); }
      } catch (err) {
        if (!cancelled) setOverviewError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [getOverview]);

  // Open an agent's full detail page. Also switch to the Agents tab so the
  // detail renders when the click comes from the Overview tab.
  const openDrawer = (pod: PodOverview, agent: AgentSummary) => {
    setSelectedAgent({ pod, agent });
    setTab("agents");
  };
  const openSlackModal = (preselected: string[] = []) => setSlackModal({ open: true, preselected });
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const changeTab = (t: Tab) => { setSelectedAgent(null); setTab(t); };

  const totalAgents = useMemo(() => {
    if (!overview || overview.ok !== true) return 0;
    let n = 0;
    for (const pods of Object.values(overview.tiers)) for (const p of pods ?? []) n += p.agents.length;
    return n;
  }, [overview]);

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <div>
            <p className="eyebrow">cto-office · IL</p>
            <h1>Agent Configs</h1>
          </div>
          <div className="header-actions">
            <button className="btn-primary" onClick={() => openSlackModal()}>
              <span className="slack-glyph">#</span> Send Slack update
            </button>
          </div>
        </header>

        <NavTabs active={tab} onChange={changeTab} agentCount={totalAgents} />

        {tab === "overview" && (
          <OverviewTab
            data={overview}
            error={overviewError}
            filters={filters}
            setFilters={setFilters}
            onJumpToTab={changeTab}
            onOpenDrawer={openDrawer}
          />
        )}

        {tab === "agents" && selectedAgent === null && (
          <AgentsGrid
            data={overview}
            error={overviewError}
            filters={filters}
            setFilters={setFilters}
            onOpen={openDrawer}
          />
        )}

        {tab === "agents" && selectedAgent !== null && (
          <AgentDetail
            pod={selectedAgent.pod}
            agent={selectedAgent.agent}
            onSwitchAgent={(agent) => setSelectedAgent({ pod: selectedAgent.pod, agent })}
            onBack={() => setSelectedAgent(null)}
            onOpenSlackModal={openSlackModal}
            getAgentDetail={getAgentDetail}
          />
        )}

        {tab === "changes" && <ChangesTab />}
      </div>

      {slackModal.open && (
        <SlackModal
          overview={overview}
          preselected={slackModal.preselected}
          onClose={() => setSlackModal({ open: false, preselected: [] })}
          onSend={async (pod_ids, msg) => {
            setSlackModal({ open: false, preselected: [] });
            try {
              const res = await postSlack(pod_ids, msg);
              if (!res.ok) { showToast(`Slack send failed: ${res.error}`); return; }
              const posted = res.posted?.length ?? 0;
              const skipped = res.skipped?.length ?? 0;
              // Resolve pod_id → customer name for friendlier messages.
              const nameById = new Map<string, string>();
              if (overview && overview.ok === true) {
                for (const pods of Object.values(overview.tiers)) {
                  for (const p of pods ?? []) nameById.set(p.pod_id, p.customer ?? p.pod_id);
                }
              }
              if (skipped === 0) {
                showToast(`Posted to ${posted} channel${posted === 1 ? "" : "s"}.`);
              } else {
                const detail = res.skipped
                  .map((s) => `${nameById.get(s.pod_id) ?? s.pod_id} — ${friendlySkipReason(s.reason)}`)
                  .join("; ");
                showToast(
                  posted > 0
                    ? `Posted to ${posted}; couldn't post to ${skipped}: ${detail}`
                    : `Couldn't post: ${detail}`,
                );
              }
            } catch (err) {
              showToast(`Slack send failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
