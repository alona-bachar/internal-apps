import { describe, expect, it } from "vitest";
import {
  cleanAllocationPct,
  computeEventsForCreate,
  computeEventsForDelete,
  computeEventsForUpdate,
  userFunction,
} from "./pod-staffing-data";

const OCCURRED_AT = "2026-05-19T10:00:00.000Z";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    data: {
      pod_id: "pod-A",
      person_id: "person-1",
      role: "DS",
      status: "Active",
      ...overrides,
    },
  };
}

describe("computeEventsForUpdate", () => {
  it("returns [] when nothing tenure-relevant or status changes", () => {
    const events = computeEventsForUpdate(
      baseRow().data,
      { pod_id: "pod-A", person_id: "person-1", role: "DS", status: "Active" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toEqual([]);
  });

  it("emits one status_changed when only status differs", () => {
    const events = computeEventsForUpdate(
      baseRow({ status: "Onboarding" }).data,
      { pod_id: "pod-A", person_id: "person-1", role: "DS", status: "Active" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toEqual([
      {
        event_type: "status_changed",
        pod_id: "pod-A",
        person_id: "person-1",
        role: "DS",
        from_status: "Onboarding",
        to_status: "Active",
        assignment_id: "assignment-1",
        occurred_at: OCCURRED_AT,
        source: "updateAssignment",
      },
    ]);
  });

  it("emits unassigned + assigned in that order on person change", () => {
    const events = computeEventsForUpdate(
      baseRow({ person_id: "person-1", status: "Active" }).data,
      { pod_id: "pod-A", person_id: "person-2", role: "DS", status: "Onboarding" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event_type: "unassigned", person_id: "person-1", to_status: null });
    expect(events[1]).toMatchObject({ event_type: "assigned", person_id: "person-2", to_status: "Onboarding" });
  });

  it("emits unassigned + assigned on pod change with new pod_id in assigned", () => {
    const events = computeEventsForUpdate(
      baseRow().data,
      { pod_id: "pod-B", person_id: "person-1", role: "DS", status: "Active" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event_type: "unassigned", pod_id: "pod-A" });
    expect(events[1]).toMatchObject({ event_type: "assigned", pod_id: "pod-B" });
  });

  it("emits unassigned + assigned on role change", () => {
    const events = computeEventsForUpdate(
      baseRow({ role: "DS" }).data,
      { pod_id: "pod-A", person_id: "person-1", role: "FDE", status: "Active" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event_type: "unassigned", role: "DS" });
    expect(events[1]).toMatchObject({ event_type: "assigned", role: "FDE" });
  });

  it("does not emit a separate status_changed when tenure also changes", () => {
    const events = computeEventsForUpdate(
      baseRow({ person_id: "person-1", status: "Active" }).data,
      { pod_id: "pod-A", person_id: "person-2", role: "DS", status: "Onboarding" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events.filter((e: { event_type: string }) => e.event_type === "status_changed")).toHaveLength(0);
  });

  it("skips unassigned when old row was open (no person_id)", () => {
    const events = computeEventsForUpdate(
      baseRow({ person_id: null, status: "Open" }).data,
      { pod_id: "pod-A", person_id: "person-1", role: "DS", status: "Onboarding" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: "assigned", person_id: "person-1" });
  });

  it("skips assigned when new value is open (person_id null)", () => {
    const events = computeEventsForUpdate(
      baseRow({ person_id: "person-1", status: "Active" }).data,
      { pod_id: "pod-A", person_id: null, role: "DS", status: "Open" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "updateAssignment" },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: "unassigned", person_id: "person-1" });
  });
});

describe("computeEventsForCreate", () => {
  it("emits one assigned event on a filled new assignment", () => {
    const events = computeEventsForCreate(
      { pod_id: "pod-A", person_id: "person-1", role: "DS", status: "Onboarding" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "createAssignment" },
    );
    expect(events).toEqual([
      {
        event_type: "assigned",
        pod_id: "pod-A",
        person_id: "person-1",
        role: "DS",
        from_status: null,
        to_status: "Onboarding",
        assignment_id: "assignment-1",
        occurred_at: OCCURRED_AT,
        source: "createAssignment",
      },
    ]);
  });

  it("emits nothing for an open-slot create (no person_id)", () => {
    const events = computeEventsForCreate(
      { pod_id: "pod-A", person_id: null, role: "DS", status: "Open" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "createAssignment" },
    );
    expect(events).toEqual([]);
  });
});

describe("computeEventsForDelete", () => {
  it("emits one unassigned event when the deleted row was filled", () => {
    const events = computeEventsForDelete(
      { pod_id: "pod-A", person_id: "person-1", role: "DS", status: "Active" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "deleteAssignment" },
    );
    expect(events).toEqual([
      {
        event_type: "unassigned",
        pod_id: "pod-A",
        person_id: "person-1",
        role: "DS",
        from_status: "Active",
        to_status: null,
        assignment_id: "assignment-1",
        occurred_at: OCCURRED_AT,
        source: "deleteAssignment",
      },
    ]);
  });

  it("emits nothing for an open-slot delete (no person_id)", () => {
    const events = computeEventsForDelete(
      { pod_id: "pod-A", person_id: null, role: "DS", status: "Open" },
      { assignment_id: "assignment-1", occurred_at: OCCURRED_AT, source: "deleteAssignment" },
    );
    expect(events).toEqual([]);
  });
});

describe("cleanAllocationPct", () => {
  it("returns null for null/undefined/empty", () => {
    expect(cleanAllocationPct(null)).toBeNull();
    expect(cleanAllocationPct(undefined)).toBeNull();
    expect(cleanAllocationPct("")).toBeNull();
  });
  it("returns null for non-finite values", () => {
    expect(cleanAllocationPct("not a number")).toBeNull();
    expect(cleanAllocationPct(NaN)).toBeNull();
    expect(cleanAllocationPct(Infinity)).toBeNull();
  });
  it("clamps below zero to 0", () => {
    expect(cleanAllocationPct(-25)).toBe(0);
  });
  it("clamps above 100 to 100", () => {
    expect(cleanAllocationPct(150)).toBe(100);
  });
  it("rounds floats to integers", () => {
    expect(cleanAllocationPct(33.4)).toBe(33);
    expect(cleanAllocationPct(33.6)).toBe(34);
  });
  it("accepts numeric strings", () => {
    expect(cleanAllocationPct("50")).toBe(50);
  });
});

// ----- listDeepDives -----

function makeDeepDiveCtx(pods: unknown[], progressRows: unknown[]) {
  return {
    data: { action: "listDeepDives", payload: {} },
    tables: {
      query: async (tableName: string) => {
        if (tableName === "pods") return { rows: pods, total: pods.length };
        if (tableName === "pod_documentation_progress") return { rows: progressRows, total: progressRows.length };
        return { rows: [], total: 0 };
      },
    },
    secrets: { get: () => undefined },
  };
}

const PODS = [
  { id: "pod-1", data: { pod_name: "Cellcom", tier: "Tier 1" } },
  { id: "pod-2", data: { pod_name: "Maccabi", tier: "Tier 2" } },
  { id: "pod-3", data: { pod_name: "Hapoalim", tier: "Tier 1" } },
];

const PROGRESS = [
  {
    id: "pod-1",
    data: {
      documentation_status: "Completed",
      session_completed: true,
      last_session_date: "2026-05-01",
      scheduled_session_date: null,
      scheduled_session_datetime: null,
      agent: "Alona",
      notes: "All done",
      follow_up_needed: false,
      follow_up_notes: null,
      notion_link: "https://notion.so/123",
      last_updated: "2026-05-01",
    },
  },
  {
    id: "pod-2",
    data: {
      documentation_status: "Needs Follow-up",
      session_completed: true,
      last_session_date: "2026-05-10",
      scheduled_session_date: null,
      scheduled_session_datetime: null,
      agent: "Yotam",
      notes: null,
      follow_up_needed: true,
      follow_up_notes: "Schedule call",
      notion_link: null,
      last_updated: "2026-05-10",
    },
  },
];

describe("listDeepDives", () => {
  it("returns one row per pod, joining pod_name + tier", async () => {
    const ctx = makeDeepDiveCtx(PODS, PROGRESS);
    const result: any = await userFunction(ctx);
    expect(result.deep_dives).toHaveLength(3);
    const cellcom = result.deep_dives.find((d: any) => d.customer === "Cellcom");
    expect(cellcom).toBeDefined();
    expect(cellcom.tier).toBe("Tier 1");
    expect(cellcom.documentation_status).toBe("Completed");
  });

  it("pod with NO tracking row defaults documentation_status to Not Started and booleans to false", async () => {
    const ctx = makeDeepDiveCtx(PODS, PROGRESS);
    const result: any = await userFunction(ctx);
    const hapoalim = result.deep_dives.find((d: any) => d.customer === "Hapoalim");
    expect(hapoalim).toBeDefined();
    expect(hapoalim.documentation_status).toBe("Not Started");
    expect(hapoalim.session_completed).toBe(false);
    expect(hapoalim.follow_up_needed).toBe(false);
  });

  it("filters by status", async () => {
    const ctx = { ...makeDeepDiveCtx(PODS, PROGRESS), data: { action: "listDeepDives", payload: { status: "Completed" } } };
    const result: any = await userFunction(ctx);
    expect(result.deep_dives).toHaveLength(1);
    expect(result.deep_dives[0].customer).toBe("Cellcom");
  });

  it("filters by tier", async () => {
    const ctx = { ...makeDeepDiveCtx(PODS, PROGRESS), data: { action: "listDeepDives", payload: { tier: "Tier 2" } } };
    const result: any = await userFunction(ctx);
    expect(result.deep_dives).toHaveLength(1);
    expect(result.deep_dives[0].customer).toBe("Maccabi");
  });

  it("follow_up_only returns only rows with follow_up_needed", async () => {
    const ctx = { ...makeDeepDiveCtx(PODS, PROGRESS), data: { action: "listDeepDives", payload: { follow_up_only: true } } };
    const result: any = await userFunction(ctx);
    expect(result.deep_dives).toHaveLength(1);
    expect(result.deep_dives[0].customer).toBe("Maccabi");
    expect(result.deep_dives[0].follow_up_needed).toBe(true);
  });

  it("pod_id returns the single pod", async () => {
    const ctx = { ...makeDeepDiveCtx(PODS, PROGRESS), data: { action: "listDeepDives", payload: { pod_id: "pod-2" } } };
    const result: any = await userFunction(ctx);
    expect(result.deep_dives).toHaveLength(1);
    expect(result.deep_dives[0].pod_id).toBe("pod-2");
    expect(result.deep_dives[0].customer).toBe("Maccabi");
  });
});

// ----- listAgentLatency -----

function makeLatencyCtx(rows: unknown[], payload: Record<string, unknown> = {}) {
  return {
    data: { action: "listAgentLatency", payload },
    tables: {
      query: async (tableName: string) => {
        if (tableName === "il_agent_latency") return { rows, total: rows.length };
        return { rows: [], total: 0 };
      },
    },
    secrets: { get: () => undefined },
  };
}

const LAT = [
  { id: "andrei@meridian", data: { agent_name: "andrei", tenant_name: "meridian", latency_ms: 1751, last_report_date: null } },
  { id: "ron@bezeq", data: { agent_name: "ron", tenant_name: "bezeq", latency_ms: 1909, last_report_date: null } },
  { id: "tamar@strauss", data: { agent_name: "tamar", tenant_name: "strauss", latency_ms: 1608, last_report_date: null } },
];

describe("listAgentLatency", () => {
  it("returns all rows sorted slowest-first", async () => {
    const result: any = await userFunction(makeLatencyCtx(LAT));
    expect(result.latencies.map((x: any) => x.latency_ms)).toEqual([1909, 1751, 1608]);
  });

  it("filters by tenant (exact, case-insensitive)", async () => {
    const result: any = await userFunction(makeLatencyCtx(LAT, { tenant: "BEZEQ" }));
    expect(result.latencies).toHaveLength(1);
    expect(result.latencies[0].agent_name).toBe("ron");
  });

  it("filters by agent (loose) and min_ms, and respects limit", async () => {
    const byAgent: any = await userFunction(makeLatencyCtx(LAT, { agent: "tam" }));
    expect(byAgent.latencies).toHaveLength(1);
    expect(byAgent.latencies[0].tenant_name).toBe("strauss");
    const minMs: any = await userFunction(makeLatencyCtx(LAT, { min_ms: 1700 }));
    expect(minMs.latencies.map((x: any) => x.agent_name)).toEqual(["ron", "andrei"]);
    const limited: any = await userFunction(makeLatencyCtx(LAT, { limit: 1 }));
    expect(limited.latencies).toHaveLength(1);
    expect(limited.latencies[0].agent_name).toBe("ron");
  });
});

// ----- listAgentConfigs -----

function makeConfigCtx(rows: unknown[], payload: Record<string, unknown> = {}, metrics: unknown[] = []) {
  return {
    data: { action: "listAgentConfigs", payload },
    tables: {
      query: async (tableName: string) => {
        if (tableName === "il_agent_snapshot") return { rows, total: rows.length };
        if (tableName === "il_agent_metrics") return { rows: metrics, total: metrics.length };
        return { rows: [], total: 0 };
      },
    },
    secrets: { get: () => undefined },
  };
}

const METRICS = [
  // Prefer the exact activities_last_week over week_avg*7. ron: 712 (>500 => active).
  // tamar: 280 (<=500 => not active).
  { id: "a1", data: { agent_id: "a1", conversations_24h: 90, conversations_week_avg: 100, activities_last_week: 712, open_issues: 3, last_call_at: "1780542334.695" } },
  { id: "a2", data: { agent_id: "a2", conversations_24h: 5, conversations_week_avg: 40, activities_last_week: 280, open_issues: 0, last_call_at: null } },
];

const SNAP = [
  { id: "a1", data: { agent_id: "a1", agent_name: "ron", agent_display_name: "Ron", tenant_display_name: "Bezeq", mode: "active", locale: "he-IL", config_json: JSON.stringify({ LLM_MODEL: "eu-gpt-realtime-1.5", LLM_SELECTED_PROVIDER: "azure", TRANSCRIBER_PRIMARY_PROVIDER: "deepgram", VOICE_SELECTED_PROVIDER: "elevenlabs" }) } },
  { id: "a2", data: { agent_id: "a2", agent_name: "tamar", agent_display_name: "Tamar", tenant_display_name: "Strauss", mode: "active", locale: "he-IL", config_json: JSON.stringify({ LLM_MODEL: "gpt-4o-realtime-preview-2025-06-03" }) } },
];

describe("listAgentConfigs", () => {
  it("returns curated config per agent (parses config_json)", async () => {
    const result: any = await userFunction(makeConfigCtx(SNAP));
    expect(result.configs).toHaveLength(2);
    const ron = result.configs.find((c: any) => c.agent_name === "ron");
    expect(ron).toMatchObject({ tenant_name: "Bezeq", llm_model: "eu-gpt-realtime-1.5", llm_provider: "azure", voice_provider: "elevenlabs" });
  });

  it("filters by agent (loose) and tenant (exact)", async () => {
    const byAgent: any = await userFunction(makeConfigCtx(SNAP, { agent: "ron" }));
    expect(byAgent.configs).toHaveLength(1);
    expect(byAgent.configs[0].llm_model).toBe("eu-gpt-realtime-1.5");
    const byTenant: any = await userFunction(makeConfigCtx(SNAP, { tenant: "strauss" }));
    expect(byTenant.configs).toHaveLength(1);
    expect(byTenant.configs[0].agent_name).toBe("tamar");
  });

  it("handles missing/invalid config_json gracefully (null fields)", async () => {
    const rows = [{ id: "x", data: { agent_name: "z", tenant_display_name: "T", config_json: "not json" } }];
    const result: any = await userFunction(makeConfigCtx(rows));
    expect(result.configs[0]).toMatchObject({ agent_name: "z", llm_model: null });
  });

  it("joins activity metrics and derives activities_last_week + active (>500)", async () => {
    const result: any = await userFunction(makeConfigCtx(SNAP, {}, METRICS));
    const ron = result.configs.find((c: any) => c.agent_name === "ron");
    const tamar = result.configs.find((c: any) => c.agent_name === "tamar");
    expect(ron).toMatchObject({ activities_last_week: 712, conversations_24h: 90, open_issues: 3, active_last_week: true });
    expect(tamar).toMatchObject({ activities_last_week: 280, active_last_week: false });
  });

  it("active_only filters out inactive agents", async () => {
    const result: any = await userFunction(makeConfigCtx(SNAP, { active_only: true }, METRICS));
    expect(result.configs.map((c: any) => c.agent_name)).toEqual(["ron"]);
  });
});

// ----- findAgentConfigField -----

function makeFieldCtx(rows: unknown[], payload: Record<string, unknown>) {
  return {
    data: { action: "findAgentConfigField", payload },
    tables: {
      query: async (tableName: string) => {
        if (tableName === "il_agent_snapshot") return { rows, total: rows.length };
        return { rows: [], total: 0 };
      },
    },
    secrets: { get: () => undefined },
  };
}

const FIELD_SNAP = [
  { id: "a1", data: { agent_name: "ron", tenant_display_name: "Bezeq", config_json: JSON.stringify({ USE_DYNAMIC_ANNOUNCEMENTS: true, DYNAMIC_ANNOUNCEMENT_PROMPT: "say hi" }) } },
  { id: "a2", data: { agent_name: "tamar", tenant_display_name: "Strauss", config_json: JSON.stringify({ USE_DYNAMIC_ANNOUNCEMENTS: false, DYNAMIC_ANNOUNCEMENT_PROMPT: "say hi" }) } },
];

describe("findAgentConfigField", () => {
  it("matches config keys loosely (normalized substring) and returns key/value per agent", async () => {
    const result: any = await userFunction(makeFieldCtx(FIELD_SNAP, { field: "dynamic announcement" }));
    expect(result.agents).toHaveLength(2);
    const ron = result.agents.find((a: any) => a.agent_name === "ron");
    expect(ron.matched.map((m: any) => m.key)).toContain("USE_DYNAMIC_ANNOUNCEMENTS");
  });

  it("only_truthy keeps only agents with an enabled matched field", async () => {
    const result: any = await userFunction(makeFieldCtx(FIELD_SNAP, { field: "use dynamic announcements", only_truthy: true }));
    expect(result.agents.map((a: any) => a.agent_name)).toEqual(["ron"]);
    expect(result.agents[0].matched).toEqual([{ key: "USE_DYNAMIC_ANNOUNCEMENTS", value: true }]);
  });
});

// ----- listTables / readTable (generic) -----

function makeTableCtx(action: string, payload: Record<string, unknown>, byTable: Record<string, unknown[]> = {}) {
  return {
    data: { action, payload },
    tables: {
      query: async (tableName: string) => {
        const rows = byTable[tableName] || [];
        return { rows, total: rows.length };
      },
    },
    secrets: { get: () => undefined },
  };
}

describe("listTables / readTable", () => {
  it("listTables returns the allow-list and excludes podi_authorized_users", async () => {
    const result: any = await userFunction(makeTableCtx("listTables", {}));
    expect(result.tables).toContain("pods");
    expect(result.tables).not.toContain("podi_authorized_users");
  });

  it("readTable rejects unknown/forbidden tables", async () => {
    const result: any = await userFunction(makeTableCtx("readTable", { table: "podi_authorized_users" }));
    expect(result).toMatchObject({ ok: false, reason: "unknown_table" });
  });

  it("readTable returns rows, applies text filter + limit, and truncates long values", async () => {
    const rows = [
      { id: "p1", data: { pod_name: "Maccabi", notes: "x".repeat(300) } },
      { id: "p2", data: { pod_name: "Discount" } },
      { id: "p3", data: { pod_name: "Maccabi North" } },
    ];
    const all: any = await userFunction(makeTableCtx("readTable", { table: "pods" }, { pods: rows }));
    expect(all.table_total).toBe(3);
    expect(all.rows[0].notes.endsWith("…")).toBe(true);
    const filtered: any = await userFunction(makeTableCtx("readTable", { table: "pods", text: "maccabi" }, { pods: rows }));
    expect(filtered.matched_total).toBe(2);
    const limited: any = await userFunction(makeTableCtx("readTable", { table: "pods", limit: 1 }, { pods: rows }));
    expect(limited.returned).toBe(1);
    expect(limited.matched_total).toBe(3);
  });
});
