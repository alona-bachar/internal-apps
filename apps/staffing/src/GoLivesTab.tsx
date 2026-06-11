import { useState } from "react";
import { GoLivesCalendar } from "./GoLivesCalendar";
import { GoLivesListView } from "./GoLivesListView";
import type { GoLiveData, PodData, Row } from "./types";

type ViewMode = "calendar" | "list";

type GoLivesTabProps = {
  goLives: Row<GoLiveData>[];
  pods: Row<PodData>[];
};

export function GoLivesTab({ goLives, pods }: GoLivesTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");

  return (
    <>
      <section className="stats-grid compact" aria-label="Go-lives stats">
        <article className="stat-card read-only" aria-label={`Pipeline rows: ${goLives.length}`}>
          <strong>{goLives.length}</strong>
          <span>In pipeline</span>
        </article>
      </section>

      <div className="go-lives-toolbar">
        <div className="segmented-control" role="tablist" aria-label="Go-lives view mode">
          <button type="button" role="tab" className={viewMode === "calendar" ? "active" : ""} onClick={() => setViewMode("calendar")}>Calendar</button>
          <button type="button" role="tab" className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>List</button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <GoLivesCalendar goLives={goLives} pods={pods} />
      ) : (
        <GoLivesListView goLives={goLives} pods={pods} />
      )}
    </>
  );
}
