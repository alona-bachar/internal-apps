import type { AgentSummary, PodOverview } from "../lib/types";
import { TierBadge } from "../components/TierBadge";
import { latencyClass } from "../lib/latency";
import { isObserver, isBackoffice, isChat, showLatency } from "../lib/configGroups";

const DASH = "—";

export function AgentTypeChip(props: { agentType: string | null }) {
  const t = props.agentType;
  if (!t) return null;
  const slug = t.toLowerCase().replace(/\s+/g, "-");
  const icon =
    slug === "observer" ? "👁"
    : slug === "backoffice" ? "🗄"
    : slug === "inbound-call" ? "📞"
    : slug === "outbound-call" ? "📲"
    : "💬";
  return <span className={`agent-type-chip agent-type-${slug}`}>{icon} {t}</span>;
}

// Render a "provider · model" value with the provider muted and the model
// emphasized. Falls back to the raw string when there's no " · " separator
// (e.g. a provider with no model slug, or the latency value).
function ProviderModel(props: { value: string | null }) {
  const v = props.value;
  if (!v) return <>{DASH}</>;
  const i = v.indexOf(" · ");
  if (i === -1) return <>{v}</>;
  return (
    <>
      <span className="card-cfg-prov">{v.slice(0, i)} ·</span> {v.slice(i + 3)}
    </>
  );
}

// One label + value cell pair inside the card's config grid. The label sits in
// a fixed left column; the value (and optional fallback sub-line) is left-
// aligned beside it and truncates with the full value on hover.
function ConfigRow(props: {
  label: string;
  value: string | null;
  valueClass?: string;
  // When showFallback is set, render a sub-line: the fallback "provider · model",
  // or a red "no fallback" when fallback is null.
  showFallback?: boolean;
  fallback?: string | null;
}) {
  return (
    <>
      <span className="card-cfg-label">{props.label}</span>
      <div className="card-cfg-cell">
        <div className={`card-cfg-value mono ${props.valueClass ?? ""}`} title={props.value ?? undefined}>
          <ProviderModel value={props.value} />
        </div>
        {props.showFallback &&
          (props.fallback ? (
            <div className="card-cfg-fallback mono" title={props.fallback}>↳ {props.fallback}</div>
          ) : (
            <div className="card-cfg-fallback no-fallback">↳ no fallback</div>
          ))}
      </div>
    </>
  );
}

export function AgentCard(props: {
  pod: PodOverview;
  agent: AgentSummary;
  onOpen: (pod: PodOverview, agent: AgentSummary) => void;
}) {
  const { pod, agent } = props;
  const tierCls =
    pod.tier === "Tier 1"
      ? "tier-1"
      : pod.tier === "Tier 2"
        ? "tier-2"
        : pod.tier === "Tier 3"
          ? "tier-3"
          : "tier-other";
  return (
    <button
      type="button"
      className={`agent-card border-${tierCls}`}
      onClick={() => props.onOpen(pod, agent)}
    >
      <div className="agent-card-head">
        <span className="agent-card-customer">{pod.customer ?? pod.pod_id}</span>
        <TierBadge tier={pod.tier} />
      </div>
      <div className="agent-card-usecase">
        <span>{agent.use_case ?? DASH}</span>
        <AgentTypeChip agentType={agent.agent_type} />
      </div>
      <div className="agent-card-divider" />
      <div className="card-cfg-grid">
        {!isObserver(agent.agent_type) && (
          <ConfigRow
            label="LLM"
            value={agent.agent_model}
            showFallback={!isBackoffice(agent.agent_type)}
            fallback={agent.agent_model_fallback}
          />
        )}
        {!isBackoffice(agent.agent_type) && !isChat(agent.agent_type) && (
          <ConfigRow label="STT" value={agent.stt_model} showFallback fallback={agent.stt_model_fallback} />
        )}
        {!isObserver(agent.agent_type) && !isBackoffice(agent.agent_type) && !isChat(agent.agent_type) && (
          <ConfigRow label="TTS" value={agent.tts_model} showFallback fallback={agent.tts_model_fallback} />
        )}
        {showLatency(agent.agent_type) && (
          <ConfigRow
            label="Latency"
            value={agent.latency_ms != null ? `${agent.latency_ms}ms` : null}
            valueClass={latencyClass(agent.latency_ms)}
          />
        )}
      </div>
    </button>
  );
}
