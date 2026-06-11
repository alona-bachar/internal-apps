import { afterEach, describe, expect, it, vi } from "vitest";
import { userFunction, renderTemplate } from "./il-pod-slack-poster";

// The Wonderful Functions runtime calls `userFunction(context)` with a single
// argument; the request body is delivered on `context.data.{action,payload}`
// per the deploy script's `param_mapping`. We build the context with
// `data: { action, payload }` and pass that into `userFunction`.
//
// The pod lookup goes through `context.tables.filter` now (the runtime can't
// resolve `https://<tenantId>.api.wonderful.ai/...` because tenantId is a
// UUID, not the hostname slug). The Slack POST still hits `slack.com` via
// raw fetch, so we keep a fetch router scoped to that one URL.

type RecordedRequest = { url: string; method: string; body: string | null; headers: Record<string, string> };

function installSlackFetchRouter(
  routeHandler: (req: RecordedRequest) => { status: number; body: unknown },
) {
  const recorded: RecordedRequest[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders && typeof rawHeaders === "object") {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k] = String(v);
      }
    }
    const req: RecordedRequest = { url, method, body, headers };
    recorded.push(req);
    const out = routeHandler(req);
    return new Response(out.body == null ? "" : JSON.stringify(out.body), { status: out.status });
  }) as unknown as typeof globalThis.fetch);
  return recorded;
}

type PodRow = { id: string; data: Record<string, unknown> };
type TableFilter = { column: string; operator: string; value: unknown };

function makeTablesStub(pods: PodRow[]) {
  return {
    filter: async (
      _table: string,
      filters: TableFilter[],
      limit: number,
      offset: number,
    ) => {
      let rows = pods;
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
    query: async () => ({ rows: pods, total: pods.length }),
    insert: async () => ({}),
    update: async () => ({}),
    deleteRow: async () => undefined,
  };
}

// Per the plan, the slack_bot_token secret payload is `{ token: "xoxb-..." }`.
function makeContext(opts?: { slackToken?: string | undefined; pods?: PodRow[] }) {
  const slackToken = opts && "slackToken" in opts ? opts.slackToken : "xoxb-fake";
  const pods = opts?.pods ?? [];
  return {
    metadata: { tenantId: "cto-office" },
    secrets: {
      get: (name: string) => {
        if (name === "slack_bot_token") {
          return slackToken === undefined ? undefined : { token: slackToken };
        }
        return undefined;
      },
    },
    tables: makeTablesStub(pods),
  } as any;
}

// Helper: assemble a `context.data` body and invoke `userFunction`. Matches
// the runtime, which passes a single context whose `.data` is shaped by the
// deploy script's `param_mapping.body_params`.
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

describe("il-pod-slack-poster userFunction — entry contract", () => {
  it("is exported with the runtime-expected name", () => {
    expect(userFunction.name).toBe("userFunction");
  });
});

describe("renderTemplate — token substitution", () => {
  const self = { fde: "<@U1>, Dana Levi", ds: "<@U2>", tier: "Tier 1", customer: "Maccabi" };
  const byCustomer = new Map<string, any>([
    ["bezeq", { fde: "<@U9>", ds: "", tier: "Tier 2", customer: "Bezeq" }],
  ]);

  it("substitutes relative tokens against the channel's own pod", () => {
    expect(renderTemplate("Hi {fde} on {customer} ({tier})", self, byCustomer)).toBe(
      "Hi <@U1>, Dana Levi on Maccabi (Tier 1)",
    );
  });

  it("substitutes absolute {customer_field} regardless of channel", () => {
    expect(renderTemplate("ping {bezeq_fde} ({bezeq_name})", self, byCustomer)).toBe("ping <@U9> (Bezeq)");
  });

  it("leaves unknown tokens and unknown customers untouched", () => {
    expect(renderTemplate("{foo} {acme_fde}", self, byCustomer)).toBe("{foo} {acme_fde}");
  });

  it("renders an empty string when a role list is empty", () => {
    expect(renderTemplate("x{ds}y", { ...self, ds: "" }, byCustomer)).toBe("xy");
  });
});

// A tables stub that returns different rows per table name (for buildVarContext).
function makeMultiTableContext(tables: Record<string, PodRow[]>) {
  return {
    metadata: { tenantId: "cto-office" },
    secrets: { get: (n: string) => (n === "slack_bot_token" ? { token: "xoxb-fake" } : undefined) },
    tables: {
      query: async (table: string) => {
        const rows = tables[table] ?? [];
        return { rows, total: rows.length };
      },
      filter: async (table: string, filters: TableFilter[]) => {
        let rows = tables[table] ?? [];
        for (const f of filters) {
          if (f.operator !== "eq") throw new Error(`unsupported operator ${f.operator}`);
          rows = rows.filter((r) => (r.data ? r.data[f.column] : undefined) === f.value);
        }
        return { rows, total: rows.length };
      },
    },
  } as any;
}

describe("il-pod-slack-poster — per-channel mention resolution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders each channel's own FDEs as mentions, with name fallback when no Slack ID", async () => {
    const sent: Array<{ channel: string; text: string }> = [];
    installSlackFetchRouter((req) => {
      if (req.url === "https://slack.com/api/conversations.join") return { status: 200, body: { ok: true } };
      if (req.url === "https://slack.com/api/chat.postMessage") {
        const p = JSON.parse(req.body!);
        sent.push({ channel: p.channel, text: p.text });
        return { status: 200, body: { ok: true, ts: "1.1" } };
      }
      throw new Error("unexpected: " + req.url);
    });

    const ctx = makeMultiTableContext({
      pods: [
        { id: "maccabi", data: { id: "maccabi", pod_name: "Maccabi", tier: "Tier 1", slack_channel_id: "C1" } },
        { id: "bezeq", data: { id: "bezeq", pod_name: "Bezeq", tier: "Tier 2", slack_channel_id: "C2" } },
      ],
      pod_assignments: [
        { id: "a1", data: { pod_id: "maccabi", person_id: "p1", role: "FDE" } },
        { id: "a2", data: { pod_id: "maccabi", person_id: "p2", role: "DS" } },
        { id: "a3", data: { pod_id: "bezeq", person_id: "p3", role: "FDE" } },
      ],
      people: [
        { id: "p1", data: { id: "p1", first_name: "Adi", last_name: "Cohen" } },
        { id: "p2", data: { id: "p2", first_name: "Dana", last_name: "Levi" } },
        { id: "p3", data: { id: "p3", first_name: "Ron", last_name: "Bar" } },
      ],
      people_slack_ids: [
        { id: "m1", data: { person_id: "p1", slack_user_id: "U1" } },
        { id: "m3", data: { person_id: "p3", slack_user_id: "U3" } }, // p2 deliberately has no Slack ID
      ],
    });

    const res: any = await userFunction({ ...ctx, data: { action: "post", payload: { pod_ids: ["maccabi", "bezeq"], message: "FDE {fde} · DS {ds}" } } });
    expect(res.ok).toBe(true);
    expect(res.posted).toHaveLength(2);

    const maccabi = sent.find((s) => s.channel === "C1");
    const bezeq = sent.find((s) => s.channel === "C2");
    // Maccabi: FDE has a Slack ID (mention), DS has none (name fallback)
    expect(maccabi!.text).toBe("FDE <@U1> · DS Dana Levi");
    // Bezeq: its own FDE, no DS assigned -> empty
    expect(bezeq!.text).toBe("FDE <@U3> · DS ");
  });
});

describe("il-pod-slack-poster userFunction — action validation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns MISSING_ACTION when no action is given", async () => {
    const res = await runAction(makeContext(), undefined, { pod_ids: ["leumi"], message: "hi" });
    expect(res).toEqual({ ok: false, error: "MISSING_ACTION" });
  });

  it("returns MISSING_ACTION when context.data is missing entirely", async () => {
    const res = await userFunction(makeContext());
    expect(res).toEqual({ ok: false, error: "MISSING_ACTION" });
  });

  it("returns UNKNOWN_ACTION for an unrecognized action", async () => {
    const res = await runAction(makeContext(), "delete", { pod_ids: ["leumi"], message: "hi" });
    expect(res).toEqual({ ok: false, error: "UNKNOWN_ACTION: delete" });
  });
});

describe("il-pod-slack-poster userFunction — validation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns MISSING_FIELDS when pod_ids is not an array", async () => {
    const res = await runAction(makeContext(), "post", { message: "hi" });
    expect(res).toEqual({ ok: false, error: "MISSING_FIELDS" });
  });

  it("returns MISSING_FIELDS when pod_ids is an empty array", async () => {
    const res = await runAction(makeContext(), "post", { pod_ids: [], message: "hi" });
    expect(res).toEqual({ ok: false, error: "MISSING_FIELDS" });
  });

  it("returns MISSING_FIELDS when message is missing", async () => {
    const res = await runAction(makeContext(), "post", { pod_ids: ["leumi"] });
    expect(res).toEqual({ ok: false, error: "MISSING_FIELDS" });
  });

  it("returns MISSING_FIELDS when message is an empty string", async () => {
    const res = await runAction(makeContext(), "post", { pod_ids: ["leumi"], message: "" });
    expect(res).toEqual({ ok: false, error: "MISSING_FIELDS" });
  });
});

describe("il-pod-slack-poster userFunction — secret", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws when slack_bot_token is not configured", async () => {
    await expect(
      runAction(makeContext({ slackToken: undefined }), "post", {
        pod_ids: ["leumi"],
        message: "hi",
      }),
    ).rejects.toThrow(/slack_bot_token secret not configured/);
  });
});

describe("il-pod-slack-poster userFunction — happy path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts to the pod's channel and returns posted+skipped", async () => {
    const recorded = installSlackFetchRouter((req) => {
      if (req.url === "https://slack.com/api/chat.postMessage" && req.method === "POST") {
        return { status: 200, body: { ok: true, ts: "1234.5678" } };
      }
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    const ctx = makeContext({
      pods: [
        {
          id: "leumi",
          data: {
            id: "leumi",
            slack_channel_id: "C001",
            slack_channel_name: "#il-pod-leumi",
          },
        },
      ],
    });
    const res: any = await runAction(ctx, "post", {
      pod_ids: ["leumi"],
      message: "Hello pod",
    });

    expect(res).toEqual({
      ok: true,
      posted: [{ pod_id: "leumi", channel: "C001", ts: "1234.5678" }],
      skipped: [],
    });

    const slackReq = recorded.find((r) => r.url === "https://slack.com/api/chat.postMessage");
    expect(slackReq).toBeDefined();
    expect(slackReq!.headers.Authorization).toBe("Bearer xoxb-fake");
    expect(JSON.parse(slackReq!.body!)).toEqual({ channel: "C001", text: "Hello pod" });
  });

  it("attempts conversations.join for the channel before posting (best-effort self-join)", async () => {
    const recorded = installSlackFetchRouter((req) => {
      if (req.url === "https://slack.com/api/conversations.join" && req.method === "POST") {
        return { status: 200, body: { ok: true } };
      }
      if (req.url === "https://slack.com/api/chat.postMessage" && req.method === "POST") {
        return { status: 200, body: { ok: true, ts: "9.9" } };
      }
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    const ctx = makeContext({
      pods: [{ id: "leumi", data: { id: "leumi", slack_channel_id: "C001", slack_channel_name: "#il-pod-leumi" } }],
    });
    const res: any = await runAction(ctx, "post", { pod_ids: ["leumi"], message: "hi" });

    expect(res.ok).toBe(true);
    expect(res.posted).toEqual([{ pod_id: "leumi", channel: "C001", ts: "9.9" }]);
    const joinReq = recorded.find((r) => r.url === "https://slack.com/api/conversations.join");
    expect(joinReq).toBeDefined();
    expect(JSON.parse(joinReq!.body!)).toEqual({ channel: "C001" });
    // join happens before the post
    expect(recorded.map((r) => r.url)).toEqual([
      "https://slack.com/api/conversations.join",
      "https://slack.com/api/chat.postMessage",
    ]);
  });
});

describe("il-pod-slack-poster userFunction — skip reasons", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skips pod with no slack_channel_id configured (does NOT call Slack)", async () => {
    const recorded = installSlackFetchRouter((req) => {
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    const ctx = makeContext({
      pods: [
        {
          id: "poalim",
          data: { id: "poalim", slack_channel_id: null, slack_channel_name: null },
        },
      ],
    });
    const res = await runAction(ctx, "post", {
      pod_ids: ["poalim"],
      message: "Hello",
    });

    expect(res).toEqual({
      ok: true,
      posted: [],
      skipped: [{ pod_id: "poalim", reason: "no_channel_configured" }],
    });
    expect(recorded.some((r) => r.url === "https://slack.com/api/chat.postMessage")).toBe(false);
  });

  it("skips pod when pod lookup returns no rows (pod_not_found)", async () => {
    installSlackFetchRouter((req) => {
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    // No pods seeded — `tables.filter` returns an empty result set.
    const ctx = makeContext({ pods: [] });
    const res = await runAction(ctx, "post", {
      pod_ids: ["missing"],
      message: "Hello",
    });

    expect(res).toEqual({
      ok: true,
      posted: [],
      skipped: [{ pod_id: "missing", reason: "pod_not_found" }],
    });
  });

  it("skips pod when Slack responds ok:false (slack_error:<code>)", async () => {
    installSlackFetchRouter((req) => {
      if (req.url === "https://slack.com/api/chat.postMessage" && req.method === "POST") {
        return { status: 200, body: { ok: false, error: "channel_not_found" } };
      }
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    const ctx = makeContext({
      pods: [
        {
          id: "leumi",
          data: {
            id: "leumi",
            slack_channel_id: "C001",
            slack_channel_name: "#il-pod-leumi",
          },
        },
      ],
    });
    const res = await runAction(ctx, "post", {
      pod_ids: ["leumi"],
      message: "Hello",
    });

    expect(res).toEqual({
      ok: true,
      posted: [],
      skipped: [{ pod_id: "leumi", reason: "slack_error:channel_not_found" }],
    });
  });
});

describe("il-pod-slack-poster userFunction — multi-pod mixed outcomes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("handles success, no-channel, and slack-error in one call", async () => {
    installSlackFetchRouter((req) => {
      if (req.url === "https://slack.com/api/chat.postMessage" && req.method === "POST") {
        const parsed = JSON.parse(req.body!);
        if (parsed.channel === "C001") return { status: 200, body: { ok: true, ts: "111.222" } };
        if (parsed.channel === "C999") return { status: 200, body: { ok: false, error: "channel_not_found" } };
      }
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    const ctx = makeContext({
      pods: [
        {
          id: "leumi",
          data: { id: "leumi", slack_channel_id: "C001", slack_channel_name: "#il-pod-leumi" },
        },
        {
          id: "orphan",
          data: { id: "orphan", slack_channel_id: null },
        },
        {
          id: "bad",
          data: { id: "bad", slack_channel_id: "C999" },
        },
      ],
    });
    const res: any = await runAction(ctx, "post", {
      pod_ids: ["leumi", "orphan", "bad"],
      message: "Hello pods",
    });

    expect(res.ok).toBe(true);
    expect(res.posted).toHaveLength(1);
    expect(res.posted[0]).toEqual({ pod_id: "leumi", channel: "C001", ts: "111.222" });
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped).toEqual(
      expect.arrayContaining([
        { pod_id: "orphan", reason: "no_channel_configured" },
        { pod_id: "bad", reason: "slack_error:channel_not_found" },
      ]),
    );
  });
});

describe("il-pod-slack-poster userFunction — HTTP errors throw", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws when Slack POST returns HTTP 502", async () => {
    installSlackFetchRouter((req) => {
      if (req.url === "https://slack.com/api/chat.postMessage" && req.method === "POST") {
        return { status: 502, body: "bad gateway" };
      }
      throw new Error("unexpected request: " + req.method + " " + req.url);
    });

    const ctx = makeContext({
      pods: [
        {
          id: "leumi",
          data: { id: "leumi", slack_channel_id: "C001" },
        },
      ],
    });
    await expect(
      runAction(ctx, "post", { pod_ids: ["leumi"], message: "hi" }),
    ).rejects.toThrow(/502/);
  });

  it("propagates errors thrown by context.tables.filter (lookup failure)", async () => {
    // Stub a tables surface where `filter` throws — surrogate for the prior
    // "pod GET returns 500" case (raw fetch is no longer used for the lookup).
    const ctx: any = {
      metadata: { tenantId: "cto-office" },
      secrets: { get: (name: string) => (name === "slack_bot_token" ? { token: "xoxb-fake" } : undefined) },
      tables: {
        // buildVarContext queries these first; return empty so we reach the
        // per-pod filter, which throws.
        query: async () => ({ rows: [], total: 0 }),
        filter: async () => {
          throw new Error("pod lookup leumi -> 500: boom");
        },
      },
    };
    await expect(
      runAction(ctx, "post", { pod_ids: ["leumi"], message: "hi" }),
    ).rejects.toThrow(/500/);
  });
});
