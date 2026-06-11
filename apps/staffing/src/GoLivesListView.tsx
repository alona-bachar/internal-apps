import { useMemo } from "react";
import { safeText } from "./helpers";
import { Chip } from "./Chip";
import { EmptyState } from "./EmptyState";
import type { GoLiveData, PodData, Row } from "./types";

function statusTone(status: string | null | undefined): "success" | "neutral" | "warning" | "danger" {
  const v = String(status ?? "").trim().toLowerCase();
  if (v === "delayed") return "danger";
  if (v === "at risk") return "warning";
  if (v === "performance pending") return "neutral";
  if (v === "on track") return "success";
  return "neutral";
}

type GoLivesListViewProps = {
  goLives: Row<GoLiveData>[];
  pods: Row<PodData>[];
};

export function GoLivesListView({ goLives, pods }: GoLivesListViewProps) {
  const podName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pods) {
      if (p.data.pod_name) map.set(p.id, p.data.pod_name);
    }
    return (podId: string | undefined) => (podId ? map.get(podId) ?? podId : "—");
  }, [pods]);

  const sorted = useMemo(
    () =>
      [...goLives].sort((a, b) =>
        podName(a.data.pod_id).localeCompare(podName(b.data.pod_id)),
      ),
    [goLives, podName],
  );

  if (sorted.length === 0) {
    return <EmptyState title="No go-lives" description="Pipeline is empty." />;
  }

  return (
    <table className="go-lives-table">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Agent / Use case</th>
          <th>Status</th>
          <th>100% Target</th>
          <th>June projection</th>
          <th>Full potential</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((g) => (
          <tr key={g.id}>
            <td><strong>{podName(g.data.pod_id)}</strong></td>
            <td>{safeText(g.data.agent_use_case)}</td>
            <td><Chip tone={statusTone(g.data.status)}>{safeText(g.data.status, "—")}</Chip></td>
            <td>{safeText(g.data.target_date, "—")}</td>
            <td className="mono">{safeText(g.data.june_projection, "—")}</td>
            <td className="mono">{safeText(g.data.full_potential, "—")}</td>
            <td className="muted">{safeText(g.data.notes, "—")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
