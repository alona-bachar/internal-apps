const TABLES = {
  pods: "pods",
  people: "people",
  assignments: "pod_assignments",
  weekly: "pod_staffing_by_week",
  goLives: "go_lives",
  assignmentEvents: "pod_assignment_events",
  podAgents: "pod_agents",
  documentationProgress: "pod_documentation_progress",
  agentLatency: "il_agent_latency",
  agentSnapshot: "il_agent_snapshot",
  agentMetrics: "il_agent_metrics",
};

// Tables the generic read_table/list_tables tools may read. Excludes
// podi_authorized_users (access-control infra, not ops data).
const READABLE_TABLES = [
  "pods",
  "people",
  "pod_assignments",
  "pod_staffing_by_week",
  "pod_agents",
  "go_lives",
  "pod_assignment_events",
  "pod_documentation_progress",
  "il_agent_snapshot",
  "il_agent_metrics",
  "il_agent_latency",
  "pod_agent_config_changes",
];

const POD_AGENT_FIELDS = new Set([
  "pod_id",
  "agent_use_case",
  "live_pct",
  "april_consumption",
  "may_projection",
  "june_projection",
  "full_potential",
  "notes",
]);

const GO_LIVE_FIELDS = new Set([
  "pod_id", "customer_name", "agent_name", "go_live_date", "use_case", "status", "notes",
  "channel", "volume_unit", "target_monthly_volume", "full_potential_volume",
  "june_projection", "rollout_type",
]);

const GO_LIVE_NUMERIC_FIELDS = new Set([
  "target_monthly_volume", "full_potential_volume", "june_projection",
]);

function cleanNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const CERT_FIELDS = new Set([
  "certification_status",
  "cert1_status", "cert1_date",
  "cert2_status", "cert2_date",
  "cert3_status", "cert3_date",
]);

function emailRequiredError(reason) {
  const err = new Error(`EMAIL_REQUIRED: ${reason}`);
  err.code = "EMAIL_REQUIRED";
  err.reason = reason;
  err.action_to_resolve = "Add email to this person first.";
  return err;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanDate(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function cleanAllocationPct(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(num)));
  return clamped;
}

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

async function loadPerson(context, personId) {
  const people = await queryAll(context, TABLES.people);
  return people.find((p) => p.id === personId);
}

async function requireEmail(context, personId, reason) {
  const person = await loadPerson(context, personId);
  if (!person) throw new Error(`Unknown person_id: ${personId}`);
  const email = (person.data && person.data.email) || person.email;
  if (!email || !String(email).trim()) {
    throw emailRequiredError(reason);
  }
}

function patchHasCertValue(patch) {
  return Object.keys(patch).some((key) => CERT_FIELDS.has(key) && patch[key]);
}

export type EventDescriptor = {
  event_type: "assigned" | "status_changed" | "unassigned";
  pod_id: string | null;
  person_id: string | null;
  role: string | null;
  from_status: string | null;
  to_status: string | null;
  assignment_id: string;
  occurred_at: string;
  source: string;
};

export function computeEventsForUpdate(
  oldData: {
    pod_id?: string | null;
    person_id?: string | null;
    role?: string | null;
    status?: string | null;
  },
  newData: {
    pod_id?: string | null;
    person_id?: string | null;
    role?: string | null;
    status?: string | null;
  },
  meta: { assignment_id: string; occurred_at: string; source: string },
): EventDescriptor[] {
  const tenureChanged =
    (oldData.pod_id ?? null) !== (newData.pod_id ?? null) ||
    (oldData.person_id ?? null) !== (newData.person_id ?? null) ||
    (oldData.role ?? null) !== (newData.role ?? null);

  if (tenureChanged) {
    const events: EventDescriptor[] = [];
    if (oldData.person_id) {
      events.push({
        event_type: "unassigned",
        pod_id: oldData.pod_id ?? null,
        person_id: oldData.person_id,
        role: oldData.role ?? null,
        from_status: oldData.status ?? null,
        to_status: null,
        assignment_id: meta.assignment_id,
        occurred_at: meta.occurred_at,
        source: meta.source,
      });
    }
    if (newData.person_id) {
      events.push({
        event_type: "assigned",
        pod_id: newData.pod_id ?? null,
        person_id: newData.person_id,
        role: newData.role ?? null,
        from_status: null,
        to_status: newData.status ?? null,
        assignment_id: meta.assignment_id,
        occurred_at: meta.occurred_at,
        source: meta.source,
      });
    }
    return events;
  }

  if ((oldData.status ?? null) !== (newData.status ?? null)) {
    return [
      {
        event_type: "status_changed",
        pod_id: newData.pod_id ?? null,
        person_id: newData.person_id ?? null,
        role: newData.role ?? null,
        from_status: oldData.status ?? null,
        to_status: newData.status ?? null,
        assignment_id: meta.assignment_id,
        occurred_at: meta.occurred_at,
        source: meta.source,
      },
    ];
  }

  return [];
}

export function computeEventsForCreate(
  newData: {
    pod_id?: string | null;
    person_id?: string | null;
    role?: string | null;
    status?: string | null;
  },
  meta: { assignment_id: string; occurred_at: string; source: string },
): EventDescriptor[] {
  if (!newData.person_id) return [];
  return [
    {
      event_type: "assigned",
      pod_id: newData.pod_id ?? null,
      person_id: newData.person_id,
      role: newData.role ?? null,
      from_status: null,
      to_status: newData.status ?? null,
      assignment_id: meta.assignment_id,
      occurred_at: meta.occurred_at,
      source: meta.source,
    },
  ];
}

export function computeEventsForDelete(
  oldData: {
    pod_id?: string | null;
    person_id?: string | null;
    role?: string | null;
    status?: string | null;
  },
  meta: { assignment_id: string; occurred_at: string; source: string },
): EventDescriptor[] {
  if (!oldData.person_id) return [];
  return [
    {
      event_type: "unassigned",
      pod_id: oldData.pod_id ?? null,
      person_id: oldData.person_id,
      role: oldData.role ?? null,
      from_status: oldData.status ?? null,
      to_status: null,
      assignment_id: meta.assignment_id,
      occurred_at: meta.occurred_at,
      source: meta.source,
    },
  ];
}

async function emitEvents(
  context: any,
  events: EventDescriptor[],
) {
  for (const event of events) {
    try {
      await context.tables.insert(TABLES.assignmentEvents, {
        id: newId(),
        ...event,
      });
    } catch (err) {
      // History writes are best-effort: never block the real mutation.
      // Surface the failure in logs only.
      // eslint-disable-next-line no-console
      console.error("pod_assignment_events insert failed", {
        event_type: event.event_type,
        assignment_id: event.assignment_id,
        err,
      });
    }
  }
}

export async function userFunction(context) {
  const action = context.data.action || "load";
  const payload = context.data.payload || {};

  if (action === "load") {
    const [pods, people, assignments, weekly, goLives] = await Promise.all([
      queryAll(context, TABLES.pods),
      queryAll(context, TABLES.people),
      queryAll(context, TABLES.assignments),
      queryAll(context, TABLES.weekly),
      queryAll(context, TABLES.goLives),
    ]);
    return { pods, people, assignments, weekly, go_lives: goLives };
  }

  if (action === "syncClickUpCerts") {
    const tokenSecret = context.secrets.get("CLICKUP_API_TOKEN");
    const token = tokenSecret && (tokenSecret.api_key || tokenSecret.value || tokenSecret);
    if (!token || typeof token !== "string") {
      return { ok: false, reason: "missing_secret", message: "CLICKUP_API_TOKEN tenant secret is not configured." };
    }
    const listId = (payload && payload.list_id) || "901523017625";
    const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=true`;
    let listResp;
    try {
      listResp = await fetch(url, { headers: { Authorization: token } });
    } catch (err) {
      return { ok: false, reason: "clickup_unreachable", message: String(err && err.message ? err.message : err) };
    }
    if (!listResp.ok) {
      const text = await listResp.text();
      return { ok: false, reason: "clickup_http_error", status: listResp.status, body: text.slice(0, 400) };
    }
    const listJson = await listResp.json();
    const tasks = Array.isArray(listJson.tasks) ? listJson.tasks : [];

    const people = await queryAll(context, TABLES.people);
    const peopleById = new Map(people.map((r) => [r.id, r]));
    const peopleByClickup = new Map();
    const peopleByName = new Map();
    for (const r of people) {
      const d = (r && r.data) || {};
      if (d.clickup_task_id) peopleByClickup.set(String(d.clickup_task_id), r);
      const fullName = `${String(d.first_name ?? "").trim()} ${String(d.last_name ?? "").trim()}`.trim().toLowerCase();
      if (fullName) peopleByName.set(fullName, r);
    }

    function stripSuffix(name) {
      return String(name ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    }
    function splitName(name) {
      const parts = String(name ?? "").trim().split(/\s+/);
      const first = parts[0] || name;
      const last = parts.slice(1).join(" ") || null;
      return { first_name: first, last_name: last };
    }
    function epochToIsoDate(ms) {
      if (ms === null || ms === undefined || ms === "") return null;
      const n = Number(ms);
      if (!Number.isFinite(n)) return null;
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return null;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    function mapStatus(clickupStatus, dueDate) {
      const s = String(clickupStatus ?? "").trim().toLowerCase();
      if (s === "closed") return "Passed";
      if (s === "in progress") return "In Progress";
      if (s === "not started") return dueDate ? "Scheduled" : "Not Scheduled";
      return clickupStatus ? String(clickupStatus) : null;
    }
    function currentAttemptForPerson(data) {
      const explicit = [data.cert1_status, data.cert2_status, data.cert3_status];
      for (let i = 2; i >= 0; i--) {
        const v = explicit[i];
        if (v && String(v).trim()) return (i + 1);
      }
      const overall = String(data.certification_status ?? "").trim().toLowerCase();
      if (overall === "scheduled 3") return 3;
      if (overall === "scheduled 2") return 2;
      return 1;
    }

    const summary = { processed: 0, updated: 0, created: 0, unchanged: 0, errors: [] };

    for (const task of tasks) {
      try {
        summary.processed += 1;
        const rawName = task.name || "";
        const cleanName = stripSuffix(rawName);
        if (!cleanName) continue;
        const { first_name, last_name } = splitName(cleanName);
        const clickupTaskId = String(task.id || "");
        const statusObj = task.status || {};
        const cuStatus = statusObj.status || "";
        const dueIso = epochToIsoDate(task.due_date);
        const certStatus = mapStatus(cuStatus, dueIso);

        let person = clickupTaskId ? peopleByClickup.get(clickupTaskId) : null;
        if (!person && first_name) {
          const key = `${first_name} ${last_name || ""}`.trim().toLowerCase();
          person = peopleByName.get(key) || null;
        }

        if (!person) {
          const createdId = newId();
          const newRow = {
            id: createdId,
            first_name,
            last_name,
            role: "Forward Deployed Engineer",
            status: "Onboarding",
            cert1_status: certStatus,
            cert1_date: dueIso,
            clickup_task_id: clickupTaskId,
          };
          await context.tables.insert(TABLES.people, newRow);
          summary.created += 1;
          continue;
        }

        const data = (person && person.data) || {};
        const attempt = currentAttemptForPerson(data);
        const patch = {};
        const certStatusField = `cert${attempt}_status`;
        const certDateField = `cert${attempt}_date`;
        if (certStatus !== undefined && data[certStatusField] !== certStatus) patch[certStatusField] = certStatus;
        if (dueIso !== undefined && data[certDateField] !== dueIso) patch[certDateField] = dueIso;
        if (certStatus === "Passed" && data.certification_status !== "Passed") {
          patch.certification_status = "Passed";
        }
        if (!data.clickup_task_id && clickupTaskId) patch.clickup_task_id = clickupTaskId;

        if (Object.keys(patch).length === 0) {
          summary.unchanged += 1;
          continue;
        }
        await context.tables.update(TABLES.people, person.id, patch);
        summary.updated += 1;
      } catch (err) {
        summary.errors.push({
          task_id: task && task.id,
          task_name: task && task.name,
          error: String(err && err.message ? err.message : err),
        });
      }
    }

    const refreshed = await queryAll(context, TABLES.people);
    return { ok: true, summary, people: refreshed };
  }

  // ----- Compact reads (see DESIGN.md "Read-side noise reduction") -----
  //
  // Background: `load` returns every row × every column, which works for the
  // React app (it renders everything) but creates massive context noise for
  // the agent. The agent only needs:
  //   1. A small planning view to resolve names + know what exists.
  //   2. Filtered dossier reads when answering a specific question.
  //
  // The actions below preserve `load`'s shape exactly so the React app is
  // untouched, and add narrower views the agent calls instead.

  if (action === "loadCompact") {
    const [pods, people, assignments, weekly, goLives] = await Promise.all([
      queryAll(context, TABLES.pods),
      queryAll(context, TABLES.people),
      queryAll(context, TABLES.assignments),
      queryAll(context, TABLES.weekly),
      queryAll(context, TABLES.goLives),
    ]);
    return {
      pods: pods.map((r) => {
        const d = (r && r.data) || {};
        return { id: r.id, data: { pod_name: d.pod_name ?? null, tier: d.tier ?? null } };
      }),
      people: people.map((r) => {
        const d = (r && r.data) || {};
        return {
          id: r.id,
          data: {
            first_name: d.first_name ?? null,
            last_name: d.last_name ?? null,
            role: d.role ?? null,
            status: d.status ?? null,
          },
        };
      }),
      assignments: assignments.map((r) => {
        const d = (r && r.data) || {};
        return {
          id: r.id,
          data: {
            pod_id: d.pod_id ?? null,
            person_id: d.person_id ?? null,
            role: d.role ?? null,
            status: d.status ?? null,
          },
        };
      }),
      weekly: weekly.map((r) => {
        const d = (r && r.data) || {};
        return {
          id: r.id,
          data: {
            pod_id: d.pod_id ?? null,
            deployment_strategist_goal: d.deployment_strategist_goal ?? null,
            fde_missing_count: d.fde_missing_count ?? null,
            total_fde_needed: d.total_fde_needed ?? null,
          },
        };
      }),
      go_lives: goLives.map((r) => {
        const d = (r && r.data) || {};
        return {
          id: r.id,
          data: {
            pod_id: d.pod_id ?? null,
            customer_name: d.customer_name ?? null,
            agent_name: d.agent_name ?? null,
            go_live_date: d.go_live_date ?? null,
            status: d.status ?? null,
          },
        };
      }),
    };
  }

  if (action === "getPodSummary") {
    const podId = cleanString(payload.pod_id);
    const podName = cleanString(payload.pod_name);
    if (!podId && !podName) throw new Error("pod_id or pod_name is required");
    const pods = await queryAll(context, TABLES.pods);
    const pod = podId
      ? pods.find((p: any) => p.id === podId)
      : pods.find((p: any) => {
          const d = (p && p.data) || {};
          return String(d.pod_name ?? "").toLowerCase() === String(podName).toLowerCase();
        });
    if (!pod) return { ok: false, reason: "no_match", query: podId || podName };

    const podRowId = pod.id;
    const [assignments, people, goLives, weekly] = await Promise.all([
      context.tables.filter(
        TABLES.assignments,
        [{ column: "pod_id", operator: "eq", value: podRowId }],
        1000,
        0,
      ),
      queryAll(context, TABLES.people),
      context.tables.filter(
        TABLES.goLives,
        [{ column: "pod_id", operator: "eq", value: podRowId }],
        1000,
        0,
      ),
      context.tables.filter(
        TABLES.weekly,
        [{ column: "pod_id", operator: "eq", value: podRowId }],
        10,
        0,
      ),
    ]);

    const peopleById = new Map();
    for (const p of people) peopleById.set(p.id, (p && p.data) || {});

    const assignmentRows = (assignments && assignments.rows) || [];
    const active = [];
    const openSlots = [];
    for (const a of assignmentRows) {
      const d = (a && a.data) || {};
      const status = d.status ?? null;
      if (status === "Open" || !d.person_id) {
        openSlots.push({
          assignment_id: a.id,
          role: d.role ?? null,
          notes: d.notes ?? null,
        });
      } else {
        const person = peopleById.get(d.person_id) || {};
        active.push({
          assignment_id: a.id,
          person_id: d.person_id,
          first_name: person.first_name ?? null,
          last_name: person.last_name ?? null,
          role: d.role ?? null,
          status,
        });
      }
    }

    const goLiveRows = (goLives && goLives.rows) || [];
    const weeklyRows = (weekly && weekly.rows) || [];
    const w = weeklyRows[0] ? (weeklyRows[0].data || {}) : null;

    return {
      pod: {
        id: pod.id,
        pod_name: pod.data ? pod.data.pod_name ?? null : null,
        tier: pod.data ? pod.data.tier ?? null : null,
      },
      active_assignments: active,
      open_slots: openSlots,
      go_lives: goLiveRows.map((g: any) => ({
        id: g.id,
        agent_name: g.data ? g.data.agent_name ?? null : null,
        go_live_date: g.data ? g.data.go_live_date ?? null : null,
        status: g.data ? g.data.status ?? null : null,
      })),
      weekly: w
        ? {
            deployment_strategist_goal: w.deployment_strategist_goal ?? null,
            fde_missing_count: w.fde_missing_count ?? null,
            total_fde_needed: w.total_fde_needed ?? null,
          }
        : null,
    };
  }

  if (action === "getPersonSummary") {
    const personId = cleanString(payload.person_id);
    if (!personId) throw new Error("person_id is required");
    const people = await queryAll(context, TABLES.people);
    const person = people.find((p: any) => p.id === personId);
    if (!person) return { ok: false, reason: "no_match", query: personId };

    const [assignments, pods] = await Promise.all([
      context.tables.filter(
        TABLES.assignments,
        [{ column: "person_id", operator: "eq", value: personId }],
        1000,
        0,
      ),
      queryAll(context, TABLES.pods),
    ]);
    const podsById = new Map();
    for (const p of pods) podsById.set(p.id, (p && p.data) || {});

    const d = (person && person.data) || {};
    const assignmentRows = (assignments && assignments.rows) || [];
    const moveTo = d.move_to_pod_id ? (podsById.get(d.move_to_pod_id) || {}) : null;

    return {
      person: {
        id: person.id,
        first_name: d.first_name ?? null,
        last_name: d.last_name ?? null,
        role: d.role ?? null,
        status: d.status ?? null,
        email: d.email ?? null,
        expected_start_date: d.expected_start_date ?? null,
      },
      assignments: assignmentRows.map((a: any) => {
        const ad = (a && a.data) || {};
        const pod = ad.pod_id ? (podsById.get(ad.pod_id) || {}) : {};
        return {
          id: a.id,
          pod_id: ad.pod_id ?? null,
          pod_name: pod.pod_name ?? null,
          role: ad.role ?? null,
          status: ad.status ?? null,
        };
      }),
      pending_transition: d.move_to_pod_id
        ? {
            target_pod_id: d.move_to_pod_id,
            target_pod_name: moveTo ? moveTo.pod_name ?? null : null,
            move_date: d.move_date ?? null,
          }
        : null,
    };
  }

  if (action === "listGoLives") {
    const filters: any[] = [];
    const customerName = cleanString(payload.customer_name);
    const agentName = cleanString(payload.agent_name);
    const status = cleanString(payload.status);
    const fromDate = cleanDate(payload.from_date);
    const toDate = cleanDate(payload.to_date);
    if (customerName) filters.push({ column: "customer_name", operator: "eq", value: customerName });
    if (agentName) filters.push({ column: "agent_name", operator: "eq", value: agentName });
    if (status) filters.push({ column: "status", operator: "eq", value: status });
    if (fromDate) filters.push({ column: "go_live_date", operator: "gte", value: fromDate });
    if (toDate) filters.push({ column: "go_live_date", operator: "lte", value: toDate });

    const result = filters.length
      ? await context.tables.filter(TABLES.goLives, filters, 1000, 0)
      : { rows: await queryAll(context, TABLES.goLives) };
    const rows = (result && result.rows) || [];
    return {
      go_lives: rows.map((g: any) => {
        const d = (g && g.data) || {};
        return {
          id: g.id,
          pod_id: d.pod_id ?? null,
          customer_name: d.customer_name ?? null,
          agent_name: d.agent_name ?? null,
          go_live_date: d.go_live_date ?? null,
          status: d.status ?? null,
        };
      }),
      count: rows.length,
    };
  }

  if (action === "listOpenSlots") {
    const tier = cleanString(payload.tier);
    const result = await context.tables.filter(
      TABLES.assignments,
      [{ column: "status", operator: "eq", value: "Open" }],
      1000,
      0,
    );
    const rows = (result && result.rows) || [];
    const pods = await queryAll(context, TABLES.pods);
    const podsById = new Map();
    for (const p of pods) podsById.set(p.id, (p && p.data) || {});

    const out = [];
    for (const a of rows) {
      const d = (a && a.data) || {};
      const pod = d.pod_id ? (podsById.get(d.pod_id) || {}) : {};
      if (tier && (pod.tier ?? "") !== tier) continue;
      out.push({
        assignment_id: a.id,
        pod_id: d.pod_id ?? null,
        pod_name: pod.pod_name ?? null,
        pod_tier: pod.tier ?? null,
        role: d.role ?? null,
        notes: d.notes ?? null,
      });
    }
    return { open_slots: out, count: out.length };
  }

  if (action === "createPod") {
    const name = cleanString(payload.pod_name);
    if (!name) throw new Error("pod_name is required");
    // Always mint a fresh UUID — never trust client-provided IDs.
    const id = newId();
    const pod = await context.tables.insert(TABLES.pods, {
      id,
      pod_name: name,
      tier: cleanString(payload.tier) || "Tier 3",
    });
    let weekly = null;
    try {
      weekly = await context.tables.insert(TABLES.weekly, {
        id,
        pod_id: id,
        last_updated: todayDate(),
      });
    } catch (error) {
      weekly = { warning: String(error && error.message ? error.message : error) };
    }
    return { pod, weekly };
  }

  if (action === "createPerson") {
    const firstName = cleanString(payload.first_name);
    if (!firstName) throw new Error("first_name is required");
    // Always mint a fresh UUID — names duplicate, IDs must not.
    const id = newId();
    const incomingEmail = cleanString(payload.email);
    if (patchHasCertValue(payload) && !incomingEmail) {
      throw emailRequiredError("createPerson with cert fields requires email");
    }
    const person = await context.tables.insert(TABLES.people, {
      id,
      first_name: firstName,
      last_name: cleanString(payload.last_name),
      email: incomingEmail,
      role: cleanString(payload.role) || "Forward Deployed Engineer",
      status: cleanString(payload.status) || "Onboarding",
      expected_start_date: cleanDate(payload.expected_start_date),
      certification_status: cleanString(payload.certification_status),
      vacation_from: cleanDate(payload.vacation_from),
      vacation_until: cleanDate(payload.vacation_until),
      notes: cleanString(payload.notes),
      cert1_status: cleanString(payload.cert1_status),
      cert1_date: cleanDate(payload.cert1_date),
      cert2_status: cleanString(payload.cert2_status),
      cert2_date: cleanDate(payload.cert2_date),
      cert3_status: cleanString(payload.cert3_status),
      cert3_date: cleanDate(payload.cert3_date),
      move_to_pod_id: cleanString(payload.move_to_pod_id),
      move_date: cleanDate(payload.move_date),
    });
    return { person };
  }

  if (action === "createAssignment") {
    const podId = cleanString(payload.pod_id);
    if (!podId) throw new Error("pod_id is required");
    const role = cleanString(payload.role) || "FDE";
    const status = payload.is_open_slot ? "Open" : cleanString(payload.status) || "Active";
    const personId = status === "Open" || payload.is_open_slot ? null : cleanString(payload.person_id);
    if (status !== "Open" && !personId) throw new Error("person_id is required unless creating an open slot");
    if (personId) {
      await requireEmail(context, personId, "createAssignment requires email on the target person");
    }
    const id = newId();
    const assignment = await context.tables.insert(TABLES.assignments, {
      id,
      pod_id: podId,
      person_id: personId,
      role,
      status,
      is_primary: Boolean(payload.is_primary),
      notes: cleanString(payload.notes),
      allocation_pct: cleanAllocationPct(payload.allocation_pct),
      last_updated: todayDate(),
    });
    await emitEvents(
      context,
      computeEventsForCreate(
        { pod_id: podId, person_id: personId, role, status },
        { assignment_id: id, occurred_at: new Date().toISOString(), source: "createAssignment" },
      ),
    );
    return { assignment };
  }

  if (action === "updateAssignment") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const allAssignments = await queryAll(context, TABLES.assignments);
    const oldRow = allAssignments.find((row: { id: string }) => row.id === rowId);
    const oldData = (oldRow && oldRow.data) || {};
    const merged: Record<string, unknown> = { ...oldData };
    if ("pod_id" in payload) merged.pod_id = cleanString(payload.pod_id);
    if ("role" in payload) merged.role = cleanString(payload.role) || "FDE";
    if ("status" in payload) merged.status = cleanString(payload.status) || "Active";
    if ("person_id" in payload) merged.person_id = cleanString(payload.person_id);
    if ("is_primary" in payload) merged.is_primary = Boolean(payload.is_primary);
    if ("notes" in payload) merged.notes = cleanString(payload.notes);
    if ("allocation_pct" in payload) merged.allocation_pct = cleanAllocationPct(payload.allocation_pct);
    if (merged.status === "Open") merged.person_id = null;
    if (merged.person_id) {
      await requireEmail(context, merged.person_id, "updateAssignment requires email on the target person");
    }
    const update = {
      pod_id: merged.pod_id,
      person_id: merged.person_id,
      role: merged.role,
      status: merged.status,
      is_primary: merged.is_primary ?? false,
      notes: merged.notes ?? null,
      allocation_pct: merged.allocation_pct ?? null,
      last_updated: todayDate(),
    };
    const assignment = await context.tables.update(TABLES.assignments, rowId, update);
    await emitEvents(
      context,
      computeEventsForUpdate(
        {
          pod_id: oldData.pod_id,
          person_id: oldData.person_id,
          role: oldData.role,
          status: oldData.status,
        },
        {
          pod_id: update.pod_id,
          person_id: update.person_id,
          role: update.role,
          status: update.status,
        },
        { assignment_id: rowId, occurred_at: new Date().toISOString(), source: "updateAssignment" },
      ),
    );
    return { assignment };
  }

  if (action === "deleteAssignment") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const allAssignments = await queryAll(context, TABLES.assignments);
    const oldRow = allAssignments.find((row: { id: string }) => row.id === rowId);
    const oldData = (oldRow && oldRow.data) || {};
    await context.tables.deleteRow(TABLES.assignments, rowId);
    await emitEvents(
      context,
      computeEventsForDelete(
        {
          pod_id: oldData.pod_id,
          person_id: oldData.person_id,
          role: oldData.role,
          status: oldData.status,
        },
        { assignment_id: rowId, occurred_at: new Date().toISOString(), source: "deleteAssignment" },
      ),
    );
    return { deleted: true, row_id: rowId };
  }

  if (action === "updatePod") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const update = {};
    if (payload.pod_name !== undefined) {
      const name = cleanString(payload.pod_name);
      if (!name) throw new Error("pod_name cannot be empty");
      update.pod_name = name;
    }
    if (payload.tier !== undefined) {
      const tier = cleanString(payload.tier);
      if (!tier) throw new Error("tier cannot be empty");
      update.tier = tier;
    }
    if (Object.keys(update).length === 0) throw new Error("nothing to update");
    const pod = await context.tables.update(TABLES.pods, rowId, update);
    return { pod };
  }

  if (action === "deletePerson") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const allAssignments = await queryAll(context, TABLES.assignments);
    const personAssignments = allAssignments.filter(
      (row: { data: { person_id: string | null } }) => row.data && row.data.person_id === rowId,
    );
    const deletedAssignmentIds: string[] = [];
    for (const row of personAssignments) {
      const oldData = row.data || {};
      await context.tables.deleteRow(TABLES.assignments, row.id);
      deletedAssignmentIds.push(row.id);
      await emitEvents(
        context,
        computeEventsForDelete(
          {
            pod_id: oldData.pod_id,
            person_id: oldData.person_id,
            role: oldData.role,
            status: oldData.status,
          },
          { assignment_id: row.id, occurred_at: new Date().toISOString(), source: "deletePerson" },
        ),
      );
    }
    await context.tables.deleteRow(TABLES.people, rowId);
    return { deleted_person_id: rowId, deleted_assignment_ids: deletedAssignmentIds };
  }

  if (action === "updatePerson") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const update = { ...payload };
    delete update.row_id;
    delete update.id;
    for (const key of Object.keys(update)) {
      if (key.endsWith("_date") || key === "expected_start_date" || key === "vacation_until" || key === "vacation_from") {
        update[key] = cleanDate(update[key]);
      } else if (typeof update[key] === "string") {
        update[key] = cleanString(update[key]);
      }
    }
    if (patchHasCertValue(update)) {
      if ("email" in update) {
        if (!update.email || !String(update.email).trim()) {
          throw emailRequiredError("updatePerson with cert fields requires email");
        }
      } else {
        await requireEmail(context, rowId, "updatePerson with cert fields requires email");
      }
    }
    const person = await context.tables.update(TABLES.people, rowId, update);
    return { person };
  }

  if (action === "updatePipelineField") {
    const rowId = cleanString(payload.row_id);
    const field = cleanString(payload.field);
    if (!rowId || !field) throw new Error("row_id and field are required");
    const allowed = new Set([
      "first_name", "last_name", "email", "role", "status", "expected_start_date",
      "certification_status", "vacation_from", "vacation_until", "notes",
      "cert1_status", "cert1_date", "cert2_status", "cert2_date", "cert3_status", "cert3_date",
      "move_to_pod_id", "move_date",
    ]);
    if (!allowed.has(field)) throw new Error(`field is not editable: ${field}`);
    const value = field.endsWith("_date") || field === "expected_start_date" || field === "vacation_until"
      ? cleanDate(payload.value)
      : cleanString(payload.value);
    if (CERT_FIELDS.has(field) && value) {
      await requireEmail(context, rowId, "updatePipelineField on cert field requires email");
    }
    const person = await context.tables.update(TABLES.people, rowId, { [field]: value });
    return { person };
  }

  if (action === "planTransition") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const targetPodId = cleanString(payload.target_pod_id);
    if (!targetPodId) throw new Error("target_pod_id is required");
    const moveDate = cleanDate(payload.move_date);
    if (!moveDate) throw new Error("move_date is required");
    const person = await context.tables.update(TABLES.people, rowId, {
      move_to_pod_id: targetPodId,
      move_date: moveDate,
    });
    let openSlot = null;
    if (payload.create_open_slot) {
      const sourcePodId = cleanString(payload.source_pod_id);
      const sourceRole = cleanString(payload.source_role) || "FDE";
      if (sourcePodId) {
        const id = newId();
        const firstName = (person.data && person.data.first_name) || rowId;
        openSlot = await context.tables.insert(TABLES.assignments, {
          id,
          pod_id: sourcePodId,
          person_id: null,
          role: sourceRole,
          status: "Open",
          is_primary: false,
          notes: cleanString(payload.open_slot_notes) || `Backfill for departing ${firstName} on ${moveDate}`,
          last_updated: todayDate(),
        });
      }
    }
    return { person, open_slot: openSlot };
  }

  if (action === "offboardPerson") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const actions = Array.isArray(payload.assignment_actions) ? payload.assignment_actions : [];
    const results = [];
    const allAssignmentsForOffboard = await queryAll(context, TABLES.assignments);
    for (const item of actions) {
      const assignmentRowId = cleanString(item.row_id);
      const choice = cleanString(item.choice) || "leaving";
      if (!assignmentRowId) continue;
      const oldRow = allAssignmentsForOffboard.find((row: { id: string }) => row.id === assignmentRowId);
      const oldData = (oldRow && oldRow.data) || {};
      if (choice === "delete") {
        await context.tables.deleteRow(TABLES.assignments, assignmentRowId);
        await emitEvents(
          context,
          computeEventsForDelete(
            {
              pod_id: oldData.pod_id,
              person_id: oldData.person_id,
              role: oldData.role,
              status: oldData.status,
            },
            { assignment_id: assignmentRowId, occurred_at: new Date().toISOString(), source: "offboardPerson" },
          ),
        );
        results.push({ row_id: assignmentRowId, choice });
      } else if (choice === "leaving_and_open_slot") {
        const closed = await context.tables.update(TABLES.assignments, assignmentRowId, {
          status: "Leaving",
          last_updated: todayDate(),
        });
        const openId = newId();
        const closedData = (closed && closed.data) || {};
        const openSlot = await context.tables.insert(TABLES.assignments, {
          id: openId,
          pod_id: closedData.pod_id,
          person_id: null,
          role: closedData.role,
          status: "Open",
          is_primary: false,
          notes: "Backfill for offboarding",
          last_updated: todayDate(),
        });
        await emitEvents(
          context,
          computeEventsForDelete(
            {
              pod_id: oldData.pod_id,
              person_id: oldData.person_id,
              role: oldData.role,
              status: oldData.status,
            },
            { assignment_id: assignmentRowId, occurred_at: new Date().toISOString(), source: "offboardPerson" },
          ),
        );
        results.push({ row_id: assignmentRowId, choice, open_slot: openSlot });
      } else {
        const closed = await context.tables.update(TABLES.assignments, assignmentRowId, {
          status: "Leaving",
          last_updated: todayDate(),
        });
        await emitEvents(
          context,
          computeEventsForDelete(
            {
              pod_id: oldData.pod_id,
              person_id: oldData.person_id,
              role: oldData.role,
              status: oldData.status,
            },
            { assignment_id: assignmentRowId, occurred_at: new Date().toISOString(), source: "offboardPerson" },
          ),
        );
        results.push({ row_id: assignmentRowId, choice: "leaving", assignment: closed });
      }
    }
    const person = await context.tables.update(TABLES.people, rowId, { status: "Inactive" });
    return { person, assignment_results: results };
  }

  if (action === "reactivatePerson") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const person = await context.tables.update(TABLES.people, rowId, { status: "Active" });
    return { person };
  }

  if (action === "updateWeekly") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const ALLOWED_STATIC = new Set([
      "deployment_strategist_goal",
      "fde_missing_count",
      "total_fde_needed",
      "notes",
      "account_id",
    ]);
    const update = {};
    for (const key of Object.keys(payload)) {
      if (key === "row_id" || key === "id") continue;
      const isWeekCol = key.startsWith("ds_week_") || key.startsWith("fde_week_");
      if (!ALLOWED_STATIC.has(key) && !isWeekCol) continue;
      const raw = payload[key];
      if (key === "fde_missing_count" || key === "total_fde_needed") {
        if (raw === "" || raw === null || raw === undefined) {
          update[key] = null;
        } else {
          const num = Number(raw);
          update[key] = Number.isFinite(num) ? num : null;
        }
      } else if (typeof raw === "string") {
        update[key] = cleanString(raw);
      } else {
        update[key] = raw;
      }
    }
    update.last_updated = todayDate();
    const weekly = await context.tables.update(TABLES.weekly, rowId, update);
    return { weekly };
  }

  if (action === "createGoLive") {
    const customerName = cleanString(payload.customer_name);
    const agentName = cleanString(payload.agent_name);
    const goLiveDate = cleanDate(payload.go_live_date);
    if (!customerName) throw new Error("customer_name is required");
    if (!agentName) throw new Error("agent_name is required");
    if (!goLiveDate) throw new Error("go_live_date is required");
    const id = newId();
    const goLive = await context.tables.insert(TABLES.goLives, {
      id,
      pod_id: cleanString(payload.pod_id),
      customer_name: customerName,
      agent_name: agentName,
      go_live_date: goLiveDate,
      use_case: cleanString(payload.use_case),
      status: cleanString(payload.status) || "Planned",
      notes: cleanString(payload.notes),
      channel: cleanString(payload.channel),
      volume_unit: cleanString(payload.volume_unit),
      target_monthly_volume: cleanNumber(payload.target_monthly_volume),
      full_potential_volume: cleanNumber(payload.full_potential_volume),
      june_projection: cleanNumber(payload.june_projection),
      rollout_type: cleanString(payload.rollout_type),
      last_updated: todayDate(),
    });
    return { go_live: goLive };
  }

  if (action === "updateGoLive") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const update = {};
    for (const key of Object.keys(payload)) {
      if (key === "row_id" || key === "id") continue;
      if (!GO_LIVE_FIELDS.has(key)) continue;
      const raw = payload[key];
      if (key === "go_live_date") update[key] = cleanDate(raw);
      else if (GO_LIVE_NUMERIC_FIELDS.has(key)) update[key] = cleanNumber(raw);
      else if (typeof raw === "string") update[key] = cleanString(raw);
      else update[key] = raw;
    }
    update.last_updated = todayDate();
    const goLive = await context.tables.update(TABLES.goLives, rowId, update);
    return { go_live: goLive };
  }

  if (action === "deleteGoLive") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    await context.tables.deleteRow(TABLES.goLives, rowId);
    return { deleted: true, row_id: rowId, kind: "go_live" };
  }

  if (action === "migratePeopleToUuid") {
    const people = await queryAll(context, TABLES.people);
    const assignments = await queryAll(context, TABLES.assignments);
    const mapping = {};

    // Step 1: insert a fresh row with a new UUID for every existing person.
    for (const p of people) {
      // Skip rows whose id is already a UUID.
      if (typeof p.id === "string" && p.id.length === 36 && p.id.indexOf("-") === 8) continue;
      const fresh = newId();
      mapping[p.id] = fresh;
      const data = (p && p.data) || {};
      await context.tables.insert(TABLES.people, { ...data, id: fresh });
    }

    // Step 2: rewrite every assignment that references an old person id.
    let updatedAssignments = 0;
    for (const a of assignments) {
      const pid = a.data && a.data.person_id;
      if (pid && mapping[pid]) {
        await context.tables.update(TABLES.assignments, a.id, { person_id: mapping[pid] });
        updatedAssignments += 1;
      }
    }

    // Step 3: rewrite every person.move_to_pod_id? No — that points at pods. Skip.

    // Step 4: delete the old (legacy-id) people rows.
    let deleted = 0;
    for (const oldId of Object.keys(mapping)) {
      await context.tables.deleteRow(TABLES.people, oldId);
      deleted += 1;
    }

    return { migrated: deleted, assignments_updated: updatedAssignments, mapping };
  }

  if (action === "bulkImportGoLives") {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const inserted = [];
    for (const item of items) {
      const customerName = cleanString(item.customer_name);
      const agentName = cleanString(item.agent_name);
      const goLiveDate = cleanDate(item.go_live_date);
      if (!customerName || !agentName || !goLiveDate) continue;
      const id = newId();
      const row = await context.tables.insert(TABLES.goLives, {
        id,
        pod_id: cleanString(item.pod_id),
        customer_name: customerName,
        agent_name: agentName,
        go_live_date: goLiveDate,
        use_case: cleanString(item.use_case),
        status: cleanString(item.status) || "Planned",
        notes: cleanString(item.notes),
        channel: cleanString(item.channel),
        volume_unit: cleanString(item.volume_unit),
        target_monthly_volume: cleanNumber(item.target_monthly_volume),
        full_potential_volume: cleanNumber(item.full_potential_volume),
        june_projection: cleanNumber(item.june_projection),
        rollout_type: cleanString(item.rollout_type),
        last_updated: todayDate(),
      });
      inserted.push(row);
    }
    return { inserted_count: inserted.length, inserted };
  }

  if (action === "bootstrapHistory") {
    const existing = await queryAll(context, TABLES.assignmentEvents);
    if (existing.length > 0) {
      return { status: "skipped", existing_events: existing.length };
    }
    const allAssignments = await queryAll(context, TABLES.assignments);
    let written = 0;
    for (const row of allAssignments) {
      const data = (row && row.data) || {};
      if (!data.person_id) continue;
      const occurredAt = data.last_updated || todayDate();
      const events = computeEventsForCreate(
        { pod_id: data.pod_id, person_id: data.person_id, role: data.role, status: data.status },
        { assignment_id: row.id, occurred_at: occurredAt, source: "backfill" },
      );
      await emitEvents(context, events);
      written += events.length;
    }
    return { status: "ok", events_written: written };
  }

  // ----- pod_agents (deployed-agent registry per pod) -----

  if (action === "listAgents") {
    const agents = await queryAll(context, TABLES.podAgents);
    return { agents };
  }

  if (action === "createAgent") {
    const podId = cleanString(payload.pod_id);
    const useCase = cleanString(payload.agent_use_case);
    if (!podId) throw new Error("pod_id is required");
    if (!useCase) throw new Error("agent_use_case is required");
    const id = newId();
    const row: Record<string, unknown> = {
      id,
      pod_id: podId,
      agent_use_case: useCase,
      live_pct: cleanString(payload.live_pct),
      april_consumption: cleanString(payload.april_consumption),
      may_projection: cleanString(payload.may_projection),
      june_projection: cleanString(payload.june_projection),
      full_potential: cleanString(payload.full_potential),
      notes: cleanString(payload.notes),
    };
    const agent = await context.tables.insert(TABLES.podAgents, row);
    return { agent };
  }

  if (action === "updateAgent") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    const update: Record<string, unknown> = {};
    for (const key of Object.keys(payload)) {
      if (key === "row_id" || key === "id") continue;
      if (!POD_AGENT_FIELDS.has(key)) continue;
      const raw = payload[key];
      update[key] = typeof raw === "string" ? cleanString(raw) : raw;
    }
    if (Object.keys(update).length === 0) {
      throw new Error("no updatable fields");
    }
    const agent = await context.tables.update(TABLES.podAgents, rowId, update);
    return { agent };
  }

  if (action === "deleteAgent") {
    const rowId = cleanString(payload.row_id);
    if (!rowId) throw new Error("row_id is required");
    await context.tables.deleteRow(TABLES.podAgents, rowId);
    return { deleted: true, row_id: rowId, kind: "pod_agent" };
  }

  // ----- customer deep dives (read-only; tracker app owns writes) -----

  if (action === "listDeepDives") {
    const [progressRows, pods] = await Promise.all([
      queryAll(context, TABLES.documentationProgress),
      queryAll(context, TABLES.pods),
    ]);
    const byPod = new Map();
    for (const r of progressRows) {
      const key = (r && r.id) != null ? String(r.id) : null;
      if (key) byPod.set(key, (r && r.data) || {});
    }
    const statusFilter = cleanString(payload.status);
    const tierFilter = cleanString(payload.tier);
    const podIdFilter = cleanString(payload.pod_id);
    const followOnly = Boolean(payload.follow_up_only);

    const deep_dives = [];
    for (const p of pods) {
      const d = (p && p.data) || {};
      const podId = String(p.id ?? "");
      if (!podId) continue;
      if (podIdFilter && podId !== podIdFilter) continue;
      const tier = cleanString(d.tier) || "Unspecified";
      if (tierFilter && tier !== tierFilter) continue;
      const t = byPod.get(podId) || {};
      const status = cleanString(t.documentation_status) || "Not Started";
      if (statusFilter && status !== statusFilter) continue;
      const followNeeded = Boolean(t.follow_up_needed);
      if (followOnly && !followNeeded) continue;
      deep_dives.push({
        pod_id: podId,
        customer: cleanString(d.pod_name),
        tier,
        documentation_status: status,
        session_completed: Boolean(t.session_completed),
        last_session_date: cleanDate(t.last_session_date),
        scheduled_session_date: cleanDate(t.scheduled_session_date),
        scheduled_session_datetime: cleanDate(t.scheduled_session_datetime),
        agent: cleanString(t.agent),
        follow_up_needed: followNeeded,
        follow_up_notes: cleanString(t.follow_up_notes),
        notes: cleanString(t.notes),
        notion_link: cleanString(t.notion_link),
        last_updated: cleanDate(t.last_updated),
      });
    }
    return { deep_dives };
  }

  // ----- agent latency (read-only; il-agent-configs-sync owns il_agent_latency) -----

  if (action === "listAgentLatency") {
    const rows = await queryAll(context, TABLES.agentLatency);
    const agentFilter = cleanString(payload.agent);
    const agentNeedle = agentFilter ? agentFilter.toLowerCase() : null;
    const tenantFilter = cleanString(payload.tenant);
    const tenantNeedle = tenantFilter ? tenantFilter.toLowerCase() : null;
    const minMs = payload.min_ms != null ? Number(payload.min_ms) : null;
    const limit = payload.limit != null ? Number(payload.limit) : null;

    let out = [];
    for (const r of rows) {
      const d = (r && r.data) || {};
      const agentName = cleanString(d.agent_name);
      const tenantName = cleanString(d.tenant_name);
      const latency = d.latency_ms != null ? Number(d.latency_ms) : null;
      if (agentNeedle && !(agentName || "").toLowerCase().includes(agentNeedle)) continue;
      if (tenantNeedle && (tenantName || "").toLowerCase() !== tenantNeedle) continue;
      if (minMs != null && Number.isFinite(minMs) && !(latency != null && latency >= minMs)) continue;
      out.push({
        agent_name: agentName,
        tenant_name: tenantName,
        latency_ms: latency,
        last_report_date: cleanDate(d.last_report_date),
      });
    }
    // Slowest first; nulls last.
    out.sort((a, b) => (b.latency_ms ?? -1) - (a.latency_ms ?? -1));
    if (limit != null && Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
    return { latencies: out };
  }

  // ----- agent config (read-only; il-agent-configs-sync owns il_agent_snapshot) -----

  if (action === "listAgentConfigs") {
    const [rows, metricsRows] = await Promise.all([
      queryAll(context, TABLES.agentSnapshot),
      queryAll(context, TABLES.agentMetrics),
    ]);
    const metricsById = new Map();
    for (const m of metricsRows) {
      const md = (m && m.data) || {};
      const key = md.agent_id != null ? String(md.agent_id) : (m && m.id != null ? String(m.id) : null);
      if (key) metricsById.set(key, md);
    }
    const agentNeedle = (cleanString(payload.agent) || "").toLowerCase();
    const tenantNeedle = (cleanString(payload.tenant) || "").toLowerCase();
    const activeOnly = Boolean(payload.active_only);
    const out = [];
    for (const r of rows) {
      const d = (r && r.data) || {};
      const agentName = cleanString(d.agent_name);
      const tenant = cleanString(d.tenant_display_name);
      if (agentNeedle && !(agentName || "").toLowerCase().includes(agentNeedle)) continue;
      if (tenantNeedle && (tenant || "").toLowerCase() !== tenantNeedle) continue;
      let cfg = {};
      try { cfg = JSON.parse(d.config_json || "{}"); } catch (_e) { cfg = {}; }
      const m = metricsById.get(String(d.agent_id)) || {};
      const weekAvg = m.conversations_week_avg != null ? Number(m.conversations_week_avg) : null;
      const conv24h = m.conversations_24h != null ? Number(m.conversations_24h) : null;
      // Prefer the exact 7-day total stored by the sync (il_agent_metrics.
      // activities_last_week); fall back to week_avg * 7 (week_avg is a daily
      // average). "Active" = >500 activities in prod in the last week.
      const activitiesLastWeek = m.activities_last_week != null
        ? Number(m.activities_last_week)
        : (weekAvg != null ? Math.round(weekAvg * 7) : null);
      const activeLastWeek = activitiesLastWeek != null && activitiesLastWeek > 500;
      if (activeOnly && !activeLastWeek) continue;
      out.push({
        agent_name: agentName,
        agent_display_name: cleanString(d.agent_display_name),
        tenant_name: tenant,
        mode: cleanString(d.mode),
        locale: cleanString(d.locale),
        llm_model: cfg.LLM_MODEL ?? null,
        llm_provider: cfg.LLM_SELECTED_PROVIDER ?? null,
        transcriber_provider: cfg.TRANSCRIBER_PRIMARY_PROVIDER ?? null,
        voice_provider: cfg.VOICE_SELECTED_PROVIDER ?? cfg.VOICE_PRIMARY_ENDPOINT_PROVIDER ?? null,
        conversations_24h: conv24h,
        conversations_week_avg: weekAvg,
        activities_last_week: activitiesLastWeek,
        open_issues: m.open_issues != null ? Number(m.open_issues) : null,
        last_call_at: cleanString(m.last_call_at),
        active_last_week: activeLastWeek,
      });
    }
    out.sort((a, b) => (a.tenant_name || "").localeCompare(b.tenant_name || ""));
    return { configs: out };
  }

  if (action === "findAgentConfigField") {
    const fieldRaw = cleanString(payload.field);
    if (!fieldRaw) throw new Error("field is required");
    const norm = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const needle = norm(fieldRaw);
    const onlyTruthy = Boolean(payload.only_truthy);
    const agentNeedle = (cleanString(payload.agent) || "").toLowerCase();
    const tenantNeedle = (cleanString(payload.tenant) || "").toLowerCase();
    const isTruthy = (v) => {
      if (v === true) return true;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const t = v.trim().toLowerCase();
        return t !== "" && !["false", "no", "off", "0", "none", "null"].includes(t);
      }
      if (v && typeof v === "object") return Object.keys(v).length > 0;
      return false;
    };
    const trunc = (v) => {
      const str = typeof v === "string" ? v : JSON.stringify(v);
      return str.length > 150 ? `${str.slice(0, 150)}…` : str;
    };
    const rows = await queryAll(context, TABLES.agentSnapshot);
    const out = [];
    for (const r of rows) {
      const d = (r && r.data) || {};
      const agentName = cleanString(d.agent_name);
      const tenant = cleanString(d.tenant_display_name);
      if (agentNeedle && !(agentName || "").toLowerCase().includes(agentNeedle)) continue;
      if (tenantNeedle && (tenant || "").toLowerCase() !== tenantNeedle) continue;
      let cfg = {};
      try { cfg = JSON.parse(d.config_json || "{}"); } catch (_e) { cfg = {}; }
      const matched = [];
      for (const k of Object.keys(cfg)) {
        if (!norm(k).includes(needle)) continue;
        const val = cfg[k];
        if (onlyTruthy && !isTruthy(val)) continue;
        matched.push({ key: k, value: typeof val === "string" ? trunc(val) : val });
        if (matched.length >= 15) break;
      }
      if (matched.length === 0) continue;
      out.push({ agent_name: agentName, tenant_name: tenant, matched });
    }
    out.sort((a, b) => (a.tenant_name || "").localeCompare(b.tenant_name || ""));
    return { field: fieldRaw, agents: out };
  }

  // ----- generic read-only table access -----

  if (action === "listTables") {
    return { tables: READABLE_TABLES };
  }

  if (action === "readTable") {
    const table = cleanString(payload.table);
    if (!table || !READABLE_TABLES.includes(table)) {
      return { ok: false, reason: "unknown_table", available: READABLE_TABLES };
    }
    const text = cleanString(payload.text);
    const needle = text ? text.toLowerCase() : null;
    const reqLimit = payload.limit != null ? Number(payload.limit) : 25;
    const limit = Math.min(Math.max(Number.isFinite(reqLimit) ? reqLimit : 25, 1), 100);
    const rows = await queryAll(context, table);
    const truncVal = (v) => (typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v);
    const out = [];
    let matchedTotal = 0;
    for (const r of rows) {
      const data = (r && r.data) || {};
      if (needle && !JSON.stringify(data).toLowerCase().includes(needle)) continue;
      matchedTotal += 1;
      if (out.length >= limit) continue;
      const lean = { id: r && r.id };
      for (const k of Object.keys(data)) lean[k] = truncVal(data[k]);
      out.push(lean);
    }
    return { table, returned: out.length, matched_total: matchedTotal, table_total: rows.length, rows: out };
  }

  throw new Error(`Unsupported action: ${action}`);
}
