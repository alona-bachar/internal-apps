import type { FilterKey } from "./types";

type ClientCoverageStatsProps = {
  total: number;
  staffed: number;
  gaps: number;
  openSlots: number;
  activeFilter: FilterKey;
  onFilterChange: (filter: FilterKey) => void;
};

export function ClientCoverageStats({
  total,
  staffed,
  gaps,
  openSlots,
  activeFilter,
  onFilterChange,
}: ClientCoverageStatsProps) {
  return (
    <section className="stats-grid compact" aria-label="Client coverage stats">
      <StatCard
        label="Clients"
        value={total}
        active={activeFilter === "all"}
        onClick={() => onFilterChange("all")}
      />
      <StatCard
        label="Fully staffed"
        value={staffed}
        active={activeFilter === "staffed"}
        onClick={() => onFilterChange("staffed")}
      />
      <StatCard
        label="With gaps"
        value={gaps}
        active={activeFilter === "gaps"}
        onClick={() => onFilterChange("gaps")}
      />
      <article className="stat-card read-only" aria-label={`${openSlots} open slots total`}>
        <strong>{openSlots}</strong>
        <span>Open slots</span>
      </article>
    </section>
  );
}

function StatCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`stat-card${active ? " active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${value}`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}
