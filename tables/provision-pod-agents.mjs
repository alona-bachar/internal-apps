#!/usr/bin/env node
// One-time provisioning script for the `pod_agents` custom table on the
// CTO Office prod tenant. Creates the table (if missing) and seeds rows
// from scripts/pod-agents-seed.json. Idempotent — re-runs skip rows whose
// (pod_id, title) pair already exists.
//
// Usage:
//   WONDERFUL_API_KEY="<key>" node scripts/provision-pod-agents.mjs
//
// Optional env:
//   CONTROLLER_BASE_URL  (default: https://cto-office.api.wonderful.ai)
//   DRY_RUN=1            (read-only; no table or row writes)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTROLLER = process.env.CONTROLLER_BASE_URL ?? "https://cto-office.api.wonderful.ai";
const API_KEY = process.env.WONDERFUL_API_KEY ?? "";
const DRY_RUN = process.env.DRY_RUN === "1";
const TABLE = "pod_agents";

if (!API_KEY) {
  console.error("WONDERFUL_API_KEY env var is required.");
  process.exit(1);
}

const authHeader = API_KEY.startsWith("Bearer ")
  ? { Authorization: API_KEY }
  : { "X-api-key": API_KEY };

async function api(method, urlPath, body) {
  const url = `${CONTROLLER}${urlPath}`;
  const res = await fetch(url, {
    method,
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${urlPath} -> ${res.status}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function uuid() {
  return crypto.randomUUID();
}

async function listAllRows(tableName) {
  // page_size is silently capped at 10 by the controller — paginate.
  const out = [];
  let page = 1;
  for (;;) {
    const res = await api("GET", `/api/v1/custom-tables/${tableName}/rows?page=${page}&limit=100`);
    const rows = res?.data ?? [];
    out.push(...rows);
    const total = res?.pagination?.total_pages ?? 1;
    if (page >= total || rows.length === 0) break;
    page += 1;
  }
  return out;
}

async function tableExists(name) {
  try {
    await api("GET", `/api/v1/custom-tables/${name}`);
    return true;
  } catch (err) {
    if (err.status === 404 || err.status === 500) return false;
    throw err;
  }
}

async function createPodAgentsTable() {
  const schema = {
    name: TABLE,
    description: "Per-pod AI agents (Notion 'Israeli Site Customer Status' snapshot, then app-owned).",
    columns: [
      { name: "id", type: "string", required: true },
      { name: "pod_id", type: "string", required: true },
      { name: "title", type: "string", required: true },
      { name: "internal_agent_name", type: "string" },
      { name: "use_case", type: "string" },
      { name: "channels", type: "string" },
      { name: "status", type: "string" },
      { name: "current_status", type: "string" },
      { name: "account_ds", type: "string" },
      { name: "actual_consumption", type: "string" },
      { name: "expected_consumption", type: "string" },
      { name: "contract_size", type: "string" },
      { name: "main_blocker", type: "string" },
      { name: "next_milestone", type: "string" },
      { name: "last_update", type: "date" },
      { name: "notes", type: "string" },
    ],
  };
  if (DRY_RUN) {
    console.log(`[dry-run] would create table ${TABLE}`);
    return;
  }
  await api("POST", "/api/v1/custom-tables", schema);
}

function normalizePodName(name) {
  return String(name ?? "").trim().toLowerCase();
}

async function main() {
  console.log(`Controller: ${CONTROLLER}`);
  console.log(`Dry run:    ${DRY_RUN}`);
  console.log("");

  // 1. Load pods, build name -> id map.
  console.log("Loading pods...");
  const podsRows = await listAllRows("pods");
  const podByName = new Map();
  for (const r of podsRows) {
    const podName = r?.data?.pod_name;
    if (!podName) continue;
    podByName.set(normalizePodName(podName), r.id);
  }
  console.log(`  ${podByName.size} pods.`);

  // 2. Load seed JSON.
  const seedPath = path.join(__dirname, "pod-agents-seed.json");
  const seed = JSON.parse(await readFile(seedPath, "utf8"));
  console.log(`Seed rows: ${seed.length}`);

  // 3. Resolve pod_ids; collect unresolved.
  const resolved = [];
  const unresolved = [];
  for (const row of seed) {
    const podId = podByName.get(normalizePodName(row.pod_name));
    if (!podId) {
      unresolved.push(row);
    } else {
      resolved.push({ ...row, _pod_id: podId });
    }
  }
  if (unresolved.length > 0) {
    console.log("");
    console.log(`Unresolved (pod not found, will be skipped): ${unresolved.length}`);
    for (const r of unresolved) {
      console.log(`  - ${r.pod_name} :: ${r.title}`);
    }
  }
  console.log("");

  // 4. Ensure table exists.
  const exists = await tableExists(TABLE);
  if (!exists) {
    console.log(`Creating table ${TABLE}...`);
    await createPodAgentsTable();
    console.log("  created.");
  } else {
    console.log(`Table ${TABLE} already exists.`);
  }
  console.log("");

  // 5. Load existing rows -> (pod_id, title) set for idempotency.
  const existingRows = exists ? await listAllRows(TABLE) : [];
  const existingKey = new Set(
    existingRows.map((r) => `${r?.data?.pod_id ?? ""}|${r?.data?.title ?? ""}`),
  );
  console.log(`Existing rows in ${TABLE}: ${existingRows.length}`);
  console.log("");

  // 6. Insert.
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of resolved) {
    const key = `${row._pod_id}|${row.title}`;
    if (existingKey.has(key)) {
      skipped += 1;
      continue;
    }
    const body = {
      data: {
        id: uuid(),
        pod_id: row._pod_id,
        title: row.title,
        internal_agent_name: row.internal_agent_name ?? "",
        use_case: row.use_case ?? "",
        channels: row.channels ?? "",
        status: row.status ?? "",
        current_status: row.current_status ?? "",
        account_ds: row.account_ds ?? "",
        actual_consumption: row.actual_consumption ?? "",
        expected_consumption: row.expected_consumption ?? "",
        contract_size: row.contract_size ?? "",
        main_blocker: row.main_blocker ?? "",
        next_milestone: row.next_milestone ?? "",
        last_update: row.last_update ?? "",
        notes: "",
      },
    };
    if (DRY_RUN) {
      console.log(`[dry-run] would insert: ${row.pod_name} :: ${row.title}`);
      inserted += 1;
      continue;
    }
    try {
      await api("POST", `/api/v1/custom-tables/${TABLE}/rows`, body);
      console.log(`  + ${row.pod_name} :: ${row.title}`);
      inserted += 1;
    } catch (err) {
      console.error(`  ! ${row.pod_name} :: ${row.title} — ${err.status} ${JSON.stringify(err.body).slice(0, 200)}`);
      failed += 1;
    }
  }

  console.log("");
  console.log("Done.");
  console.log(`  inserted: ${inserted}`);
  console.log(`  skipped (already present): ${skipped}`);
  console.log(`  failed:   ${failed}`);
  console.log(`  unresolved (no matching pod): ${unresolved.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  if (err.body) console.error(err.body);
  process.exit(1);
});
