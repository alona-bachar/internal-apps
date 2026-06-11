// Source of il-agent-configs-sync-v1. Runtime calls userFunction(context).
// Inputs arrive on context.data.{action,payload}. `export` is stripped at deploy
// time (esbuild regex pass in deploy-function.mjs); kept here for vitest only.

function b64url(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function buildJwt(auth) {
  const now = Math.floor(Date.now() / 1000);
  const qualified = `${auth.account.toUpperCase()}.${auth.user.toUpperCase()}`;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: `${qualified}.${auth.public_key_fp}`, sub: qualified, iat: now, exp: now + 3540 };
  const enc = new TextEncoder();
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(auth.private_key_pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

export async function snowflakeQuery(auth, statement, opts = {}) {
  const jwt = await buildJwt(auth);
  const headers = {
    Authorization: `Bearer ${jwt}`,
    "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "wonderful-il-cto-sync/1.0",
  };
  const res = await fetch(`https://${auth.host}/api/v2/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      statement,
      timeout: opts.timeout ?? 60,
      warehouse: auth.warehouse,
      role: auth.role,
      database: opts.database ?? "WONDERFUL",
      schema: opts.schema ?? "DATA_LAYER",
    }),
  });
  if (!res.ok) throw new Error(`Snowflake ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j = await res.json();
  const cols = (j.resultSetMetaData?.rowType ?? []).map((c) => c.name);
  const partitions = j.resultSetMetaData?.partitionInfo ?? [];
  const handle = j.statementHandle;
  const rawRows = [...(j.data ?? [])];
  for (let p = 1; p < partitions.length; p++) {
    const pr = await fetch(`https://${auth.host}/api/v2/statements/${handle}?partition=${p}`, { method: "GET", headers });
    if (!pr.ok) throw new Error(`Snowflake partition ${p} ${pr.status}: ${(await pr.text()).slice(0, 400)}`);
    const pj = await pr.json();
    rawRows.push(...(pj.data ?? []));
  }
  return rawRows.map((row) => {
    const o = {};
    cols.forEach((n, i) => { o[n] = row[i]; });
    return o;
  });
}

const SNOW_DB = "WONDERFUL";
const SNOW_SCHEMA = "DATA_LAYER";

// Page through all rows of a custom table via the in-runtime SDK.
// Mirrors the identical helper in functions/il-agent-configs-data/il-agent-configs-data.ts.
async function queryAll(context, tableName) {
  const limit = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    const result = await context.tables.query(tableName, limit, offset);
    rows.push(...(result.rows || []));
    if (!result.rows || result.rows.length < limit || rows.length >= Number(result.total || 0)) break;
    offset += limit;
  }
  return rows;
}

// Insert or update a row keyed by pkColumn/pkValue via filter+update or insert.
async function upsertByKey(context, table, pkColumn, pkValue, data) {
  const match = await context.tables.filter(table, [{ column: pkColumn, operator: "eq", value: pkValue }], 1, 0);
  if (match.rows && match.rows.length > 0) {
    await context.tables.update(table, pkValue, data);
  } else {
    await context.tables.insert(table, data);
  }
}

// Build a SQL IN-list string from an array of agent ID strings.
function sqlInList(ids) {
  return ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
}

// Extract the set of non-null platform_agent_id values from pod_agents rows.
function mappedAgentIds(podAgents) {
  const ids = new Set();
  for (const row of podAgents) {
    const id = (row?.data ?? {}).platform_agent_id;
    if (id) ids.add(String(id));
  }
  return [...ids];
}

// Fields that churn every sync or are internal plumbing — excluded from diffs.
// ---- derived (indicative) config fields ----
// config_field (in pod-staffing-data) matches only TOP-LEVEL config_json keys
// by normalized substring, so settings buried inside *_CONFIGURATION JSON blobs
// are invisible to it, and the flat backup columns (VOICE_SECONDARY_VOICE_ID,
// TRANSCRIBER_BACKUPS_PROVIDER, LLM_BACKUP_MODEL) are empty on every IL agent.
// We precompute indicative, synonym-named top-level booleans (+ a companion
// <KEY>_DETAIL string) so natural-language questions ("tts fallback?") resolve.

// provider -> the field on that provider block holding the voice identity.
const VOICE_ID_FIELD = {
  elevenlabs: "voice_id", deepdub: "voice_id", cartesia: "voice_id",
  gradium: "voice_id", minimax: "voice_id",
  google: "voice_name", gemini_live: "voice_name", azure_openai: "voice_name",
  openai_realtime: "voice", soniox: "voice",
};

function asObj(v) {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return p && typeof p === "object" ? p : null; } catch { return null; } }
  return null;
}
function nonEmptyStr(v) { return v != null && String(v).trim() !== ""; }

// True iff a backup voice endpoint has a real voice for its selected provider.
function deriveVoiceFallback(cfg) {
  const vc = asObj(cfg.VOICE_CONFIGURATION);
  const eps = vc && Array.isArray(vc.backup_endpoints) ? vc.backup_endpoints : [];
  const providers = [];
  for (const ep of eps) {
    if (!ep || typeof ep !== "object") continue;
    const prov = ep.provider;
    const blk = prov && ep[prov];
    const field = prov && VOICE_ID_FIELD[prov];
    if (blk && field && nonEmptyStr(blk[field])) { providers.push(prov); continue; }
    // fallback scan: any provider block with a non-empty voice id/name/voice
    for (const k of Object.keys(ep)) {
      const b = ep[k];
      if (b && typeof b === "object" && (nonEmptyStr(b.voice_id) || nonEmptyStr(b.voice_name) || nonEmptyStr(b.voice))) { providers.push(k); break; }
    }
  }
  if (providers.length === 0 && nonEmptyStr(cfg.VOICE_SECONDARY_VOICE_ID)) providers.push("secondary");
  if (providers.length === 0) return null;
  const uniq = [...new Set(providers)];
  const n = providers.length;
  return { flag: true, detail: `${uniq.join(", ")} (${n} backup voice${n === 1 ? "" : "s"})` };
}

// True iff a transcriber backup provider block is enabled with a model.
function deriveSttBackup(cfg) {
  const tc = asObj(cfg.TRANSCRIBER_CONFIGURATION);
  const backups = tc && Array.isArray(tc.backups) ? tc.backups : [];
  const providers = [];
  for (const entry of backups) {
    if (!entry || typeof entry !== "object") continue;
    for (const prov of Object.keys(entry)) {
      const b = entry[prov];
      if (b && typeof b === "object" && b.enabled === true && nonEmptyStr(b.model)) providers.push(prov);
    }
  }
  if (providers.length === 0 && nonEmptyStr(cfg.TRANSCRIBER_BACKUPS_PROVIDER)) providers.push(String(cfg.TRANSCRIBER_BACKUPS_PROVIDER));
  if (providers.length === 0) return null;
  return { flag: true, detail: [...new Set(providers)].join(", ") };
}

// True iff an LLM backup endpoint has a model.
function deriveLlmBackup(cfg) {
  const lc = asObj(cfg.LLM_CONFIGURATION);
  const eps = lc && Array.isArray(lc.backup_endpoints) ? lc.backup_endpoints : [];
  for (const ep of eps) {
    if (ep && typeof ep === "object" && nonEmptyStr(ep.model)) {
      const prov = nonEmptyStr(ep.selected_provider) ? ep.selected_provider : "";
      return { flag: true, detail: `${prov} ${ep.model}`.trim() };
    }
  }
  if (nonEmptyStr(cfg.LLM_BACKUP_MODEL)) {
    const prov = nonEmptyStr(cfg.LLM_BACKUP_SELECTED_PROVIDER) ? cfg.LLM_BACKUP_SELECTED_PROVIDER : "";
    return { flag: true, detail: `${prov} ${cfg.LLM_BACKUP_MODEL}`.trim() };
  }
  return null;
}

const DERIVED_FIELDS = [
  { aliasKeys: ["TTS_FALLBACK", "FALLBACK_VOICE", "BACKUP_VOICE"], compute: deriveVoiceFallback },
  { aliasKeys: ["STT_BACKUP", "STT_FALLBACK", "TRANSCRIBER_FALLBACK"], compute: deriveSttBackup },
  { aliasKeys: ["LLM_BACKUP", "LLM_FALLBACK", "BACKUP_MODEL"], compute: deriveLlmBackup },
];

// All derived key names (aliases + their _DETAIL companions), for diff exclusion.
export const DERIVED_KEYS = new Set(
  DERIVED_FIELDS.flatMap((f) => f.aliasKeys.flatMap((k) => [k, `${k}_DETAIL`])),
);

// Mutates cfg, adding indicative top-level keys. Always emits a boolean (true OR
// false) so config_field can answer "which agents LACK X". Never overwrites an
// existing raw AGENT_METADATA key.
export function applyDerivedFields(cfg) {
  if (!cfg || typeof cfg !== "object") return;
  for (const f of DERIVED_FIELDS) {
    const res = f.compute(cfg);
    const flag = res ? res.flag : false;
    const detail = res ? res.detail : "";
    for (const key of f.aliasKeys) {
      if (!(key in cfg)) cfg[key] = flag;
      const dk = `${key}_DETAIL`;
      if (!(dk in cfg)) cfg[dk] = detail;
    }
  }
}

export function isNoisyField(k) {
  if (DERIVED_KEYS.has(k)) return true;
  const u = String(k).toUpperCase();
  if (u === "AGENT_ID" || u === "TENANT_ID") return true;
  if (/_AT$/.test(u) || /_BY$/.test(u)) return true;
  if (/TIMESTAMP|VERSION|SNAPSHOT|UPDATED|CREATED/.test(u)) return true;
  if (/SECRET_ID$|STORAGE_ID$|_UUID$/.test(u)) return true;
  return false;
}

function stringifyVal(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Recursively sort object keys so JSON.stringify is order-independent.
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") {
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = sortKeys(x[k]);
    return o;
  }
  return x;
}

// Canonical form for equality: null/undefined/blank-string all collapse to null;
// objects/arrays are key-sorted. Prevents ""→null and key-reorder false positives.
function normVal(v) {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  try { return JSON.stringify(sortKeys(v)); } catch { return String(v); }
}

// Compare two parsed config objects; return changed, non-noisy fields. Stored
// old/new are the human-readable stringified values; equality uses normVal.
export function diffConfig(prev, next) {
  const changes = [];
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    if (isNoisyField(k)) continue;
    const pv = (prev || {})[k];
    const nv = (next || {})[k];
    if (normVal(pv) === normVal(nv)) continue;
    changes.push({ field_path: k, old_value: stringifyVal(pv), new_value: stringifyVal(nv) });
  }
  return changes;
}

function newChangeId() {
  try { return crypto.randomUUID(); } catch { return `chg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
}

// Normalize a Snowflake/platform timestamp (e.g. AGENT_METADATA.UPDATED_AT,
// "2026-06-03 15:07:11.071 Z") to a real ISO string. Returns null if absent or
// unparseable, so callers can fall back to the sync run time.
function platformTsToIso(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // "2026-06-03 15:07:11.071 Z" -> "2026-06-03T15:07:11.071Z"
  const norm = s.replace(" ", "T").replace(/\s*Z$/i, "Z").replace(/\s+/g, "");
  const d = new Date(norm);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Query AGENT_METADATA from Snowflake and upsert each row into il_agent_snapshot.
async function syncSnapshots(context, auth, agentIds) {
  if (agentIds.length === 0) return 0;
  const nowIso = new Date().toISOString();
  const rows = await snowflakeQuery(
    auth,
    `SELECT OBJECT_CONSTRUCT(*) AS ROW_JSON FROM ${SNOW_DB}.${SNOW_SCHEMA}.AGENT_METADATA WHERE AGENT_ID IN (${sqlInList(agentIds)})`,
  );
  let n = 0;
  for (const r of rows) {
    const cfg = typeof r.ROW_JSON === "string" ? JSON.parse(r.ROW_JSON) : (r.ROW_JSON || {});
    const agentId = cfg.AGENT_ID;
    if (!agentId) continue;

    applyDerivedFields(cfg); // add indicative top-level keys before diff + persist

    // Diff against the previous snapshot (read before overwriting) and record
    // a change event per changed non-noisy field. Only when a prior snapshot
    // exists, so the first sync never floods the feed.
    const prevMatch = await context.tables.filter(
      "il_agent_snapshot",
      [{ column: "agent_id", operator: "eq", value: agentId }],
      1,
      0,
    );
    if (prevMatch.rows && prevMatch.rows.length > 0) {
      let prevCfg = null;
      try {
        const pj = (prevMatch.rows[0].data ?? {}).config_json;
        prevCfg = pj ? JSON.parse(pj) : null;
      } catch { prevCfg = null; }
      if (prevCfg) {
        // Stamp the change with WHEN the platform recorded the edit
        // (AGENT_METADATA.UPDATED_AT), not when this sync detected it. Falls
        // back to the sync run time only if UPDATED_AT is missing/unparseable.
        const changedAt = platformTsToIso(cfg.UPDATED_AT) || nowIso;
        for (const ch of diffConfig(prevCfg, cfg)) {
          await context.tables.insert("pod_agent_config_changes", {
            id: newChangeId(),
            agent_id: agentId,
            agent_name: cfg.AGENT_NAME ?? null,
            field_path: ch.field_path,
            old_value: ch.old_value != null ? String(ch.old_value).slice(0, 1000) : null,
            new_value: ch.new_value != null ? String(ch.new_value).slice(0, 1000) : null,
            changed_at: changedAt,
            changed_by: "sync",
          });
        }
      }
    }

    await upsertByKey(context, "il_agent_snapshot", "agent_id", agentId, {
      agent_id: agentId,
      agent_name: cfg.AGENT_NAME ?? null,
      agent_display_name: cfg.AGENT_DISPLAY_NAME ?? null,
      tenant_id: cfg.TENANT_ID ?? null,
      tenant_display_name: cfg.TENANT_DISPLAY_NAME ?? null,
      mode: cfg.MODE ?? null,
      locale: cfg.LOCALE ?? null,
      config_json: JSON.stringify(cfg),
      snapshot_at: nowIso,
    });
    n += 1;
  }
  return n;
}

// Query COMMUNICATION and ISSUES from Snowflake and upsert each agent's metrics
// into il_agent_metrics.
async function syncMetrics(context, auth, agentIds) {
  if (agentIds.length === 0) return 0;
  const inList = sqlInList(agentIds);
  const nowIso = new Date().toISOString();
  const [commRows, issueRows] = await Promise.all([
    snowflakeQuery(auth, `
      SELECT AGENT_ID,
             COUNT_IF(CREATED_AT >= DATEADD(hour, -24, CURRENT_TIMESTAMP())) AS CALLS_24H,
             COUNT_IF(CREATED_AT >= DATEADD(day, -7, CURRENT_TIMESTAMP())) / 7.0 AS WEEK_AVG,
             COUNT_IF(CREATED_AT >= DATEADD(day, -7, CURRENT_TIMESTAMP())) AS ACTIVITIES_LAST_WEEK,
             MAX(CREATED_AT) AS LAST_CALL_AT
      FROM ${SNOW_DB}.${SNOW_SCHEMA}.COMMUNICATION
      WHERE AGENT_ID IN (${inList})
      GROUP BY AGENT_ID`),
    snowflakeQuery(auth, `
      SELECT AGENT_ID, COUNT(*) AS OPEN_ISSUES
      FROM ${SNOW_DB}.${SNOW_SCHEMA}.ISSUES
      WHERE AGENT_ID IN (${inList}) AND ISSUE_STATUS IN ('open','in-progress')
      GROUP BY AGENT_ID`),
  ]);
  const issuesById = new Map(issueRows.map((r) => [String(r.AGENT_ID), Number(r.OPEN_ISSUES) || 0]));
  const byId = new Map();
  for (const r of commRows) {
    byId.set(String(r.AGENT_ID), {
      conversations_24h: Number(r.CALLS_24H) || 0,
      conversations_week_avg: Math.round(Number(r.WEEK_AVG) || 0),
      activities_last_week: Number(r.ACTIVITIES_LAST_WEEK) || 0,
      last_call_at: r.LAST_CALL_AT ?? null,
    });
  }
  const ids = new Set([...byId.keys(), ...issuesById.keys()]);
  let n = 0;
  for (const id of ids) {
    const v = byId.get(id) || { conversations_24h: 0, conversations_week_avg: 0, activities_last_week: 0, last_call_at: null };
    await upsertByKey(context, "il_agent_metrics", "agent_id", id, {
      agent_id: id,
      conversations_24h: v.conversations_24h,
      conversations_week_avg: v.conversations_week_avg,
      activities_last_week: v.activities_last_week,
      open_issues: issuesById.get(id) ?? 0,
      last_call_at: v.last_call_at,
      snapshot_at: nowIso,
    });
    n += 1;
  }
  return n;
}

// Aggregate per-agent latency from Snowflake COMM_TURN_LATENCY_STATS (per-turn,
// with the full breakdown). The table is sharded across per-cluster
// PLATFORM_DATA_V2.RAW_V2_*_PROD_WONDERFUL schemas (no unified view), so we
// discover the PROD schemas and UNION them, filtered by AGENT_ID (= our
// platform_agent_id) over the last 7 days. created_at is epoch ms.
// Columns are Airbyte raw lowercase, so they must be double-quoted.
async function syncLatency(context, auth, agentIds) {
  if (!agentIds || agentIds.length === 0) return { ok: true, synced_latency: 0 };
  const schemaRows = await snowflakeQuery(
    auth,
    `SELECT TABLE_SCHEMA AS S FROM PLATFORM_DATA_V2.INFORMATION_SCHEMA.TABLES
     WHERE TABLE_NAME = 'COMM_TURN_LATENCY_STATS' AND TABLE_SCHEMA LIKE 'RAW_V2_%PROD_WONDERFUL'`,
  );
  const schemas = schemaRows.map((r) => r.S).filter(Boolean);
  if (schemas.length === 0) return { ok: true, synced_latency: 0 };

  const inList = sqlInList(agentIds);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Headline latency = LLM generation + tool-call (function request) only;
  // EOT / STT / TTS / telephony are intentionally excluded.
  const sub = (s) =>
    `SELECT "agent_id" aid,"llm_duration_ms" llm,"llm_function_call_request_average_ms" tool ` +
    `FROM PLATFORM_DATA_V2."${s}".COMM_TURN_LATENCY_STATS ` +
    `WHERE "agent_id" IN (${inList}) AND "created_at" >= ${cutoff}`;
  const union = schemas.map(sub).join(" UNION ALL ");
  // latency = avg LLM + avg tool-call. Each AVG ignores null turns; the headline
  // is null only when the agent has neither (so it shows "—", not a fake 0ms).
  const rows = await snowflakeQuery(
    auth,
    `SELECT aid,
            ROUND(AVG(llm)) llm,
            ROUND(AVG(tool)) tool,
            CASE WHEN AVG(llm) IS NULL AND AVG(tool) IS NULL THEN NULL
                 ELSE ROUND(COALESCE(AVG(llm), 0) + COALESCE(AVG(tool), 0)) END lat,
            COUNT(*) turns
     FROM (${union}) GROUP BY aid`,
  );

  const nowIso = new Date().toISOString();
  const num = (v) => (v != null ? Number(v) : null);
  let n = 0;
  for (const r of rows) {
    const aid = r.AID;
    if (!aid) continue;
    await upsertByKey(context, "il_agent_latency", "id", aid, {
      id: aid,
      latency_ms: num(r.LAT),
      llm_ms: num(r.LLM),
      tool_ms: num(r.TOOL),
      turns: num(r.TURNS),
      synced_at: nowIso,
    });
    n++;
  }
  return { ok: true, synced_latency: n };
}

// Classify an agent by its dominant COMMUNICATION.AGENT_TYPE over 7d. An agent
// may span multiple AGENT_TYPE values; return the raw label of the largest
// bucket (Observer / Backoffice / Inbound Call / Outbound Call / Chat).
export function deriveAgentType(counts) {
  const buckets = [
    ["Observer", Number(counts.observer) || 0],
    ["Backoffice", Number(counts.backoffice) || 0],
    ["Inbound Call", Number(counts.inbound) || 0],
    ["Outbound Call", Number(counts.outbound) || 0],
    ["Chat", Number(counts.chat) || 0],
  ];
  let best = null;
  let bestN = 0;
  for (const [label, n] of buckets) {
    if (n > bestN) { best = label; bestN = n; }
  }
  return best;
}

// Discover IL prod agents with >500 communications in the last 7 days and
// refresh il_active_agents (this set drives which agents the app shows).
async function discoverActiveAgents(context, auth) {
  // Count actual communications (the COMMUNICATION table) — not COMM_LATENCY_STATS,
  // which only covers latency-tracked comms and misses agents like aia_v2.
  const rows = await snowflakeQuery(auth, `
    SELECT c.AGENT_ID AS AGENT_ID,
           ANY_VALUE(m.AGENT_NAME) AS AGENT_NAME,
           ANY_VALUE(t.TENANT_DISPLAY_NAME) AS TENANT_DISPLAY_NAME,
           COUNT(*) AS ACTIVITIES,
           COUNT_IF(c.AGENT_TYPE = 'Observer') AS OBSERVER_N,
           COUNT_IF(c.AGENT_TYPE = 'Backoffice') AS BACKOFFICE_N,
           COUNT_IF(c.AGENT_TYPE = 'Inbound Call') AS INBOUND_N,
           COUNT_IF(c.AGENT_TYPE = 'Outbound Call') AS OUTBOUND_N,
           COUNT_IF(c.AGENT_TYPE = 'Chat') AS CHAT_N
    FROM ${SNOW_DB}.${SNOW_SCHEMA}.COMMUNICATION c
    JOIN ${SNOW_DB}.${SNOW_SCHEMA}.AGENT_METADATA m ON c.AGENT_ID = m.AGENT_ID
    JOIN ${SNOW_DB}.${SNOW_SCHEMA}.TENANT t ON m.TENANT_ID = t.TENANT_ID
    WHERE t.ACCOUNT_SITE = 'Israel' AND t.ENVIRONMENT = 'PROD'
      AND c.CREATED_AT >= DATEADD(day, -7, CURRENT_TIMESTAMP())
    GROUP BY c.AGENT_ID
    HAVING COUNT(*) > 500`);
  const nowIso = new Date().toISOString();
  const active = rows
    .map((r) => ({
      agent_id: r.AGENT_ID,
      agent_name: r.AGENT_NAME ?? null,
      tenant_name: r.TENANT_DISPLAY_NAME ?? null,
      activities: r.ACTIVITIES != null ? Number(r.ACTIVITIES) : null,
      agent_type: deriveAgentType({ observer: r.OBSERVER_N, backoffice: r.BACKOFFICE_N, inbound: r.INBOUND_N, outbound: r.OUTBOUND_N, chat: r.CHAT_N }),
    }))
    .filter((a) => a.agent_id);
  const activeIds = new Set(active.map((a) => String(a.agent_id)));
  for (const a of active) {
    await upsertByKey(context, "il_active_agents", "id", a.agent_id, {
      id: a.agent_id,
      agent_name: a.agent_name,
      tenant_name: a.tenant_name,
      activities: a.activities,
      agent_type: a.agent_type,
      synced_at: nowIso,
    });
  }
  // Prune agents that fell below the threshold (best-effort).
  try {
    const existing = await queryAll(context, "il_active_agents");
    for (const row of existing) {
      const id = (row?.data ?? {}).id ?? row?.id;
      if (id && !activeIds.has(String(id))) await context.tables.deleteRow("il_active_agents", row.id ?? id);
    }
  } catch (e) { /* ignore prune errors */ }
  return active;
}

// Standalone entrypoint for the `sync_latency` action: latency for active agents.
async function syncLatencyAction(context) {
  const auth = context.secrets.get("SNOWFLAKE_AUTH");
  if (!auth || !auth.account || !auth.user) return { ok: false, error: "MISSING_SNOWFLAKE_AUTH" };
  const active = await queryAll(context, "il_active_agents");
  const ids = active.map((r) => (r?.data ?? {}).id ?? r?.id).filter(Boolean);
  return await syncLatency(context, auth, ids);
}

// Main sync handler: discover active IL prod agents (>500 comms/7d), then
// snapshot/metrics/latency for that set, and diff config changes.
async function sync(context) {
  const auth = context.secrets.get("SNOWFLAKE_AUTH");
  if (!auth || !auth.account || !auth.user) return { ok: false, error: "MISSING_SNOWFLAKE_AUTH" };
  const active = await discoverActiveAgents(context, auth);
  const agentIds = active.map((a) => a.agent_id);
  const synced_snapshots = await syncSnapshots(context, auth, agentIds);
  const synced_metrics = await syncMetrics(context, auth, agentIds);
  // Best-effort: latency must never break the snapshot/metrics sync.
  let synced_latency = 0;
  try { synced_latency = (await syncLatency(context, auth, agentIds)).synced_latency || 0; } catch (e) { /* ignore */ }
  return { ok: true, active_agents: agentIds.length, synced_snapshots, synced_metrics, synced_latency };
}

function norm(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function reconcileMappings(context) {
  const auth = context.secrets.get("SNOWFLAKE_AUTH");
  if (!auth || !auth.account || !auth.user) return { ok: false, error: "MISSING_SNOWFLAKE_AUTH" };
  const podAgents = await queryAll(context, "pod_agents");
  const unmapped = podAgents.map((r) => r?.data ?? {}).filter((d) => !d.platform_agent_id && d.agent_use_case);
  if (unmapped.length === 0) return { ok: true, applied: [], ambiguous: [], unmatched: [] };

  const candidates = await snowflakeQuery(auth, `
    SELECT m.AGENT_ID, m.AGENT_NAME, m.AGENT_DISPLAY_NAME, t.TENANT_DISPLAY_NAME
    FROM ${SNOW_DB}.${SNOW_SCHEMA}.AGENT_METADATA m
    JOIN ${SNOW_DB}.${SNOW_SCHEMA}.TENANT t ON m.TENANT_ID = t.TENANT_ID
    WHERE t.ACCOUNT_SITE = 'Israel' AND t.ENVIRONMENT = 'PROD'`);

  const applied = [];
  const ambiguous = [];
  const unmatched = [];
  for (const d of unmapped) {
    const target = norm(d.agent_use_case);
    const matches = candidates.filter((c) => {
      const n1 = norm(c.AGENT_NAME), n2 = norm(c.AGENT_DISPLAY_NAME);
      return [n1, n2].some((n) => {
        if (!n) return false;
        if (n === target) return true;
        // Substring matches only count for reasonably long tokens, so a short
        // candidate name (e.g. "chat") can't be auto-applied to a long use_case.
        if (n.length < 8) return false;
        return n.includes(target) || target.includes(n);
      });
    });
    const podAgentId = d.id;
    if (matches.length === 1) {
      await context.tables.update("pod_agents", podAgentId, { platform_agent_id: matches[0].AGENT_ID });
      applied.push({ pod_agent_id: podAgentId, platform_agent_id: matches[0].AGENT_ID });
    } else if (matches.length > 1) {
      ambiguous.push({ pod_agent_id: podAgentId, use_case: d.agent_use_case,
        candidates: matches.map((c) => ({ agent_id: c.AGENT_ID, name: c.AGENT_DISPLAY_NAME, tenant: c.TENANT_DISPLAY_NAME })) });
    } else {
      unmatched.push({ pod_agent_id: podAgentId, use_case: d.agent_use_case });
    }
  }
  return { ok: true, applied, ambiguous, unmatched };
}

export async function userFunction(context) {
  const action = context?.data?.action;
  if (!action) return { ok: false, error: "MISSING_ACTION" };
  try {
    if (action === "sync") return await sync(context);
    if (action === "sync_latency") return await syncLatencyAction(context);
    if (action === "reconcile_mappings") return await reconcileMappings(context);
    return { ok: false, error: `UNKNOWN_ACTION: ${action}` };
  } catch (e) {
    // Surface the real failure instead of the runtime's generic
    // "function execution failed" so the caller can diagnose.
    let detail = null;
    try { detail = e && e.payload ? JSON.stringify(e.payload) : null; } catch { detail = null; }
    return { ok: false, error: String(e && e.message ? e.message : e), detail };
  }
}
