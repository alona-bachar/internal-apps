import type { Tab } from "../lib/types";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "changes", label: "Recent changes" },
];

export function NavTabs(props: { active: Tab; onChange: (t: Tab) => void; agentCount: number }) {
  return (
    <div className="tab-bar">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab-btn ${props.active === t.id ? "is-active" : ""}`}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
          {t.id === "agents" && props.agentCount > 0 && (
            <span className="tab-badge">{props.agentCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}
