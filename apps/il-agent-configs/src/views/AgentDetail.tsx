import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDetailResponse, AgentSummary, ConfigField, PodOverview } from "../lib/types";
import { TierBadge } from "../components/TierBadge";
import { PeoplePills } from "../components/PeoplePills";
import { DeltaChip } from "../components/DeltaChip";
import { classify, humanizeLabel, formatValue, SECTION_ORDER, hiddenSections, showLatency, type Section } from "../lib/configGroups";
import { latencyClass } from "../lib/latency";
import { AgentTypeChip } from "./AgentCard";

const PRIMARY_OPEN: Section[] = ["Details", "Skills Behavior", "LLM", "STT", "TTS / Voice"];

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  return false;
}

function FieldRow(props: { field: ConfigField }) {
  const { field } = props;
  const [open, setOpen] = useState(false);
  const fv = formatValue(field.value);
  return (
    <div className="cfg-row">
      <div className="cfg-label">
        <span className="cfg-field">{humanizeLabel(field.path)}</span>
        <span className="cfg-path mono">{field.path}</span>
      </div>
      <div className="cfg-value">
        {fv.structured ? (
          <button type="button" className="cfg-expand" onClick={() => setOpen((o) => !o)}>
            <span className="mono">{open ? "▼" : "▶"} {fv.text}</span>
          </button>
        ) : (
          <span className="mono">{fv.text}</span>
        )}
        {fv.structured && open && (
          <pre className="cfg-json">{JSON.stringify(field.value, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function SectionBlock(props: { section: Section; fields: ConfigField[] }) {
  const [open, setOpen] = useState(PRIMARY_OPEN.includes(props.section));
  if (props.fields.length === 0) return null;
  return (
    <div className="cfg-group">
      <button type="button" className="cfg-group-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="cfg-group-name">{open ? "▼" : "▶"} {props.section}</span>
        <span className="cfg-group-count">{props.fields.length} set</span>
      </button>
      {open && (
        <div className="cfg-grid">
          {props.fields.map((f) => <FieldRow key={f.path} field={f} />)}
        </div>
      )}
    </div>
  );
}

export function AgentDetail(props: {
  pod: PodOverview;
  agent: AgentSummary;
  onSwitchAgent: (agent: AgentSummary) => void;
  onBack: () => void;
  onOpenSlackModal: (preselected: string[]) => void;
  getAgentDetail: (platform_agent_id: string, use_case: string) => Promise<AgentDetailResponse>;
}) {
  const { pod, agent } = props;
  const [detail, setDetail] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (agent.platform_agent_id == null) { setDetail(null); return; }
    setLoading(true);
    try {
      setDetail(await props.getAgentDetail(agent.platform_agent_id, agent.use_case));
    } catch (err) {
      setDetail({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [agent.platform_agent_id, agent.use_case, props]);

  useEffect(() => {
    setDetail(null);
    if (agent.platform_agent_id) void fetchDetail();
  }, [agent.pod_agent_id, agent.platform_agent_id, fetchDetail]);

  // Group populated fields by section.
  const bySection = useMemo(() => {
    const m = new Map<Section, ConfigField[]>();
    for (const s of SECTION_ORDER) m.set(s, []);
    if (detail && detail.ok === true) {
      for (const f of detail.fields) {
        if (isEmptyValue(f.value)) continue;
        m.get(classify(f.path))!.push(f);
      }
    }
    return m;
  }, [detail]);

  // Hide config sections that are irrelevant/boilerplate for this agent type.
  const sections = useMemo(() => {
    const hidden = hiddenSections(agent.agent_type);
    return hidden.length ? SECTION_ORDER.filter((s) => !hidden.includes(s)) : SECTION_ORDER;
  }, [agent.agent_type]);
  const latencyRelevant = showLatency(agent.agent_type);

  const hasSlack = pod.slack_channel_id != null;
  const slackLabel = pod.slack_channel_name ?? pod.slack_channel_id ?? "(no Slack channel)";
  const has24h = agent.conversations_24h != null;
  const hasAvg = agent.conversations_week_avg != null;
  const hasDelta = has24h && hasAvg;
  const pct = hasDelta && agent.conversations_week_avg! > 0
    ? ((agent.conversations_24h! - agent.conversations_week_avg!) / agent.conversations_week_avg!) * 100 : 0;
  const dir: "up" | "down" | "flat" = !hasDelta ? "flat" : pct > 1 ? "up" : pct < -1 ? "down" : "flat";

  return (
    <div className="tab detail">
      <button type="button" className="back-link" onClick={props.onBack}>← Agents</button>

      <header className="detail-head">
        <div>
          <div className="detail-title">{pod.customer ?? pod.pod_id}</div>
          <div className="detail-slug mono">{pod.pod_id}</div>
          <div className="detail-tier"><TierBadge tier={pod.tier} /></div>
          <div className="detail-sub">
            {agent.use_case}
            {agent.agent_type && <> · <AgentTypeChip agentType={agent.agent_type} /></>}
            {agent.platform_agent_id
              ? <> · <span className="mono">{agent.platform_agent_id}</span></>
              : <> · <span className="muted">(not yet mapped)</span></>}
          </div>
        </div>
        <button
          className="btn-primary"
          disabled={!hasSlack}
          onClick={() => props.onOpenSlackModal([pod.pod_id])}
          title={hasSlack ? undefined : "Pod has no Slack channel configured"}
        >
          <span className="slack-glyph">#</span> Send update to {slackLabel}
        </button>
      </header>

      <div className="detail-people">
        <PeoplePills label="DS" people={pod.ds} />
        <PeoplePills label="FDE" people={pod.fde} />
      </div>

      {pod.agents.length > 1 && (
        <div className="seg">
          {pod.agents.map((a) => (
            <button
              key={a.pod_agent_id}
              className={`seg-btn ${a.pod_agent_id === agent.pod_agent_id ? "is-active" : ""}`}
              onClick={() => props.onSwitchAgent(a)}
            >
              {a.use_case}
            </button>
          ))}
        </div>
      )}

      <div className="detail-metrics">
        <div className="metric-block">
          <div className="metric-block-value">{has24h ? agent.conversations_24h!.toLocaleString() : "—"}</div>
          <div className="metric-block-label">24h calls {hasDelta && <DeltaChip pctChange={pct} direction={dir} />}</div>
          <div className="metric-block-sub muted">{hasAvg ? `avg ${agent.conversations_week_avg}/d this week` : "—"}</div>
        </div>
        <div className="metric-block">
          <div className={`metric-block-value ${(agent.open_issues ?? 0) > 0 ? "is-bad" : ""}`}>
            {agent.open_issues == null ? "—" : agent.open_issues}
          </div>
          <div className="metric-block-label">open issues</div>
        </div>
        {latencyRelevant && (
          <div className="metric-block">
            <div className={`metric-block-value ${latencyClass(agent.latency_ms)}`}>{agent.latency_ms != null ? `${agent.latency_ms}ms` : "—"}</div>
            <div className="metric-block-label">avg latency</div>
            <div className="metric-block-sub muted">LLM + tool · 7d avg</div>
          </div>
        )}
      </div>

      {agent.agent_name && (
        <div className="detail-monitoring">
          <a
            className="link"
            href={`https://app.datadoghq.eu/dashboard/3wr-nwh-rdf?fromUser=false&refresh_mode=sliding&tpl_var_AgentName%5B0%5D=${encodeURIComponent(agent.agent_name)}&tpl_var_customer%5B0%5D=${encodeURIComponent((pod.customer ?? pod.pod_id ?? "").toLowerCase())}&tpl_var_env%5B0%5D=prod`}
            target="_blank"
            rel="noreferrer"
          >
            ↗ Latency dashboard (Datadog)
          </a>
          <span className="muted"> · token monitoring coming soon</span>
        </div>
      )}

      {latencyRelevant && agent.latency_breakdown && (
        <div className="detail-monitoring muted">
          Latency breakdown (7d avg): LLM {agent.latency_breakdown.llm_ms ?? "—"}ms · Tool{" "}
          {agent.latency_breakdown.tool_ms ?? "—"}ms
        </div>
      )}

      <h3 className="detail-section-title">Configuration</h3>

      {agent.platform_agent_id == null ? (
        <div className="empty-state">
          <p><strong>Configuration unavailable.</strong></p>
          <p>Agent not yet mapped to platform metadata. Backfill <code>platform_agent_id</code> for this pod_agent to enable.</p>
        </div>
      ) : loading || detail === null ? (
        <div className="empty">Loading configuration…</div>
      ) : detail.ok === false ? (
        <div className="empty-state"><p><strong>Configuration error.</strong></p><p>{detail.error}</p></div>
      ) : (
        <div className="cfg-stack">
          {sections.map((s) => (
            <SectionBlock key={s} section={s} fields={bySection.get(s) ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
