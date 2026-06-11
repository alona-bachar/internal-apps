import type { ReactNode } from "react";

export function StatCard(props: {
  tone: "red" | "amber" | "green" | "blue";
  title: string;
  subtitle: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`stat-card stat-card-${props.tone}`} onClick={props.onClick}>
      <div className="stat-title">{props.title}</div>
      <div className="stat-subtitle">{props.subtitle}</div>
    </button>
  );
}
