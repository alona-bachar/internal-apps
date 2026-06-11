import { describe, expect, it } from "vitest";
import { userFunction } from "./il-agent-configs-data";

// The Wonderful Functions runtime calls `userFunction(context)` with a single
// argument; the request body is delivered on `context.data.{action,payload}`
// per the deploy script's `param_mapping`. Tests below mirror that shape — we
// build a context with `data: { action, payload }` rather than passing input
// as a second argument.

function runAction(
  ctx: Record<string, unknown>,
  action: string | undefined,
  payload?: Record<string, unknown>,
) {
  const data: Record<string, unknown> = {};
  if (action !== undefined) data.action = action;
  if (payload !== undefined) data.payload = payload;
  return userFunction({ ...ctx, data });
}

describe("il-agent-configs-data userFunction", () => {
  it("is exported with the runtime-expected name", () => {
    expect(userFunction.name).toBe("userFunction");
  });

  it("returns MISSING_ACTION when no action is given", async () => {
    const result = await userFunction({ data: {} } as any);
    expect(result).toEqual({ ok: false, error: "MISSING_ACTION" });
  });

  it("returns MISSING_ACTION when context.data is missing entirely", async () => {
    const result = await userFunction({} as any);
    expect(result).toEqual({ ok: false, error: "MISSING_ACTION" });
  });

  it("returns UNKNOWN_ACTION for an unrecognized action", async () => {
    const result = await userFunction({ data: { action: "does_not_exist" } } as any);
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ACTION: does_not_exist" });
  });
});

// Stub for `context.tables.*`. The production function pages rows via
// `query(table, limit, offset)` and reads single rows via
// `filter(table, filters, limit, offset)`. Both return
// `{ rows: Row[], total: number }` where each `Row` has `{ id, data }`.
// Unknown tables come back as empty (matches the SDK behavior — `query` on a
// non-existent table returns `{ rows: [], total: 0 }`, not a throw — but for
// safety the test setup always supplies all tables it expects to be queried).
type TableRow = { id: string; data: Record<string, unknown> };
type TableFilter = { column: string; operator: string; value: unknown };

type Stores = {
  pods?: TableRow[];
  pod_agents?: TableRow[];
  pod_assignments?: TableRow[];
  people?: TableRow[];
  pod_agent_config_changes?: TableRow[];
  il_agent_snapshot?: TableRow[];
  il_agent_metrics?: TableRow[];
  il_agent_latency?: TableRow[];
  il_active_agents?: TableRow[];
};

type RecordedOp =
  | { kind: "query"; table: string; limit: number; offset: number }
  | { kind: "filter"; table: string; filters: TableFilter[]; limit: number; offset: number }
  | { kind: "insert"; table: string; data: Record<string, unknown> }
  | { kind: "update"; table: string; rowId: string; patch: Record<string, unknown> }
  | { kind: "delete"; table: string; rowId: string };

function makeTablesStub(initial: Stores = {}) {
  const stores: Required<Stores> = {
    pods: initial.pods ?? [],
    pod_agents: initial.pod_agents ?? [],
    pod_assignments: initial.pod_assignments ?? [],
    people: initial.people ?? [],
    pod_agent_config_changes: initial.pod_agent_config_changes ?? [],
    il_agent_snapshot: initial.il_agent_snapshot ?? [],
    il_agent_metrics: initial.il_agent_metrics ?? [],
    il_agent_latency: initial.il_agent_latency ?? [],
    il_active_agents: initial.il_active_agents ?? [],
  };
  const ops: RecordedOp[] = [];

  function getStore(table: string): TableRow[] {
    if (!(table in stores)) {
      throw new Error(`tables stub: unknown table "${table}"`);
    }
    return (stores as Record<string, TableRow[]>)[table];
  }

  return {
    stores,
    ops,
    tables: {
      query: async (table: string, limit: number, offset: number) => {
        ops.push({ kind: "query", table, limit, offset });
        const rows = getStore(table);
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      },
      filter: async (table: string, filters: TableFilter[], limit: number, offset: number) => {
        ops.push({ kind: "filter", table, filters, limit, offset });
        let rows = getStore(table);
        for (const f of filters) {
          if (f.operator === "eq") {
            rows = rows.filter((r) => {
              const fromData = r.data ? (r.data as Record<string, unknown>)[f.column] : undefined;
              const fromRow = (r as unknown as Record<string, unknown>)[f.column];
              const v = fromData !== undefined ? fromData : fromRow;
              return v === f.value;
            });
          } else {
            throw new Error(`tables stub: unsupported operator "${f.operator}"`);
          }
        }
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      },
      insert: async (table: string, data: Record<string, unknown>) => {
        ops.push({ kind: "insert", table, data });
        const store = getStore(table);
        const id = String(data.id ?? `row_${store.length + 1}`);
        store.push({ id, data });
        return data;
      },
      update: async (table: string, rowId: string, patch: Record<string, unknown>) => {
        ops.push({ kind: "update", table, rowId, patch });
        const store = getStore(table);
        const row = store.find((r) => r.id === rowId);
        if (row) row.data = { ...row.data, ...patch };
        return row;
      },
      deleteRow: async (table: string, rowId: string) => {
        ops.push({ kind: "delete", table, rowId });
        const store = getStore(table);
        const idx = store.findIndex((r) => r.id === rowId);
        if (idx >= 0) store.splice(idx, 1);
      },
    },
  };
}

function makeContext(initial: Stores = {}) {
  const stub = makeTablesStub(initial);
  return {
    ctx: {
      metadata: { tenantId: "cto-office" },
      secrets: { get: () => undefined },
      tables: stub.tables,
    } as any,
    stub,
  };
}

describe("get_overview action", () => {
  it("builds tier overview from active agents, joining pod context (tier/slack/owners)", async () => {
    const { ctx } = makeContext({
      pods: [
        { id: "leumi", data: { id: "leumi", tier: "Tier 1", pod_name: "Leumi", slack_channel_id: "C001", slack_channel_name: "#il-pod-leumi" } },
      ],
      pod_assignments: [
        { id: "a1", data: { pod_id: "leumi", person_id: "p1", role: "DS" } },
        { id: "a2", data: { pod_id: "leumi", person_id: "p2", role: "FDE" } },
      ],
      people: [
        { id: "p1", data: { id: "p1", first_name: "Yossi", last_name: "Levi" } },
        { id: "p2", data: { id: "p2", first_name: "Tomer", last_name: "Katz" } },
      ],
      il_active_agents: [
        { id: "AG-1", data: { id: "AG-1", tenant_name: "Leumi", agent_name: "Leumi Observer", activities: 1200 } },
      ],
      il_agent_snapshot: [
        { id: "AG-1", data: { agent_id: "AG-1", agent_name: "Leumi Observer", agent_display_name: "Observer", config_json: JSON.stringify({}) } },
      ],
    });

    const res: any = await runAction(ctx, "get_overview", {});

    expect(res.ok).toBe(true);
    expect(res.tiers["Tier 1"]).toHaveLength(1);
    const pod = res.tiers["Tier 1"][0];
    expect(pod.customer).toBe("Leumi");
    expect(pod.slack_channel_name).toBe("#il-pod-leumi");
    expect(pod.ds).toEqual(["Yossi Levi"]);
    expect(pod.fde).toEqual(["Tomer Katz"]);
    expect(pod.agents).toHaveLength(1);
    expect(pod.agents[0].platform_agent_id).toBe("AG-1");
    expect(pod.agents[0].agent_name).toBe("Leumi Observer");
    expect(pod.agents[0].use_case).toBe("Observer");
    expect(pod.agents[0].activities).toBe(1200);
  });

  it("only shows active agents; tenants with no active agent don't appear", async () => {
    const { ctx } = makeContext({
      pods: [
        { id: "leumi", data: { id: "leumi", tier: "Tier 1", pod_name: "Leumi", slack_channel_id: "C001", slack_channel_name: "#il-pod-leumi" } },
        { id: "discount", data: { id: "discount", tier: "Tier 2", pod_name: "Discount" } },
      ],
      il_active_agents: [
        { id: "AG-1", data: { id: "AG-1", tenant_name: "Leumi", agent_name: "Observer" } },
      ],
    });

    const res: any = await runAction(ctx, "get_overview", {});
    expect(res.ok).toBe(true);
    expect(res.tiers["Tier 1"]).toHaveLength(1);
    expect(res.tiers["Tier 2"]).toBeUndefined();
  });

  it("groups an active agent under an unknown tenant as Unspecified with no owners/slack", async () => {
    const { ctx } = makeContext({
      pods: [{ id: "leumi", data: { id: "leumi", tier: "Tier 1", pod_name: "Leumi" } }],
      il_active_agents: [{ id: "AG-9", data: { id: "AG-9", tenant_name: "Strauss", agent_name: "tamar" } }],
    });

    const res: any = await runAction(ctx, "get_overview", {});
    const u = res.tiers["Unspecified"];
    expect(u).toHaveLength(1);
    expect(u[0].customer).toBe("Strauss");
    expect(u[0].ds).toEqual([]);
    expect(u[0].slack_channel_id).toBeNull();
  });

  it("recognizes long-form role labels (Data Scientist / Forward Deployed Engineer)", async () => {
    const { ctx } = makeContext({
      pods: [{ id: "mizrahi", data: { id: "mizrahi", tier: "Tier 1", pod_name: "Mizrahi" } }],
      pod_assignments: [
        { id: "a3", data: { pod_id: "mizrahi", person_id: "p3", role: "Data Scientist" } },
        { id: "a4", data: { pod_id: "mizrahi", person_id: "p4", role: "Forward Deployed Engineer" } },
      ],
      people: [
        { id: "p3", data: { id: "p3", first_name: "Dana", last_name: "Cohen" } },
        { id: "p4", data: { id: "p4", first_name: "Eli", last_name: "Mor" } },
      ],
      il_active_agents: [{ id: "AG-2", data: { id: "AG-2", tenant_name: "Mizrahi", agent_name: "Composer" } }],
    });

    const res: any = await runAction(ctx, "get_overview", {});
    const pod = res.tiers["Tier 1"][0];
    expect(pod.ds).toEqual(["Dana Cohen"]);
    expect(pod.fde).toEqual(["Eli Mor"]);
  });

  it("passes through null slack channel fields when the pod has none", async () => {
    const { ctx } = makeContext({
      pods: [{ id: "poalim", data: { id: "poalim", tier: "Tier 3", pod_name: "Poalim" } }],
      il_active_agents: [{ id: "AG-3", data: { id: "AG-3", tenant_name: "Poalim", agent_name: "Inbox" } }],
    });

    const res: any = await runAction(ctx, "get_overview", {});
    const pod = res.tiers["Tier 3"][0];
    expect(pod.slack_channel_id).toBeNull();
    expect(pod.slack_channel_name).toBeNull();
  });

  it("propagates the error message when context.tables.query throws", async () => {
    const ctx: any = {
      metadata: { tenantId: "cto-office" },
      secrets: { get: () => undefined },
      tables: {
        query: async () => {
          throw new Error("listRows(pods) -> 500: boom");
        },
      },
    };
    await expect(runAction(ctx, "get_overview", {})).rejects.toThrow(/500: boom/);
  });
});

// Helper: a pod + single pod_agent with the given platform_agent_id (or null).
// An active agent under a pod, for enrichment tests. agentName defaults null so
// agent_name comes from the snapshot (or stays null when no snapshot).
function activeAgentCtx(opts: {
  tenant?: string;
  tier?: string;
  agentId?: string;
  agentName?: string | null;
}): Pick<Stores, "pods" | "il_active_agents"> {
  const tenant = opts.tenant ?? "Leumi";
  return {
    pods: [{ id: tenant.toLowerCase(), data: { id: tenant.toLowerCase(), tier: opts.tier ?? "Tier 1", pod_name: tenant } }],
    il_active_agents: [
      { id: opts.agentId ?? "AG-1", data: { id: opts.agentId ?? "AG-1", tenant_name: tenant, agent_name: opts.agentName ?? null, activities: 999 } },
    ],
  };
}

describe("get_overview enrichment from il_agent_snapshot + il_agent_metrics", () => {
  it("populates metrics and agent_name when snapshot + metrics both exist", async () => {
    const { ctx } = makeContext({
      ...activeAgentCtx({ agentId: "AG-1", tenant: "Leumi" }),
      il_agent_metrics: [
        {
          id: "AG-1",
          data: {
            agent_id: "AG-1",
            conversations_24h: 12,
            conversations_week_avg: 1628,
            open_issues: 7,
            last_call_at: "2026-05-26T22:30:00Z",
          },
        },
      ],
      il_agent_snapshot: [
        {
          id: "AG-1",
          data: {
            agent_id: "AG-1",
            agent_name: "Leumi Observer Agent",
            config_json: JSON.stringify({ "stt.model": "nova-2", "tts.voice": "alloy" }),
          },
        },
      ],
    });

    const res: any = await runAction(ctx, "get_overview", {});
    expect(res.ok).toBe(true);
    const agent = res.tiers["Tier 1"][0].agents[0];
    expect(agent.conversations_24h).toBe(12);
    expect(agent.conversations_week_avg).toBe(1628);
    expect(agent.open_issues).toBe(7);
    expect(agent.last_call_at).toBe("2026-05-26T22:30:00Z");
    expect(agent.agent_name).toBe("Leumi Observer Agent");
  });


  it("populates metrics but leaves agent_name null when no snapshot exists", async () => {
    const { ctx } = makeContext({
      ...activeAgentCtx({ agentId: "AG-1", tenant: "Leumi" }),
      il_agent_metrics: [
        {
          id: "AG-1",
          data: {
            agent_id: "AG-1",
            conversations_24h: 5,
            conversations_week_avg: 10,
            open_issues: 0,
            last_call_at: "2026-05-26T10:00:00Z",
          },
        },
      ],
      // no snapshot
    });

    const res: any = await runAction(ctx, "get_overview", {});
    const agent = res.tiers["Tier 1"][0].agents[0];
    expect(agent.conversations_24h).toBe(5);
    expect(agent.conversations_week_avg).toBe(10);
    expect(agent.open_issues).toBe(0);
    expect(agent.last_call_at).toBe("2026-05-26T10:00:00Z");
    expect(agent.agent_name).toBeNull();
  });

  it("leaves agent_name null when snapshot exists but has no agent_name field", async () => {
    const { ctx } = makeContext({
      ...activeAgentCtx({ agentId: "AG-1", tenant: "Leumi" }),
      il_agent_metrics: [
        {
          id: "AG-1",
          data: { agent_id: "AG-1", conversations_24h: 3 },
        },
      ],
      il_agent_snapshot: [
        {
          id: "AG-1",
          data: { agent_id: "AG-1", config_json: JSON.stringify({ "stt.model": "nova-2" }) },
        },
      ],
    });

    const res: any = await runAction(ctx, "get_overview", {});
    const agent = res.tiers["Tier 1"][0].agents[0];
    expect(agent.conversations_24h).toBe(3);
    expect(agent.agent_name).toBeNull();
  });
});

describe("get_agent_detail action", () => {
  it("returns MISSING_FIELDS when platform_agent_id is missing", async () => {
    const { ctx } = makeContext();
    const res = await runAction(ctx, "get_agent_detail", { use_case: "Observer" });
    expect(res).toEqual({ ok: false, error: "MISSING_FIELDS" });
  });

  it("returns MISSING_FIELDS when use_case is missing", async () => {
    const { ctx } = makeContext();
    const res = await runAction(ctx, "get_agent_detail", { platform_agent_id: "AG-1" });
    expect(res).toEqual({ ok: false, error: "MISSING_FIELDS" });
  });

  it("returns AGENT_NOT_FOUND when no snapshot row matches the platform_agent_id", async () => {
    const { ctx } = makeContext({
      il_agent_snapshot: [
        {
          id: "AG-2",
          data: { agent_id: "AG-2", config_json: JSON.stringify({}) },
        },
      ],
    });
    const res = await runAction(ctx, "get_agent_detail", {
      platform_agent_id: "AG-1",
      use_case: "Observer",
    });
    expect(res).toEqual({ ok: false, error: "AGENT_NOT_FOUND" });
  });

  it("returns sorted fields with { path, value } only", async () => {
    const { ctx } = makeContext({
      il_agent_snapshot: [
        {
          id: "AG-1",
          data: {
            agent_id: "AG-1",
            config_json: JSON.stringify({
              "stt.model": "nova-2",
              "tts.voice": "echo",
              "extra.flag": true,
            }),
          },
        },
      ],
    });

    const res: any = await runAction(ctx, "get_agent_detail", {
      platform_agent_id: "AG-1",
      use_case: "Observer",
    });
    expect(res.ok).toBe(true);
    expect(res.use_case).toBe("Observer");
    expect(res.platform_agent_id).toBe("AG-1");
    expect(res.fields).toHaveLength(3);
    // Alphabetically sorted by path.
    expect(res.fields.map((f: any) => f.path)).toEqual([
      "extra.flag",
      "stt.model",
      "tts.voice",
    ]);
    expect(res.fields).toContainEqual({ path: "stt.model", value: "nova-2" });
    expect(res.fields).toContainEqual({ path: "tts.voice", value: "echo" });
    expect(res.fields).toContainEqual({ path: "extra.flag", value: true });
  });

  it("returns empty fields array when config_json is empty", async () => {
    const { ctx } = makeContext({
      il_agent_snapshot: [
        {
          id: "AG-1",
          data: {
            agent_id: "AG-1",
            config_json: JSON.stringify({}),
          },
        },
      ],
    });

    const res: any = await runAction(ctx, "get_agent_detail", {
      platform_agent_id: "AG-1",
      use_case: "Observer",
    });
    expect(res.ok).toBe(true);
    expect(res.fields).toEqual([]);
  });
});

describe("list_changes action", () => {
  it("returns an empty list when the table has no rows", async () => {
    const { ctx } = makeContext();
    const res: any = await runAction(ctx, "list_changes", {});
    expect(res).toEqual({ ok: true, changes: [] });
  });

  it("returns changes sorted by changed_at desc", async () => {
    const { ctx } = makeContext({
      pod_agent_config_changes: [
        {
          id: "c1",
          data: {
            id: "c1",
            scope: "baseline",
            scope_id: "Observer",
            field_path: "stt.model",
            old_value: "nova-3",
            new_value: "nova-2",
            changed_by: "alona.b@wonderful.ai",
            changed_at: "2026-05-25T10:00:00Z",
          },
        },
        {
          id: "c2",
          data: {
            id: "c2",
            scope: "baseline",
            scope_id: "Composer",
            field_path: "tts.voice",
            old_value: "alloy",
            new_value: "echo",
            changed_by: "alona.b@wonderful.ai",
            changed_at: "2026-05-26T10:00:00Z",
          },
        },
      ],
    });
    const res: any = await runAction(ctx, "list_changes", {});
    expect(res.ok).toBe(true);
    expect(res.changes.map((c: any) => c.id)).toEqual(["c2", "c1"]);
  });

  it("filters by scope_id when provided", async () => {
    const { ctx } = makeContext({
      pod_agent_config_changes: [
        {
          id: "c1",
          data: {
            id: "c1",
            scope: "baseline",
            scope_id: "Observer",
            changed_at: "2026-05-25T10:00:00Z",
          },
        },
        {
          id: "c2",
          data: {
            id: "c2",
            scope: "baseline",
            scope_id: "Composer",
            changed_at: "2026-05-26T10:00:00Z",
          },
        },
      ],
    });
    const res: any = await runAction(ctx, "list_changes", { scope_id: "Observer" });
    expect(res.ok).toBe(true);
    expect(res.changes.map((c: any) => c.id)).toEqual(["c1"]);
  });

  it("respects the limit param", async () => {
    const rows = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push({
        id: `c${i}`,
        data: {
          id: `c${i}`,
          scope: "baseline",
          scope_id: "Observer",
          changed_at: `2026-05-2${i}T10:00:00Z`,
        },
      });
    }
    const { ctx } = makeContext({ pod_agent_config_changes: rows });
    const res: any = await runAction(ctx, "list_changes", { limit: 2 });
    expect(res.changes).toHaveLength(2);
    // Most recent first: c4, c3
    expect(res.changes.map((c: any) => c.id)).toEqual(["c4", "c3"]);
  });
});

describe("get_overview derived card fields", () => {
  // Minimal pod + active agent so one agent flows through enrichment.
  const baseTables = () => ({
    pods: [{ id: "maccabi", data: { id: "maccabi", pod_name: "Maccabi", tier: "Tier 1" } }],
    il_active_agents: [{ id: "AG-1", data: { id: "AG-1", tenant_name: "Maccabi", agent_name: "A", activities: 999 } }],
  });

  function snapshot(cfg: Record<string, unknown>) {
    return [{ id: "AG-1", data: { agent_id: "AG-1", agent_name: "A", config_json: JSON.stringify(cfg) } }];
  }

  async function agentWith(cfg: Record<string, unknown>) {
    const { ctx } = makeContext({ ...baseTables(), il_agent_snapshot: snapshot(cfg) });
    const res: any = await runAction(ctx, "get_overview", {});
    expect(res.ok).toBe(true);
    return res.tiers["Tier 1"][0].agents[0];
  }

  it("maps LLM_MODEL / TRANSCRIBER_PRIMARY_PROVIDER / VOICE_PRIMARY_ENDPOINT_PROVIDER and Static skills", async () => {
    const a = await agentWith({
      LLM_MODEL: "gpt-4o",
      TRANSCRIBER_PRIMARY_PROVIDER: "deepgram",
      VOICE_PRIMARY_ENDPOINT_PROVIDER: "elevenlabs",
      IS_MULTI_SKILL: false,
    });
    expect(a.agent_model).toBe("gpt-4o");
    expect(a.stt_model).toBe("deepgram");
    expect(a.tts_model).toBe("elevenlabs");
    expect(a.skills_behavior).toBe("Static");
  });

  it("uses LLM_MODEL (not the voice model) and formats Dynamic switch mode", async () => {
    const a = await agentWith({
      LLM_MODEL: "gpt-4o",
      LLM_VOICE_MODEL: "gpt-4o-realtime",
      LLM_VOICE_ENABLED: true,
      IS_MULTI_SKILL: true,
      SWITCH_MODE: "KEYWORD",
    });
    expect(a.agent_model).toBe("gpt-4o");
    expect(a.skills_behavior).toBe("Dynamic (keyword)");
  });

  it('treats the string "false" as false (asBool) and blanks empty strings (asStr)', async () => {
    const a = await agentWith({
      LLM_MODEL: "gpt-4o",
      LLM_VOICE_ENABLED: "false",
      IS_MULTI_SKILL: "false",
      TRANSCRIBER_PRIMARY_PROVIDER: "   ",
    });
    expect(a.agent_model).toBe("gpt-4o");
    expect(a.skills_behavior).toBe("Static");
    expect(a.stt_model).toBeNull();
  });

  it("returns null card fields when the agent has no snapshot", async () => {
    const { ctx } = makeContext({ ...baseTables(), il_agent_snapshot: [] });
    const res: any = await runAction(ctx, "get_overview", {});
    const a = res.tiers["Tier 1"][0].agents[0];
    expect(a.agent_model).toBeNull();
    expect(a.stt_model).toBeNull();
    expect(a.tts_model).toBeNull();
    expect(a.skills_behavior).toBeNull();
    expect(a.latency_ms).toBeNull();
  });

  it("attaches latency_ms from il_agent_latency by agent_id (platform_agent_id)", async () => {
    const { ctx } = makeContext({
      ...baseTables(),
      il_agent_snapshot: snapshot({ LLM_MODEL: "gpt-4o" }),
      il_agent_latency: [
        { id: "AG-1", data: { id: "AG-1", agent_name: "A", tenant_name: "Maccabi", latency_ms: 1234 } },
      ],
    });
    const res: any = await runAction(ctx, "get_overview", {});
    expect(res.tiers["Tier 1"][0].agents[0].latency_ms).toBe(1234);
  });

  // Backoffice agents surface LLM_TASK_MODEL as agent_model (their LLM_MODEL is
  // leftover *-realtime voice boilerplate).
  async function backofficeAgentWith(cfg: Record<string, unknown>) {
    const { ctx } = makeContext({
      pods: [{ id: "maccabi", data: { id: "maccabi", pod_name: "Maccabi", tier: "Tier 1" } }],
      il_active_agents: [
        { id: "AG-1", data: { id: "AG-1", tenant_name: "Maccabi", agent_name: "A", activities: 999, agent_type: "Backoffice" } },
      ],
      il_agent_snapshot: snapshot(cfg),
    });
    const res: any = await runAction(ctx, "get_overview", {});
    expect(res.ok).toBe(true);
    return res.tiers["Tier 1"][0].agents[0];
  }

  it("uses LLM_TASK_MODEL as agent_model for backoffice (ignores boilerplate LLM_MODEL and the V2 runtime model)", async () => {
    const a = await backofficeAgentWith({
      LLM_MODEL: "gpt-realtime-2025-08-28",
      LLM_TASK_MODEL: "gpt-5.2",
      TASK_BACKOFFICE_V2_ENABLED: true,
      TASK_BACKOFFICE_V2_RUNTIME_MODEL: "claude-opus-4-6",
    });
    expect(a.agent_type).toBe("Backoffice");
    expect(a.agent_model).toBe("gpt-5.2");
  });

  it("yields null agent_model for backoffice when LLM_TASK_MODEL is unset", async () => {
    const a = await backofficeAgentWith({ LLM_MODEL: "gpt-realtime-2025-08-28" });
    expect(a.agent_model).toBeNull();
  });
});

describe("get_overview card provider · model + fallbacks", () => {
  const baseTables = () => ({
    pods: [{ id: "maccabi", data: { id: "maccabi", pod_name: "Maccabi", tier: "Tier 1" } }],
    il_active_agents: [{ id: "AG-1", data: { id: "AG-1", tenant_name: "Maccabi", agent_name: "A", activities: 999 } }],
  });
  function snapshot(cfg: Record<string, unknown>) {
    return [{ id: "AG-1", data: { agent_id: "AG-1", agent_name: "A", config_json: JSON.stringify(cfg) } }];
  }
  async function agentWith(cfg: Record<string, unknown>) {
    const { ctx } = makeContext({ ...baseTables(), il_agent_snapshot: snapshot(cfg) });
    const res: any = await runAction(ctx, "get_overview", {});
    return res.tiers["Tier 1"][0].agents[0];
  }

  it("composes 'provider · model' for LLM / STT / TTS", async () => {
    const a = await agentWith({
      LLM_SELECTED_PROVIDER: "openai", LLM_MODEL: "gpt-realtime-2025-08-28",
      TRANSCRIBER_PRIMARY_PROVIDER: "soniox", TRANSCRIBER_PRIMARY_SONIOX_MODEL: "stt-rt-v4",
      VOICE_PRIMARY_ENDPOINT_PROVIDER: "deepdub", VOICE_PRIMARY_DEEPDUB_MODEL_ID: "wonderf7",
    });
    expect(a.agent_model).toBe("openai · gpt-realtime-2025-08-28");
    expect(a.stt_model).toBe("soniox · stt-rt-v4");
    expect(a.tts_model).toBe("deepdub · wonderf7");
  });

  it("selects the STT model by active provider and ignores inactive-provider boilerplate (aws has no model slug)", async () => {
    const a = await agentWith({
      TRANSCRIBER_PRIMARY_PROVIDER: "aws",
      TRANSCRIBER_PRIMARY_DEEPGRAM_MODEL: "nova-3", // stale field from an inactive provider
    });
    expect(a.stt_model).toBe("aws");
  });

  it("uses the batch model for the soniox_batch provider", async () => {
    const a = await agentWith({
      TRANSCRIBER_PRIMARY_PROVIDER: "soniox_batch",
      TRANSCRIBER_PRIMARY_SONIOX_BATCH_MODEL: "stt-async-v4",
      TRANSCRIBER_PRIMARY_SONIOX_MODEL: "stt-rt-v4",
    });
    expect(a.stt_model).toBe("soniox_batch · stt-async-v4");
  });

  it("reads LLM / STT / TTS fallbacks from the nested config blobs", async () => {
    const a = await agentWith({
      LLM_SELECTED_PROVIDER: "openai", LLM_MODEL: "gpt-realtime-1.5",
      LLM_CONFIGURATION: { backup_endpoints: [{ selected_provider: "azure", model: "gpt-realtime-2025-08-28" }] },
      VOICE_PRIMARY_ENDPOINT_PROVIDER: "deepdub", VOICE_PRIMARY_DEEPDUB_MODEL_ID: "wonderf7",
      VOICE_CONFIGURATION: { backup_endpoints: [{ provider: "elevenlabs", elevenlabs: { model_id: "eleven_v3" } }] },
      TRANSCRIBER_PRIMARY_PROVIDER: "soniox", TRANSCRIBER_PRIMARY_SONIOX_MODEL: "stt-rt-v4",
      TRANSCRIBER_CONFIGURATION: { backups: [{ soniox: { enabled: false }, deepgram: { enabled: true, model: "nova-3" } }] },
    });
    expect(a.agent_model_fallback).toBe("azure · gpt-realtime-2025-08-28");
    expect(a.tts_model_fallback).toBe("elevenlabs · eleven_v3");
    expect(a.stt_model_fallback).toBe("deepgram · nova-3");
  });

  it("returns null fallbacks when no backup endpoints are configured", async () => {
    const a = await agentWith({
      LLM_SELECTED_PROVIDER: "openai", LLM_MODEL: "gpt-realtime-1.5",
      TRANSCRIBER_PRIMARY_PROVIDER: "soniox",
      VOICE_PRIMARY_ENDPOINT_PROVIDER: "deepdub",
    });
    expect(a.agent_model_fallback).toBeNull();
    expect(a.stt_model_fallback).toBeNull();
    expect(a.tts_model_fallback).toBeNull();
  });

  it("gives backoffice no LLM fallback even when a backup endpoint exists", async () => {
    const { ctx } = makeContext({
      ...baseTables(),
      il_active_agents: [{ id: "AG-1", data: { id: "AG-1", tenant_name: "Maccabi", agent_name: "A", activities: 999, agent_type: "Backoffice" } }],
      il_agent_snapshot: snapshot({
        LLM_MODEL: "gpt-realtime-1.5", LLM_TASK_MODEL: "gpt-5.2",
        LLM_CONFIGURATION: { backup_endpoints: [{ selected_provider: "azure", model: "x" }] },
      }),
    });
    const res: any = await runAction(ctx, "get_overview", {});
    const a = res.tiers["Tier 1"][0].agents[0];
    expect(a.agent_model).toBe("gpt-5.2");
    expect(a.agent_model_fallback).toBeNull();
  });
});

describe("get_overview surfaces channel-bearing pods with no agents", () => {
  it("includes a pod that has a slack_channel_id but no active agent (empty agents)", async () => {
    const { ctx } = makeContext({
      pods: [
        { id: "cto_office", data: { id: "cto_office", pod_name: "CTO Office", tier: "Strategic", slack_channel_id: "C09TP5K1CFL", slack_channel_name: "#cto-office-israel" } },
      ],
      il_active_agents: [],
    });
    const res: any = await runAction(ctx, "get_overview", {});
    expect(res.ok).toBe(true);
    const cto = (res.tiers["Strategic"] ?? []).find((p: any) => p.pod_id === "cto_office");
    expect(cto).toBeDefined();
    expect(cto.slack_channel_id).toBe("C09TP5K1CFL");
    expect(cto.agents).toEqual([]);
  });

  it("does not duplicate a pod that already has an active agent", async () => {
    const { ctx } = makeContext({
      pods: [{ id: "maccabi", data: { id: "maccabi", pod_name: "Maccabi", tier: "Tier 1", slack_channel_id: "C1" } }],
      il_active_agents: [{ id: "AG-1", data: { id: "AG-1", tenant_name: "Maccabi", agent_name: "A", activities: 999 } }],
    });
    const res: any = await runAction(ctx, "get_overview", {});
    const maccabi = (res.tiers["Tier 1"] ?? []).filter((p: any) => p.pod_id === "maccabi");
    expect(maccabi).toHaveLength(1);
    expect(maccabi[0].agents.length).toBe(1);
  });

  it("skips pods without a slack_channel_id", async () => {
    const { ctx } = makeContext({
      pods: [{ id: "ghost", data: { id: "ghost", pod_name: "Ghost", tier: "Tier 3", slack_channel_id: null } }],
      il_active_agents: [],
    });
    const res: any = await runAction(ctx, "get_overview", {});
    const all = Object.values(res.tiers).flat() as any[];
    expect(all.find((p) => p.pod_id === "ghost")).toBeUndefined();
  });
});

