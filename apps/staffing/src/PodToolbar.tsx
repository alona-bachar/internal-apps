import type { FilterKey, SortKey } from "./types";

type PodToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  tierFilter: string;
  onTierChange: (t: string) => void;
  availableTiers: string[];
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onNewClient: () => void;
};

export function PodToolbar({
  query,
  onQueryChange,
  tierFilter,
  onTierChange,
  availableTiers,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  onNewClient,
}: PodToolbarProps) {
  return (
    <div className="toolbar-card">
      <label>
        Search clients or people
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search customer, tier, assignee…"
        />
      </label>
      <label>
        Tier
        <select value={tierFilter} onChange={(event) => onTierChange(event.target.value)}>
          <option value="all">All tiers</option>
          {availableTiers.map((tier) => (
            <option key={tier} value={tier}>{tier}</option>
          ))}
        </select>
      </label>
      <div className="filter-row" role="group" aria-label="Quick filters">
        {(["all", "gaps", "staffed"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "active" : ""}
            onClick={() => onFilterChange(key)}
            aria-pressed={filter === key}
          >
            {key === "all" ? "All" : key === "gaps" ? "Gaps" : "Staffed"}
          </button>
        ))}
      </div>
      <label>
        Sort
        <select value={sort} onChange={(event) => onSortChange(event.target.value as SortKey)}>
          <option value="tier">Tier</option>
          <option value="name">Name</option>
          <option value="gaps">Gap count</option>
        </select>
      </label>
      <button className="primary-button" type="button" onClick={onNewClient}>
        + New client
      </button>
    </div>
  );
}
