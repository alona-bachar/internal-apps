#!/usr/bin/env node
// Provision the custom tables backing the il-agent-configs app + sync.
//
// These tables are pure CACHES — the daily sync (il-agent-configs-sync-v1)
// rebuilds them from Snowflake, and the data fn (il-agent-configs-data-v1)
// only reads them. They were originally created ad-hoc via the API; this
// script is the canonical, reproducible schema so a re-provision never silently
// drops a column the sync writes (notably il_agent_metrics.activities_last_week,
// which was once added live via PUT and would otherwise vanish on recreate).
//
// Idempotent: creates a table if missing; if it exists with a DIFFERENT column
// set, reports the drift and (only with --recreate) drops + recreates it.
// Wonderful custom-table schemas are immutable, so adding a column = recreate.
// That is safe here precisely because the data is a cache.
//
// Usage:
//   WONDERFUL_API_KEY=... node tables/provision-il-agent-configs.mjs            # create-if-missing + report drift
//   WONDERFUL_API_KEY=... node tables/provision-il-agent-configs.mjs --recreate # drop+recreate drifted tables
//
// After a --recreate, run a sync to repopulate:
//   curl -X POST -H "X-api-key: $WONDERFUL_API_KEY" \
//     https://cto-office.api.wonderful.ai/api/v1/functions/il-agent-configs-sync-v1 -d '{"action":"sync"}'

const BASE = process.env.WONDERFUL_BASE_URL || "https://cto-office.api.wonderful.ai";
const API_KEY = process.env.WONDERFUL_API_KEY;
const RECREATE = process.argv.includes("--recreate");

if (!API_KEY) {
  console.error("Missing WONDERFUL_API_KEY");
  process.exit(1);
}

// Canonical schemas (mirrors what the sync writes — keep in sync with
// functions/il-agent-configs-sync/il-agent-configs-sync.ts and
// functions/il-agent-configs-data/il-agent-configs-data.ts).
const TABLES = [
  {
    name: "il_agent_snapshot",
    description: "Per-agent AGENT_METADATA snapshot (config_json) from Snowflake. Cache, rebuilt each sync.",
    columns: [
      { name: "agent_id", type: "string", required: true },
      { name: "agent_name", type: "string" },
      { name: "agent_display_name", type: "string" },
      { name: "tenant_id", type: "string" },
      { name: "tenant_display_name", type: "string" },
      { name: "mode", type: "string" },
      { name: "locale", type: "string" },
      { name: "config_json", type: "string", required: true },
      { name: "snapshot_at", type: "string", required: true },
    ],
  },
  {
    name: "il_agent_metrics",
    description: "Per-agent volume metrics from COMMUNICATION. Cache, rebuilt each sync.",
    columns: [
      { name: "agent_id", type: "string", required: true },
      { name: "conversations_24h", type: "number" },
      { name: "conversations_week_avg", type: "number" },
      { name: "open_issues", type: "number" },
      { name: "last_call_at", type: "string" },
      { name: "snapshot_at", type: "string", required: true },
      { name: "activities_last_week", type: "number" },
    ],
  },
  {
    name: "il_active_agents",
    description: "IL prod agents with >500 comms/7d (drives the app agent set). Rebuilt each sync.",
    columns: [
      { name: "id", type: "string", required: true },
      { name: "agent_name", type: "string" },
      { name: "tenant_name", type: "string" },
      { name: "activities", type: "number" },
      { name: "agent_type", type: "string" },
      { name: "synced_at", type: "string" },
    ],
  },
  {
    name: "il_agent_latency",
    description: "Per-agent 7d avg latency (LLM + tool) from COMM_TURN_LATENCY_STATS. Cache, rebuilt each sync.",
    columns: [
      { name: "id", type: "string", required: true },
      { name: "latency_ms", type: "number" },
      { name: "llm_ms", type: "number" },
      { name: "tool_ms", type: "number" },
      { name: "turns", type: "number" },
      { name: "synced_at", type: "string" },
    ],
  },
  {
    name: "pod_agent_config_changes",
    description: "Append-only feed of detected agent-config field changes (Recent Changes tab).",
    columns: [
      { name: "id", type: "string", required: true },
      { name: "agent_id", type: "string" },
      { name: "agent_name", type: "string" },
      { name: "field_path", type: "string" },
      { name: "old_value", type: "string" },
      { name: "new_value", type: "string" },
      { name: "changed_at", type: "string" },
      { name: "changed_by", type: "string" },
    ],
  },
  {
    name: "people_slack_ids",
    description:
      "Maps a people row id to the person's Slack member ID (for @mention rendering in il-pod-slack-poster). Backfilled by il-people-slack-ids via users.lookupByEmail. The people schema is immutable, so this lives in a side table.",
    columns: [
      { name: "person_id", type: "string", required: true },
      { name: "slack_user_id", type: "string" },
      { name: "name", type: "string" },
      { name: "email", type: "string" },
      { name: "synced_at", type: "string" },
    ],
  },
];

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-api-key": API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, json, text };
}

function colSig(cols) {
  return (cols || [])
    .map((c) => `${c.name}:${c.type}${c.required ? ":req" : ""}`)
    .sort()
    .join(", ");
}

async function provision() {
  for (const t of TABLES) {
    const existing = await api("GET", `/api/v1/custom-tables/${t.name}`);
    if (existing.status === 404) {
      const r = await api("POST", "/api/v1/custom-tables", t);
      console.log(`${t.name}: CREATED (${r.status})`);
      continue;
    }
    const liveCols = existing.json?.columns || existing.json?.data?.columns || [];
    const want = colSig(t.columns);
    const have = colSig(liveCols);
    if (want === have) {
      console.log(`${t.name}: OK (schema matches)`);
      continue;
    }
    console.log(`${t.name}: DRIFT\n  want: ${want}\n  have: ${have}`);
    if (RECREATE) {
      await api("DELETE", `/api/v1/custom-tables/${t.name}`);
      const r = await api("POST", "/api/v1/custom-tables", t);
      console.log(`  -> recreated (${r.status}) — run a sync to repopulate`);
    } else {
      console.log(`  -> run with --recreate to drop+recreate (cache; repopulated by sync)`);
    }
  }
}

provision().catch((e) => { console.error(e); process.exit(1); });
