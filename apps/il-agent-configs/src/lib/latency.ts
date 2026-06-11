// Severity coloring for latency, mirroring the #feed-latency-monitoring report's
// 🟢/🟡/🔴 scheme: green < 1600ms, amber 1600–1999ms, red ≥ 2000ms.
export function latencyClass(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms >= 2000) return "lat-red";
  if (ms >= 1600) return "lat-amber";
  return "lat-green";
}

export type LatencySeverity = "green" | "amber" | "red" | "none";

export function latencySeverity(ms: number | null | undefined): LatencySeverity {
  if (ms == null) return "none";
  if (ms >= 2000) return "red";
  if (ms >= 1600) return "amber";
  return "green";
}
