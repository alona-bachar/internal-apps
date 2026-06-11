#!/usr/bin/env node
// Re-seed pod_agents + go_lives from the April 2026 Delivery Report PDF.
// Drops both tables (per skill docs: column changes not supported),
// recreates with simplified schemas, and seeds new rows.
//
// Usage:
//   WONDERFUL_API_KEY="<key>" node scripts/reseed-april-2026.mjs
//   DRY_RUN=1 node scripts/reseed-april-2026.mjs   (preview only)

const CONTROLLER = process.env.CONTROLLER_BASE_URL ?? "https://cto-office.api.wonderful.ai";
const API_KEY = process.env.WONDERFUL_API_KEY ?? "";
const DRY_RUN = process.env.DRY_RUN === "1";

if (!API_KEY) {
  console.error("WONDERFUL_API_KEY env var is required.");
  process.exit(1);
}

const authHeader = API_KEY.startsWith("Bearer ")
  ? { Authorization: API_KEY }
  : { "X-api-key": API_KEY };

async function api(method, urlPath, body) {
  const res = await fetch(`${CONTROLLER}${urlPath}`, {
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

function uuid() { return crypto.randomUUID(); }

async function listAll(tableName) {
  const out = [];
  let page = 1;
  for (;;) {
    const r = await api("GET", `/api/v1/custom-tables/${tableName}/rows?page=${page}&limit=100`).catch(() => ({ data: [] }));
    const rows = r?.data ?? [];
    out.push(...rows);
    const total = r?.pagination?.total_pages ?? 1;
    if (rows.length === 0 || page >= total) break;
    page += 1;
  }
  return out;
}

const POD_AGENTS_SCHEMA = {
  name: "pod_agents",
  description: "Active agents per pod (April 2026 Delivery Report snapshot, app-owned).",
  columns: [
    { name: "id", type: "string", required: true },
    { name: "pod_id", type: "string", required: true },
    { name: "agent_use_case", type: "string", required: true },
    { name: "live_pct", type: "string" },
    { name: "april_consumption", type: "string" },
    { name: "may_projection", type: "string" },
    { name: "june_projection", type: "string" },
    { name: "full_potential", type: "string" },
    { name: "notes", type: "string" },
  ],
};

const GO_LIVES_SCHEMA = {
  name: "go_lives",
  description: "Pipeline agents (May/June 2026), April 2026 Delivery Report snapshot.",
  columns: [
    { name: "id", type: "string", required: true },
    { name: "pod_id", type: "string", required: true },
    { name: "agent_use_case", type: "string", required: true },
    { name: "target_date", type: "string" },
    { name: "june_projection", type: "string" },
    { name: "full_potential", type: "string" },
    { name: "status", type: "string" },
    { name: "notes", type: "string" },
  ],
};

const POD_AGENTS_SEED = [
  { pod_name: "Hapoalim",    agent_use_case: "Danit Voice – Q&A General Knowledge",       live_pct: "100%",   april_consumption: "111,904",         may_projection: "130K",                              june_projection: "130K",         full_potential: "130K",          notes: "" },
  { pod_name: "Hapoalim",    agent_use_case: "Danit WhatsApp – Q&A General Knowledge",    live_pct: "100%",   april_consumption: "5,601 sessions",  may_projection: "5.5K sessions",                     june_projection: "5.5K sessions",full_potential: "5.5K sessions", notes: "" },
  { pod_name: "Discount",    agent_use_case: "Adi Private + Personal",                    live_pct: "100%",   april_consumption: "92,554",          may_projection: "95K",                               june_projection: "95K",          full_potential: "107K",          notes: "Changing the agent's IVR location" },
  { pod_name: "Maccabi",     agent_use_case: "Aya Chat",                                  live_pct: "100%",   april_consumption: "46,570 sessions", may_projection: "44K sessions",                      june_projection: "44K sessions", full_potential: "44K sessions",  notes: "" },
  { pod_name: "Maccabi",     agent_use_case: "Shir Locator & Pharmacy",                   live_pct: "100%",   april_consumption: "46,379",          may_projection: "48K",                               june_projection: "48K",          full_potential: "",              notes: "" },
  { pod_name: "Cal",         agent_use_case: "Gal – IVR Flattening",                      live_pct: "100%",   april_consumption: "107,754",         may_projection: "504K",                              june_projection: "504K",         full_potential: "504K",          notes: "" },
  { pod_name: "Cal",         agent_use_case: "Observer",                                  live_pct: "100%",   april_consumption: "872,432",         may_projection: "",                                  june_projection: "",             full_potential: "",              notes: "" },
  { pod_name: "Bezeq",       agent_use_case: "Ron – IVR + Tech Troubleshooting",          live_pct: "100%",   april_consumption: "",                may_projection: "135K",                              june_projection: "135K",         full_potential: "178K",          notes: "New commercial skills; moving up in IVR" },
  { pod_name: "Leumi",       agent_use_case: "Q&A General Knowledge – Chat Agent",        live_pct: "1%",     april_consumption: "115,013",         may_projection: "3K sessions (8K bank employees)",   june_projection: "100K sessions",full_potential: "400K sessions", notes: "Volume to increase per branch locations" },
  { pod_name: "Menora",      agent_use_case: "Manor",                                     live_pct: "100%",   april_consumption: "6,791",           may_projection: "14K",                               june_projection: "19K",          full_potential: "24K",           notes: "IVR improvements & capability expansion" },
  { pod_name: "Yes",         agent_use_case: "Ari – Technical Troubleshooting",           live_pct: "5%",     april_consumption: "47,103",          may_projection: "100K",                              june_projection: "250K",         full_potential: "250K",          notes: "Adding API integrations; opening more calls" },
  { pod_name: "Pelephone",   agent_use_case: "Pele – WiFi Calling",                       live_pct: "20%",    april_consumption: "",                may_projection: "100K",                              june_projection: "100K",         full_potential: "300K",          notes: "" },
  { pod_name: "More",        agent_use_case: "Mory – WhatsApp Agent",                     live_pct: "100%",   april_consumption: "198 sessions",    may_projection: "200 sessions",                      june_projection: "200 sessions", full_potential: "100K sessions", notes: "Fully rolled out; low adoption" },
  { pod_name: "Cellcom",     agent_use_case: "Yael – International Voice Agent",          live_pct: "100%",   april_consumption: "4,438",           may_projection: "6K",                                june_projection: "12K",          full_potential: "12K",           notes: "Growth driven by summer vacation & post-war travel" },
  { pod_name: "Pango",       agent_use_case: "Yael Chat Agent",                           live_pct: "100%",   april_consumption: "31,181 sessions", may_projection: "30K sessions",                      june_projection: "30K sessions", full_potential: "30K sessions",  notes: "" },
  { pod_name: "Pazgas",      agent_use_case: "Pazit – Gas Order & Bill Payment",          live_pct: "100%",   april_consumption: "33,686",          may_projection: "42K",                               june_projection: "42K",          full_potential: "42K min/mo",    notes: "" },
  { pod_name: "Strauss",     agent_use_case: "Tamar – Technical Troubleshooting",         live_pct: "100%",   april_consumption: "12,745",          may_projection: "20K",                               june_projection: "30K",          full_potential: "55K",           notes: "Includes 1 additional bar" },
  { pod_name: "IEC",         agent_use_case: "Ori – Bill Info",                           live_pct: "80%",    april_consumption: "16,683",          may_projection: "30K",                               june_projection: "50K",          full_potential: "100K",          notes: "New skill in June, full potential with third heavy skill" },
  { pod_name: "Isracard",    agent_use_case: "Gali – Transaction Search",                 live_pct: "Paused", april_consumption: "474",             may_projection: "1.5K",                              june_projection: "3K",           full_potential: "90K",           notes: "Gradual rollout pending performance" },
  { pod_name: "Partner",     agent_use_case: "Romi – TV + RC Voice Agent",                live_pct: "100%",   april_consumption: "13,820",          may_projection: "17K",                               june_projection: "17K",          full_potential: "17K",           notes: "" },
  { pod_name: "Eldan",       agent_use_case: "Daniel – Inbound Voice Agent",              live_pct: "100%",   april_consumption: "330",             may_projection: "2.4K",                              june_projection: "2.4K",         full_potential: "10K",           notes: "Gap driven by conversation length, not call volume" },
  { pod_name: "Interactive", agent_use_case: "Niv – Voice Agent",                         live_pct: "60%",    april_consumption: "14,376",          may_projection: "20K",                               june_projection: "50K",          full_potential: "75K",           notes: "Expanding use case over next two months" },
  { pod_name: "Interactive", agent_use_case: "Asaf – Voice Agent",                        live_pct: "100%",   april_consumption: "2,679",           may_projection: "2.6K",                              june_projection: "2.6K",         full_potential: "2.6K",          notes: "" },
  { pod_name: "Libra",       agent_use_case: "Libi Voice",                                live_pct: "100%",   april_consumption: "22,376",          may_projection: "",                                  june_projection: "",             full_potential: "",              notes: "" },
  { pod_name: "Libra",       agent_use_case: "Observer",                                  live_pct: "100%",   april_consumption: "109,277",         may_projection: "130K",                              june_projection: "130K",         full_potential: "130K",          notes: "" },
  { pod_name: "IBI",         agent_use_case: "Observer",                                  live_pct: "100%",   april_consumption: "66,877",          may_projection: "",                                  june_projection: "",             full_potential: "",              notes: "" },
];

// Statuses: "Delayed" | "At Risk" | "Performance Pending" | "On Track".
// Heuristic defaults (today is 2026-05-22). User can override later.
const PIPELINE_SEED = [
  { pod_name: "Maccabi",     agent_use_case: "Voice App",                                target_date: "Mid June",   june_projection: "60K",            full_potential: "120K",            status: "On Track", notes: "Gradual rollout" },
  { pod_name: "Mar",         agent_use_case: "Michal – Voice Appointments & Support",    target_date: "Mid May",    june_projection: "110K",           full_potential: "220K",            status: "Delayed",  notes: "Gradual rollout" },
  { pod_name: "Fattal",      agent_use_case: "Booking Changes & Inquiries",              target_date: "Mid May",    june_projection: "18K",            full_potential: "35K",             status: "Delayed",  notes: "45K seasonal; gradual rollout" },
  { pod_name: "Interactive", agent_use_case: "Niv – WhatsApp Agent",                     target_date: "Mid May",    june_projection: "22K sessions",   full_potential: "22K sessions",    status: "Delayed",  notes: "" },
  { pod_name: "ELAL",        agent_use_case: "Ela – First Response Voice Agent",         target_date: "End of May", june_projection: "300K",           full_potential: "720K",            status: "At Risk",  notes: "Gradual rollout" },
  { pod_name: "Isracard",    agent_use_case: "IVR Flattening",                           target_date: "TBD",        june_projection: "TBD",            full_potential: "TBD",             status: "At Risk",  notes: "Missing info from customer" },
  { pod_name: "Hapoalim",    agent_use_case: "Danit In-App",                             target_date: "End of May", june_projection: "100K sessions",  full_potential: "300K sessions",   status: "At Risk",  notes: "" },
  { pod_name: "Hapoalim",    agent_use_case: "Danit Autonomous Voice",                   target_date: "TBD",        june_projection: "90K",            full_potential: "110K",            status: "At Risk",  notes: "Adding skills – still in discovery" },
  { pod_name: "Egged",       agent_use_case: "Agam – Voice Agent",                       target_date: "End of May", june_projection: "60K",            full_potential: "60K",             status: "At Risk",  notes: "" },
  { pod_name: "Cellcom",     agent_use_case: "Yael – Finance Voice Agent",               target_date: "End of May", june_projection: "20K",            full_potential: "40K",             status: "At Risk",  notes: "Gradual rollout" },
  { pod_name: "More",        agent_use_case: "Pension Claims – Back Office Agent",       target_date: "End of May", june_projection: "450 cases",      full_potential: "450 cases",       status: "At Risk",  notes: "" },
];

function normalizePodName(name) {
  return String(name ?? "").trim().toLowerCase();
}

async function dropTable(name) {
  if (DRY_RUN) {
    console.log(`[dry-run] would DELETE table ${name}`);
    return;
  }
  try {
    await api("DELETE", `/api/v1/custom-tables/${name}`);
    console.log(`  dropped ${name}`);
  } catch (err) {
    if (err.status === 404 || err.status === 500) {
      console.log(`  ${name} did not exist (status ${err.status})`);
    } else {
      throw err;
    }
  }
}

async function createTable(schema) {
  if (DRY_RUN) {
    console.log(`[dry-run] would CREATE table ${schema.name} with ${schema.columns.length} columns`);
    return;
  }
  await api("POST", "/api/v1/custom-tables", schema);
  console.log(`  created ${schema.name}`);
}

async function seedRows(tableName, rows, podByName) {
  const unresolved = [];
  let ok = 0, fail = 0;
  for (const row of rows) {
    const podId = podByName.get(normalizePodName(row.pod_name));
    if (!podId) {
      unresolved.push(row);
      continue;
    }
    const data = { ...row, id: uuid(), pod_id: podId };
    delete data.pod_name;
    if (DRY_RUN) {
      console.log(`[dry-run] would insert ${tableName}: ${row.pod_name} :: ${row.agent_use_case}`);
      ok += 1;
      continue;
    }
    try {
      await api("POST", `/api/v1/custom-tables/${tableName}/rows`, { data });
      console.log(`  + ${row.pod_name} :: ${row.agent_use_case}`);
      ok += 1;
    } catch (err) {
      console.error(`  ! ${row.pod_name} :: ${row.agent_use_case} — ${err.status} ${JSON.stringify(err.body).slice(0, 200)}`);
      fail += 1;
    }
  }
  return { ok, fail, unresolved };
}

console.log(`Controller: ${CONTROLLER}`);
console.log(`Dry run:    ${DRY_RUN}`);
console.log("");

console.log("Loading pods...");
const podsRows = await listAll("pods");
const podByName = new Map();
for (const r of podsRows) {
  if (r?.data?.pod_name) podByName.set(normalizePodName(r.data.pod_name), r.id);
}
console.log(`  ${podByName.size} pods.`);
console.log("");

console.log("=== pod_agents ===");
await dropTable("pod_agents");
await createTable(POD_AGENTS_SCHEMA);
const podAgentsResult = await seedRows("pod_agents", POD_AGENTS_SEED, podByName);
console.log("");

console.log("=== go_lives ===");
await dropTable("go_lives");
await createTable(GO_LIVES_SCHEMA);
const goLivesResult = await seedRows("go_lives", PIPELINE_SEED, podByName);
console.log("");

console.log("Done.");
console.log(`  pod_agents inserted: ${podAgentsResult.ok}  failed: ${podAgentsResult.fail}  unresolved: ${podAgentsResult.unresolved.length}`);
for (const r of podAgentsResult.unresolved) {
  console.log(`    unresolved pod: ${r.pod_name} :: ${r.agent_use_case}`);
}
console.log(`  go_lives   inserted: ${goLivesResult.ok}  failed: ${goLivesResult.fail}  unresolved: ${goLivesResult.unresolved.length}`);
for (const r of goLivesResult.unresolved) {
  console.log(`    unresolved pod: ${r.pod_name} :: ${r.agent_use_case}`);
}
