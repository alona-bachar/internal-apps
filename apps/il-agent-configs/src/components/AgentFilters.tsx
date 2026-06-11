import { useMemo } from "react";
import type { OverviewResponse, Tier as ApiTier } from "../lib/types";
import { ALL_TIERS_ORDER } from "../lib/types";
import type { LatencySeverity } from "../lib/latency";
import { type AgentFilterState, modelOptions } from "../lib/agentFilters";
import { MultiSelect } from "./MultiSelect";

const SEVERITY_OPTS: Array<{ key: "all" | LatencySeverity; label: string }> = [
  { key: "all", label: "All" },
  { key: "green", label: "🟢" },
  { key: "amber", label: "🟡" },
  { key: "red", label: "🔴" },
  { key: "none", label: "—" },
];

// Shared filter bar used by both the Agents grid and the Overview tab.
export function AgentFilters(props: {
  data: OverviewResponse | null;
  filters: AgentFilterState;
  setFilters: (f: AgentFilterState) => void;
}) {
  const { filters, setFilters } = props;
  const opts = useMemo(() => modelOptions(props.data), [props.data]);
  const set = (patch: Partial<AgentFilterState>) => setFilters({ ...filters, ...patch });
  // Tier filter chips: real delivery tiers only (Strategic/Unspecified excluded).
  const tierChips: Array<"all" | ApiTier> = ["all", ...ALL_TIERS_ORDER.filter((t) => t !== "Strategic" && t !== "Unspecified")];

  return (
    <div className="toolbar-card">
      <input
        className="search"
        placeholder="Search agent, customer, slug, pod, or DS/FDE…"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <div className="seg">
        {tierChips.map((t) => (
          <button
            key={t}
            className={`seg-btn ${filters.tier === t ? "is-active" : ""}`}
            onClick={() => set({ tier: t })}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Latency</span>
        <div className="seg">
          {SEVERITY_OPTS.map((o) => (
            <button
              key={o.key}
              className={`seg-btn ${filters.latency === o.key ? "is-active" : ""}`}
              onClick={() => set({ latency: o.key })}
              title={o.key}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <MultiSelect label="LLM" options={opts.llm} selected={filters.llm} onChange={(llm) => set({ llm })} />
      <MultiSelect label="STT" options={opts.stt} selected={filters.stt} onChange={(stt) => set({ stt })} />
      <MultiSelect label="TTS" options={opts.tts} selected={filters.tts} onChange={(tts) => set({ tts })} />
    </div>
  );
}
