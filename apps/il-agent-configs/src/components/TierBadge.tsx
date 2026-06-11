import type { Tier as ApiTier } from "../lib/types";

export function TierBadge(props: { tier: ApiTier }) {
  const cls =
    props.tier === "Tier 1"
      ? "tier-1"
      : props.tier === "Tier 2"
        ? "tier-2"
        : props.tier === "Tier 3"
          ? "tier-3"
          : "tier-other";
  return <span className={`tier-badge ${cls}`}>{props.tier}</span>;
}
