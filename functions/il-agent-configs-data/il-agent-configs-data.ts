// Source of the il-agent-configs-data-v1 Wonderful Function.
//
// HTTP endpoint that the `apps/il-agent-configs` Wonderful App calls to load
// and mutate IL agent config data. The Wonderful Functions runtime calls a
// top-level `userFunction(context)` — there is no second `input` argument.
// Inputs arrive on `context.data.{action,payload}` per the deploy script's
// `param_mapping.body_params` (see `deploy-function.mjs`). This mirrors the
// canonical pattern in `functions/staffing-data/pod-staffing-data.ts`.
//
// NOTE: top-level `export` keywords are stripped at deploy time (see
// `deploy-function.mjs`). The `export` on `userFunction` is for vitest only —
// esbuild's regex pass strips it before deploy.

const ROLE_DS = new Set(["DS", "Data Scientist"]);
const ROLE_FDE = new Set(["FDE", "Forward Deployed Engineer"]);

const personName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(" ");

// Page through all rows of a custom table via the in-runtime SDK
// (`context.tables.query`). Mirrors the helper in
// `functions/staffing-data/pod-staffing-data.ts`. Using the SDK instead of raw
// fetch is required because `context.metadata.tenantId` is a UUID, not the
// hostname slug — building `https://<uuid>.api.wonderful.ai/...` won't resolve
// from inside the function runtime.
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

// Parse a config_json string into a plain object. Returns `{}` on any failure
// (missing field, malformed JSON) so callers can treat it as an empty config.
function parseConfigJson(s) {
  if (!s || typeof s !== "string") return {};
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Coerce a config_json scalar to a boolean. OBJECT_CONSTRUCT may serialize
// booleans as real booleans, the strings "true"/"false", or 1/0. Naive
// truthiness is wrong here ("false" is a truthy string), so match explicitly.
function asBool(v) {
  return v === true || v === 1 || v === "1" || v === "true" || v === "TRUE";
}

// Trimmed string, or null for null/undefined/blank values.
function asStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

// Render a "provider · model" string. Shows whichever side exists; null only
// when both are blank. The middle dot is the agreed card separator.
function joinProviderModel(provider, model) {
  const p = asStr(provider);
  const m = asStr(model);
  if (p && m) return `${p} · ${m}`;
  return p || m || null;
}

// Primary STT model, selected by the active provider — provider-specific model
// columns stay populated as boilerplate even when inactive, so we must read the
// one that matches TRANSCRIBER_PRIMARY_PROVIDER (aws/azure have no model slug).
function sttPrimaryModel(cfg) {
  const p = String(asStr(cfg.TRANSCRIBER_PRIMARY_PROVIDER) ?? "").toLowerCase();
  if (p.startsWith("soniox_batch")) return asStr(cfg.TRANSCRIBER_PRIMARY_SONIOX_BATCH_MODEL);
  if (p.startsWith("soniox")) return asStr(cfg.TRANSCRIBER_PRIMARY_SONIOX_MODEL);
  if (p.startsWith("deepgram")) return asStr(cfg.TRANSCRIBER_PRIMARY_DEEPGRAM_MODEL);
  if (p.startsWith("wonderful")) return asStr(cfg.TRANSCRIBER_PRIMARY_WONDERFUL_STT_MODEL);
  if (p.startsWith("qwen")) return asStr(cfg.TRANSCRIBER_PRIMARY_QWEN_MODEL);
  if (p.startsWith("speechmatics")) return asStr(cfg.TRANSCRIBER_PRIMARY_SPEECHMATICS_OPERATING_POINT);
  return null;
}

// Primary TTS model/voice, selected by VOICE_PRIMARY_ENDPOINT_PROVIDER.
function ttsPrimaryModel(cfg) {
  const p = String(asStr(cfg.VOICE_PRIMARY_ENDPOINT_PROVIDER) ?? "").toLowerCase();
  if (p === "deepdub") return asStr(cfg.VOICE_PRIMARY_DEEPDUB_MODEL_ID);
  if (p === "elevenlabs") return asStr(cfg.VOICE_PRIMARY_ELEVENLABS_MODEL_ID);
  if (p === "deepgram") return asStr(cfg.VOICE_PRIMARY_DEEPGRAM_MODEL);
  if (p === "google") return asStr(cfg.VOICE_PRIMARY_GOOGLE_MODEL);
  if (p === "minimax") return asStr(cfg.VOICE_PRIMARY_MINIMAX_VOICE_ID);
  if (p === "openai_realtime") return asStr(cfg.VOICE_PRIMARY_OPENAI_REALTIME_VOICE);
  if (p === "gradium") return asStr(cfg.VOICE_PRIMARY_GRADIUM_VOICE_ID);
  return null;
}

// Fallbacks live in the nested config blobs (the flat *_BACKUP_* columns are
// unused). null when no backup is configured → UI shows "no fallback".
function llmFallback(cfg) {
  const ep = cfg?.LLM_CONFIGURATION?.backup_endpoints?.[0];
  return ep ? joinProviderModel(ep.selected_provider, ep.model) : null;
}

function ttsFallback(cfg) {
  const ep = cfg?.VOICE_CONFIGURATION?.backup_endpoints?.[0];
  if (!ep) return null;
  const provider = asStr(ep.provider);
  const sub = provider ? ep[provider.toLowerCase()] : null;
  const model = sub
    ? asStr(sub.model_id) ?? asStr(sub.model) ?? asStr(sub.voice_id) ?? asStr(sub.voice)
    : null;
  return joinProviderModel(provider, model);
}

function sttFallback(cfg) {
  const bk = cfg?.TRANSCRIBER_CONFIGURATION?.backups?.[0];
  if (!bk) return null;
  // The backup provider is whichever sub-object is enabled. soniox_batch before
  // soniox so the more specific key wins.
  const order = ["soniox_batch", "soniox", "deepgram", "aws", "azure", "speechmatics", "wonderful_stt", "qwen"];
  let provider = null;
  let sub = null;
  for (const key of order) {
    if (bk[key] && bk[key].enabled === true) { provider = key; sub = bk[key]; break; }
  }
  if (!provider) return null;
  const model = sub ? (asStr(sub.model) ?? asStr(sub.operating_point)) : null;
  return joinProviderModel(provider, model);
}

// Build the card-face fields from a parsed AGENT_METADATA config object. Each of
// LLM / STT / TTS is surfaced as "provider · model" with a fallback counterpart
// (from the *_CONFIGURATION backup endpoints; null when none). skills_behavior
// is still derived for API consumers.
//
// Backoffice exception: a backoffice agent's LLM_MODEL is leftover *-realtime
// voice boilerplate from the source agent. The model that runs its tasks is
// LLM_TASK_MODEL — the "legacy backoffice model" in the agent UI — so we
// surface that (no provider, no fallback) as agent_model. (STT/TTS/latency are
// hidden for backoffice in the UI.)
function deriveCardFields(cfg, agentType) {
  let skills;
  if (!asBool(cfg.IS_MULTI_SKILL)) {
    skills = "Static";
  } else {
    const mode = asStr(cfg.SWITCH_MODE);
    skills = mode ? `Dynamic (${mode.toLowerCase().replace(/_/g, " ")})` : "Dynamic";
  }
  const isBackoffice = String(agentType ?? "").toLowerCase() === "backoffice";
  const agentModel = isBackoffice
    ? asStr(cfg.LLM_TASK_MODEL)
    : joinProviderModel(cfg.LLM_SELECTED_PROVIDER, cfg.LLM_MODEL);
  return {
    agent_model: agentModel,
    agent_model_fallback: isBackoffice ? null : llmFallback(cfg),
    stt_model: joinProviderModel(cfg.TRANSCRIBER_PRIMARY_PROVIDER, sttPrimaryModel(cfg)),
    stt_model_fallback: sttFallback(cfg),
    tts_model: joinProviderModel(cfg.VOICE_PRIMARY_ENDPOINT_PROVIDER, ttsPrimaryModel(cfg)),
    tts_model_fallback: ttsFallback(cfg),
    skills_behavior: skills,
  };
}

// Normalize a customer/tenant name for matching pods ↔ tenants.
function normName(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Some agents live in a shared Snowflake tenant (e.g. "Prod") but belong to a
// real customer. Override the customer by agent name where the tenant is wrong.
function overrideCustomer(agentName, tenantName) {
  const n = normName(agentName);
  if (n.startsWith("adi")) return "Discount"; // Adi private/public (dynamic) are Discount's agents
  if (n === "transcriptionagent") return "Discount"; // shared "Prod" tenant, but a Discount agent
  if (n === "manor31") return "Menora"; // manor_3_1 (shared "Prod" tenant) is Menora's agent
  const t = normName(tenantName);
  if (t === "librastage") return "Libra"; // Libra-Stage tenant rolls up to the Libra customer
  return tenantName;
}

async function getOverview(context) {
  const [pods, assignments, people, snapshots, metrics, latencies, activeAgents] = await Promise.all([
    queryAll(context, "pods"),
    queryAll(context, "pod_assignments"),
    queryAll(context, "people"),
    queryAll(context, "il_agent_snapshot"),
    queryAll(context, "il_agent_metrics"),
    queryAll(context, "il_agent_latency"),
    queryAll(context, "il_active_agents"),
  ]);

  const peopleById = new Map();
  for (const row of people) {
    const d = row?.data ?? {};
    const key = d.id ?? row?.id;
    if (key != null) peopleById.set(String(key), d);
  }

  const dsByPod = new Map();
  const fdeByPod = new Map();
  for (const row of assignments) {
    const d = row?.data ?? {};
    const podId = d.pod_id;
    const personId = d.person_id;
    const role = d.role;
    if (!podId || !personId || !role) continue;
    const person = peopleById.get(String(personId));
    if (!person) continue;
    const name = personName(person);
    if (!name) continue;
    if (ROLE_DS.has(role)) {
      if (!dsByPod.has(podId)) dsByPod.set(podId, []);
      dsByPod.get(podId).push(name);
    } else if (ROLE_FDE.has(role)) {
      if (!fdeByPod.has(podId)) fdeByPod.set(podId, []);
      fdeByPod.get(podId).push(name);
    }
  }

  // Pod context keyed by normalized customer (pod_name) so an active agent's
  // tenant inherits tier / Slack / owners when the tenant is a known pod.
  const podByCustomer = new Map();
  for (const row of pods) {
    const d = row?.data ?? {};
    const name = d.pod_name;
    if (!name) continue;
    podByCustomer.set(normName(name), {
      pod_id: d.id ?? row?.id,
      tier: d.tier ?? "Unspecified",
      slack_channel_id: d.slack_channel_id ?? null,
      slack_channel_name: d.slack_channel_name ?? null,
    });
  }

  const snapshotByAgentId = new Map();
  for (const row of snapshots) {
    const d = row?.data ?? {};
    if (d.agent_id != null) snapshotByAgentId.set(String(d.agent_id), d);
  }
  const metricsByAgentId = new Map();
  for (const row of metrics) {
    const d = row?.data ?? {};
    if (d.agent_id != null) metricsByAgentId.set(String(d.agent_id), d);
  }
  const latencyByAgentId = new Map();
  for (const row of latencies) {
    const d = row?.data ?? {};
    if (d.id != null) latencyByAgentId.set(String(d.id), d);
  }

  // Build the displayed set from active agents (>500 comms/7d), grouped by
  // customer (tenant), inheriting pod context where the tenant is a known pod.
  const entriesByCustomer = new Map();
  for (const row of activeAgents) {
    const a = row?.data ?? {};
    const agentId = a.id;
    if (!agentId) continue;
    const customer = overrideCustomer(a.agent_name, a.tenant_name ?? "Unknown");
    const pod = podByCustomer.get(normName(customer));

    const snapshotRow = snapshotByAgentId.get(String(agentId));
    const card = snapshotRow
      ? deriveCardFields(parseConfigJson(snapshotRow.config_json), a.agent_type)
      : { agent_model: null, agent_model_fallback: null, stt_model: null, stt_model_fallback: null, tts_model: null, tts_model_fallback: null, skills_behavior: null };
    const metricsRow = metricsByAgentId.get(String(agentId));
    const lat = latencyByAgentId.get(String(agentId));

    const agent = {
      pod_agent_id: agentId,
      platform_agent_id: agentId,
      use_case: (snapshotRow && snapshotRow.agent_display_name) || a.agent_name || null,
      agent_name: (snapshotRow && snapshotRow.agent_name) || a.agent_name || null,
      conversations_24h: metricsRow ? (metricsRow.conversations_24h ?? null) : null,
      conversations_week_avg: metricsRow ? (metricsRow.conversations_week_avg ?? null) : null,
      open_issues: metricsRow ? (metricsRow.open_issues ?? null) : null,
      last_call_at: metricsRow ? (metricsRow.last_call_at ?? null) : null,
      activities: a.activities ?? null,
      agent_type: a.agent_type ?? null,
      agent_model: card.agent_model,
      agent_model_fallback: card.agent_model_fallback,
      stt_model: card.stt_model,
      stt_model_fallback: card.stt_model_fallback,
      tts_model: card.tts_model,
      tts_model_fallback: card.tts_model_fallback,
      skills_behavior: card.skills_behavior,
      latency_ms: lat && lat.latency_ms != null ? lat.latency_ms : null,
      latency_breakdown: lat ? { llm_ms: lat.llm_ms ?? null, tool_ms: lat.tool_ms ?? null } : null,
    };

    const key = pod ? `pod:${pod.pod_id}` : `tenant:${normName(customer)}`;
    let entry = entriesByCustomer.get(key);
    if (!entry) {
      entry = {
        pod_id: pod ? pod.pod_id : key,
        customer,
        tier: pod ? pod.tier : "Unspecified",
        slack_channel_id: pod ? pod.slack_channel_id : null,
        slack_channel_name: pod ? pod.slack_channel_name : null,
        ds: pod ? (dsByPod.get(pod.pod_id) ?? []) : [],
        fde: pod ? (fdeByPod.get(pod.pod_id) ?? []) : [],
        agents: [],
      };
      entriesByCustomer.set(key, entry);
    }
    entry.agents.push(agent);
  }

  // Also surface pods that have a Slack channel but no active agents (e.g. the
  // CTO Office channel) so they can be targeted from the Slack composer. These
  // carry empty agents[], so the Overview/Agents views — which require at least
  // one agent — drop them; only the Slack modal's channel picker shows them.
  for (const row of pods) {
    const d = row?.data ?? {};
    const podId = d.id ?? row?.id;
    if (!podId || !d.slack_channel_id) continue;
    const key = `pod:${podId}`;
    if (entriesByCustomer.has(key)) continue;
    entriesByCustomer.set(key, {
      pod_id: podId,
      customer: d.pod_name ?? podId,
      tier: d.tier ?? "Unspecified",
      slack_channel_id: d.slack_channel_id,
      slack_channel_name: d.slack_channel_name ?? null,
      ds: dsByPod.get(podId) ?? [],
      fde: fdeByPod.get(podId) ?? [],
      agents: [],
    });
  }

  const tiers = {};
  for (const entry of entriesByCustomer.values()) {
    const tier = entry.tier || "Unspecified";
    if (!tiers[tier]) tiers[tier] = [];
    tiers[tier].push(entry);
  }

  return { ok: true, tiers };
}

async function getAgentDetail(context, payload) {
  const { platform_agent_id, use_case } = payload;
  if (!platform_agent_id || !use_case) return { ok: false, error: "MISSING_FIELDS" };

  const snapMatches = await context.tables.filter(
    "il_agent_snapshot",
    [{ column: "agent_id", operator: "eq", value: platform_agent_id }],
    1,
    0,
  );
  if (!snapMatches.rows || snapMatches.rows.length === 0) {
    return { ok: false, error: "AGENT_NOT_FOUND" };
  }
  const snapshotRow = snapMatches.rows[0].data ?? {};
  const snapshotCfg = parseConfigJson(snapshotRow.config_json);

  const fields = Object.keys(snapshotCfg)
    .sort()
    .map((path) => ({ path, value: snapshotCfg[path] }));

  return { ok: true, use_case, platform_agent_id, fields };
}

async function listChanges(context, payload) {
  const limit = Math.max(1, Math.min(500, Number(payload?.limit ?? 100)));
  const scopeId = payload?.scope_id;

  const [changeRows, activeAgents] = await Promise.all([
    scopeId
      ? context.tables
          .filter("pod_agent_config_changes", [{ column: "scope_id", operator: "eq", value: scopeId }], 1000, 0)
          .then((res) => res.rows || [])
      : queryAll(context, "pod_agent_config_changes"),
    queryAll(context, "il_active_agents"),
  ]);

  // Map agent_id -> customer (tenant with the same override rules as the
  // overview) so changes can be filtered by customer in the UI.
  const customerByAgentId = new Map();
  for (const row of activeAgents) {
    const a = row?.data ?? {};
    if (a.id != null) customerByAgentId.set(String(a.id), overrideCustomer(a.agent_name, a.tenant_name ?? null));
  }

  // Sort by `changed_at` desc (ISO strings sort lexicographically).
  const sorted = changeRows
    .map((r) => r?.data ?? {})
    .sort((a, b) => {
      const av = String(a.changed_at ?? "");
      const bv = String(b.changed_at ?? "");
      if (av < bv) return 1;
      if (av > bv) return -1;
      return 0;
    })
    .slice(0, limit)
    .map((c) => ({ ...c, customer: c.agent_id != null ? (customerByAgentId.get(String(c.agent_id)) ?? null) : null }));

  return { ok: true, changes: sorted };
}

export async function userFunction(context) {
  const action = context?.data?.action;
  const payload = context?.data?.payload || {};
  if (!action) return { ok: false, error: "MISSING_ACTION" };
  if (action === "get_overview") return getOverview(context);
  if (action === "get_agent_detail") return getAgentDetail(context, payload);
  if (action === "list_changes") return listChanges(context, payload);
  return { ok: false, error: `UNKNOWN_ACTION: ${action}` };
}
