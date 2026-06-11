import { Chip } from "./Chip";
import { EmptyState } from "./EmptyState";
import { safeText } from "./helpers";
import type { AgentData, GoLiveData, Row } from "./types";

type AgentsSectionProps = {
  agents: Row<AgentData>[];
  goLives: Row<GoLiveData>[];
};

export function AgentsSection({ agents, goLives }: AgentsSectionProps) {
  const liveCount = agents.length;
  const pipelineCount = goLives.length;
  const total = liveCount + pipelineCount;

  return (
    <section className="pod-detail-section">
      <header className="section-header-row">
        <div>
          <p className="eyebrow">Agents</p>
          <h3>{total === 1 ? "1 agent" : `${total} agents`} · {liveCount} live · {pipelineCount} in pipeline</h3>
        </div>
      </header>

      {total === 0 ? (
        <EmptyState compact title="No agents tracked for this client yet." />
      ) : (
        <div className="role-tab-list">
          {agents.map((agent) => (
            <LiveAgentCard key={`agent-${agent.id}`} agent={agent} />
          ))}
          {goLives.map((g) => (
            <PipelineAgentCard key={`pipeline-${g.id}`} goLive={g} />
          ))}
        </div>
      )}
    </section>
  );
}

function LiveAgentCard({ agent }: { agent: Row<AgentData> }) {
  const d = agent.data;
  const useCase = safeText(d.agent_use_case, "Untitled agent");
  const live = safeText(d.live_pct, "");
  const notes = safeText(d.notes, "");

  return (
    <article className="agent-card">
      <header className="agent-card-header">
        <div className="agent-card-title">
          <strong>{useCase}</strong>
        </div>
        {live && <Chip tone={liveTone(live)}>{live}</Chip>}
      </header>
      <dl className="agent-metrics">
        <div><dt>April</dt><dd>{withSessions(d.april_consumption)}</dd></div>
        <div><dt>May</dt><dd>{withSessions(d.may_projection)}</dd></div>
        <div><dt>June</dt><dd>{withSessions(d.june_projection)}</dd></div>
        <div><dt>Full potential</dt><dd>{withSessions(d.full_potential)}</dd></div>
      </dl>
      {notes && <p className="muted small agent-card-line">{notes}</p>}
    </article>
  );
}

function PipelineAgentCard({ goLive }: { goLive: Row<GoLiveData> }) {
  const d = goLive.data;
  const useCase = safeText(d.agent_use_case, "Untitled agent");
  const status = safeText(d.status, "");
  const target = safeText(d.target_date, "TBD");
  const notes = safeText(d.notes, "");

  return (
    <article className="agent-card">
      <header className="agent-card-header">
        <div className="agent-card-title">
          <strong>{useCase}</strong>
          <span className="muted small">· Pipeline · {target}</span>
        </div>
        {status && <Chip tone={statusTone(status)}>{status}</Chip>}
      </header>
      <dl className="agent-metrics">
        <div><dt>April</dt><dd>—</dd></div>
        <div><dt>May</dt><dd>—</dd></div>
        <div><dt>June</dt><dd>{withSessions(d.june_projection)}</dd></div>
        <div><dt>Full potential</dt><dd>{withSessions(d.full_potential)}</dd></div>
      </dl>
      {notes && <p className="muted small agent-card-line">{notes}</p>}
    </article>
  );
}

function statusTone(status: string): "success" | "neutral" | "warning" | "danger" {
  const v = status.toLowerCase().trim();
  if (v === "delayed") return "danger";
  if (v === "at risk") return "warning";
  if (v === "performance pending") return "neutral";
  if (v === "on track") return "success";
  return "neutral";
}

function liveTone(live: string): "success" | "warning" | "danger" | "neutral" {
  const v = live.toLowerCase().trim();
  if (v === "paused") return "danger";
  if (v === "100%") return "success";
  const match = v.match(/^(\d+)%$/);
  if (match) {
    const n = Number(match[1]);
    if (n >= 100) return "success";
    if (n >= 50) return "warning";
    return "neutral";
  }
  return "neutral";
}

function withSessions(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "—") return "—";
  // already has a unit / qualifier (anything non-numeric beyond digits, commas, dots, K/M/$)
  if (/[a-z]/i.test(raw.replace(/k\b|m\b/gi, ""))) return raw;
  return `${raw} sessions`;
}
