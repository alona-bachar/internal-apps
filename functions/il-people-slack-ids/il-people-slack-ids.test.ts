import { afterEach, describe, expect, it, vi } from "vitest";
import { userFunction } from "./il-people-slack-ids";

// The runtime calls `userFunction(context)` with the request body on
// `context.data.{action,payload}`. People reads go through context.tables.query;
// writes through context.tables.update(table, rowId, patch). The Slack lookup
// hits slack.com via raw fetch, which we route.

type PersonRow = { id: string; data: Record<string, unknown> };

function installSlackRouter(byEmail: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
    const url = String(input);
    const m = url.match(/email=([^&]+)/);
    const email = m ? decodeURIComponent(m[1]) : "";
    calls.push(email);
    const out = byEmail[email] ?? { status: 200, body: { ok: false, error: "users_not_found" } };
    return new Response(JSON.stringify(out.body), { status: out.status });
  }) as unknown as typeof globalThis.fetch);
  return calls;
}

// Tracks rows written to the people_slack_ids mapping table. `query` returns the
// `people` rows for "people" and the current mapping rows for "people_slack_ids".
function makeContext(people: PersonRow[], slackToken: string | null = "xoxb-fake", initialMap: Array<Record<string, unknown>> = []) {
  const inserted: Array<Record<string, unknown>> = [...initialMap];
  const ctx = {
    secrets: { get: (n: string) => (n === "slack_bot_token" ? (slackToken ? { token: slackToken } : undefined) : undefined) },
    tables: {
      query: async (table: string) =>
        table === "people"
          ? { rows: people, total: people.length }
          : { rows: inserted.map((d, i) => ({ id: `m${i}`, data: d })), total: inserted.length },
      filter: async (_t: string, filters: Array<{ column: string; value: unknown }>) => {
        const pid = filters.find((f) => f.column === "person_id")?.value;
        const rows = inserted.filter((d) => d.person_id === pid).map((d, i) => ({ id: `m${i}`, data: d }));
        return { rows, total: rows.length };
      },
      insert: async (_t: string, data: Record<string, unknown>) => {
        inserted.push(data);
        return { id: `m${inserted.length}`, data };
      },
      update: async () => ({}),
    },
  } as any;
  return { ctx, inserted };
}

function run(ctx: Record<string, unknown>, action: string | undefined, payload?: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (action !== undefined) data.action = action;
  if (payload !== undefined) data.payload = payload;
  return userFunction({ ...ctx, data });
}

describe("il-people-slack-ids — contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is exported with the runtime-expected name", () => {
    expect(userFunction.name).toBe("userFunction");
  });

  it("returns MISSING_ACTION / UNKNOWN_ACTION", async () => {
    const { ctx } = makeContext([]);
    expect(await userFunction(ctx)).toEqual({ ok: false, error: "MISSING_ACTION" });
    expect(await run(ctx, "nope", {})).toEqual({ ok: false, error: "UNKNOWN_ACTION: nope" });
  });

  it("throws when slack_bot_token is missing", async () => {
    const { ctx } = makeContext([], null);
    await expect(run(ctx, "backfill", {})).rejects.toThrow(/slack_bot_token secret not configured/);
  });
});

describe("il-people-slack-ids — backfill", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves emails to slack ids and writes mapping rows", async () => {
    installSlackRouter({
      "alon.g@wonderful.ai": { status: 200, body: { ok: true, user: { id: "U001" } } },
      "nadav.p@wonderful.ai": { status: 200, body: { ok: true, user: { id: "U002" } } },
    });
    const { ctx, inserted } = makeContext([
      { id: "p1", data: { first_name: "Alon", last_name: "G", email: "alon.g@wonderful.ai", role: "Forward Deployed Engineer" } },
      { id: "p2", data: { first_name: "Nadav", last_name: "P", email: "nadav.p@wonderful.ai", role: "Deployment Strategist" } },
    ]);
    const res: any = await run(ctx, "backfill", {});
    expect(res.ok).toBe(true);
    expect(res.matched).toBe(2);
    expect(inserted).toEqual([
      expect.objectContaining({ person_id: "p1", slack_user_id: "U001", name: "Alon G" }),
      expect.objectContaining({ person_id: "p2", slack_user_id: "U002", name: "Nadav P" }),
    ]);
  });

  it("skips people already in the mapping (idempotent re-run)", async () => {
    const calls = installSlackRouter({});
    const { ctx, inserted } = makeContext(
      [{ id: "p1", data: { first_name: "Alon", email: "alon.g@wonderful.ai" } }],
      "xoxb-fake",
      [{ person_id: "p1", slack_user_id: "U001", name: "Alon G" }],
    );
    const res: any = await run(ctx, "backfill", {});
    expect(res.already_set).toBe(1);
    expect(res.matched).toBe(0);
    expect(inserted).toHaveLength(1); // unchanged
    expect(calls).toHaveLength(0); // no Slack call for already-resolved people
  });

  it("records people with no email and unmatched lookups without writing", async () => {
    installSlackRouter({
      "gone@wonderful.ai": { status: 200, body: { ok: false, error: "users_not_found" } },
    });
    const { ctx, inserted } = makeContext([
      { id: "p1", data: { first_name: "No", last_name: "Email", email: null, role: "FDE" } },
      { id: "p2", data: { first_name: "Gone", last_name: "Person", email: "gone@wonderful.ai" } },
    ]);
    const res: any = await run(ctx, "backfill", {});
    expect(res.matched).toBe(0);
    expect(res.no_email).toBe(1);
    expect(res.unmatched).toEqual(
      expect.arrayContaining([
        { name: "No Email", reason: "no_email" },
        { name: "Gone Person", email: "gone@wonderful.ai", reason: "users_not_found" },
      ]),
    );
    expect(inserted).toHaveLength(0);
  });

  it("stops and reports rate_limited on a Slack 429", async () => {
    installSlackRouter({ "a@wonderful.ai": { status: 429, body: { ok: false, error: "ratelimited" } } });
    const { ctx, inserted } = makeContext([
      { id: "p1", data: { first_name: "A", email: "a@wonderful.ai" } },
    ]);
    const res: any = await run(ctx, "backfill", {});
    expect(res.rate_limited).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it("honors the per-run limit so re-runs converge", async () => {
    installSlackRouter({
      "a@wonderful.ai": { status: 200, body: { ok: true, user: { id: "UA" } } },
      "b@wonderful.ai": { status: 200, body: { ok: true, user: { id: "UB" } } },
    });
    const { ctx, inserted } = makeContext([
      { id: "pa", data: { first_name: "A", email: "a@wonderful.ai" } },
      { id: "pb", data: { first_name: "B", email: "b@wonderful.ai" } },
    ]);
    const res: any = await run(ctx, "backfill", { limit: 1 });
    expect(res.matched).toBe(1);
    expect(inserted).toHaveLength(1);
  });
});
