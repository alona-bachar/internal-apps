export function DeltaChip(props: { pctChange: number; direction: "up" | "down" | "flat" }) {
  const { pctChange, direction } = props;
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "▬";
  const tone = direction === "up" ? "green" : direction === "down" ? "red" : "neutral";
  const sign = pctChange > 0 ? "+" : "";
  return (
    <span className={`delta delta-${tone}`}>
      <span className="delta-arrow">{arrow}</span>
      {sign}{pctChange.toFixed(0)}%
    </span>
  );
}
