import { describe, it, expect, vi, afterEach } from "vitest";
import { buildJwt, snowflakeQuery, userFunction, diffConfig, isNoisyField, applyDerivedFields } from "./il-agent-configs-sync";

describe("diffConfig / isNoisyField", () => {
  it("excludes noisy/internal fields", () => {
    expect(isNoisyField("AGENT_ID")).toBe(true);
    expect(isNoisyField("UPDATED_AT")).toBe(true);
    expect(isNoisyField("CREATED_BY")).toBe(true);
    expect(isNoisyField("CONFIGURATION_VERSION")).toBe(true);
    expect(isNoisyField("LLM_MODEL")).toBe(false);
    expect(isNoisyField("TRANSCRIBER_PRIMARY_PROVIDER")).toBe(false);
  });

  it("returns only changed non-noisy fields with old/new values", () => {
    const prev = { LLM_MODEL: "gpt-4o", STT_PROVIDER: "deepgram", UPDATED_AT: "1", TTS: { a: 1 } };
    const next = { LLM_MODEL: "gpt-4o-mini", STT_PROVIDER: "deepgram", UPDATED_AT: "2", TTS: { a: 2 } };
    const d = diffConfig(prev, next).sort((a, b) => a.field_path.localeCompare(b.field_path));
    expect(d).toEqual([
      { field_path: "LLM_MODEL", old_value: "gpt-4o", new_value: "gpt-4o-mini" },
      { field_path: "TTS", old_value: '{"a":1}', new_value: '{"a":2}' },
    ]);
  });
});

describe("applyDerivedFields — voice/TTS fallback", () => {
  it("flags a fallback from a backup endpoint's selected provider voice", () => {
    const cfg: any = {
      VOICE_CONFIGURATION: {
        backup_endpoints: [
          { provider: "elevenlabs", elevenlabs: { voice_id: "abc" }, deepdub: { voice_id: "" } },
        ],
      },
    };
    applyDerivedFields(cfg);
    expect(cfg.TTS_FALLBACK).toBe(true);
    expect(cfg.FALLBACK_VOICE).toBe(true);
    expect(cfg.BACKUP_VOICE).toBe(true);
    expect(cfg.TTS_FALLBACK_DETAIL).toContain("elevenlabs");
  });

  it("returns false when every backup endpoint provider voice is an empty template", () => {
    const cfg: any = {
      VOICE_CONFIGURATION: {
        backup_endpoints: [{ provider: "deepdub", deepdub: { voice_id: "" }, elevenlabs: { voice_id: "" } }],
      },
    };
    applyDerivedFields(cfg);
    expect(cfg.TTS_FALLBACK).toBe(false);
    expect(cfg.TTS_FALLBACK_DETAIL).toBe("");
  });

  it("returns false when VOICE_CONFIGURATION is absent", () => {
    const cfg: any = {};
    applyDerivedFields(cfg);
    expect(cfg.TTS_FALLBACK).toBe(false);
  });

  it("never overwrites an existing key", () => {
    const cfg: any = { TTS_FALLBACK: "preexisting", VOICE_CONFIGURATION: { backup_endpoints: [] } };
    applyDerivedFields(cfg);
    expect(cfg.TTS_FALLBACK).toBe("preexisting");
  });
});

describe("applyDerivedFields — STT and LLM backups", () => {
  it("flags STT backup only when a provider block is enabled with a model", () => {
    const cfg: any = {
      TRANSCRIBER_CONFIGURATION: { backups: [{ aws: { enabled: true, model: "" }, deepgram: { enabled: true, model: "nova-3" } }] },
    };
    applyDerivedFields(cfg);
    expect(cfg.STT_BACKUP).toBe(true);
    expect(cfg.STT_FALLBACK).toBe(true);
    expect(cfg.STT_BACKUP_DETAIL).toContain("deepgram");
  });

  it("STT backup false when all blocks are disabled or modelless", () => {
    const cfg: any = {
      TRANSCRIBER_CONFIGURATION: { backups: [{ aws: { enabled: false, model: "x" }, deepgram: { enabled: true, model: "" } }] },
    };
    applyDerivedFields(cfg);
    expect(cfg.STT_BACKUP).toBe(false);
    expect(cfg.STT_BACKUP_DETAIL).toBe("");
  });

  it("flags LLM backup from backup_endpoints model + provider", () => {
    const cfg: any = {
      LLM_CONFIGURATION: { backup_endpoints: [{ model: "eu-gpt-realtime-1.5", selected_provider: "azure" }] },
    };
    applyDerivedFields(cfg);
    expect(cfg.LLM_BACKUP).toBe(true);
    expect(cfg.BACKUP_MODEL).toBe(true);
    expect(cfg.LLM_BACKUP_DETAIL).toBe("azure eu-gpt-realtime-1.5");
  });

  it("LLM backup false when backup_endpoints is empty", () => {
    const cfg: any = { LLM_CONFIGURATION: { backup_endpoints: [] } };
    applyDerivedFields(cfg);
    expect(cfg.LLM_BACKUP).toBe(false);
  });
});

describe("isNoisyField — derived keys excluded from diff", () => {
  it("treats derived keys (and their _DETAIL) as noisy, real config keys as not", () => {
    expect(isNoisyField("TTS_FALLBACK")).toBe(true);
    expect(isNoisyField("TTS_FALLBACK_DETAIL")).toBe(true);
    expect(isNoisyField("STT_BACKUP")).toBe(true);
    expect(isNoisyField("LLM_BACKUP")).toBe(true);
    expect(isNoisyField("VOICE_CONFIGURATION")).toBe(false);
  });
});

const AUTH = {
  host: "acct.snowflakecomputing.com",
  account: "iv28749",
  user: "cto_office_israel_site",
  role: "R",
  warehouse: "W",
  private_key_pem: globalThis.__TEST_PEM__,
  public_key_fp: "SHA256:testfp",
};

afterEach(() => vi.unstubAllGlobals());

describe("buildJwt", () => {
  it("produces a 3-part JWT with UPPERCASE iss/sub and the fingerprint", async () => {
    const jwt = await buildJwt(AUTH);
    expect(jwt.split(".")).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.sub).toBe("IV28749.CTO_OFFICE_ISRAEL_SITE");
    expect(payload.iss).toBe("IV28749.CTO_OFFICE_ISRAEL_SITE.SHA256:testfp");
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});

describe("snowflakeQuery", () => {
  it("POSTs KEYPAIR_JWT with a User-Agent and unwraps rowType+data into objects", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://acct.snowflakecomputing.com/api/v2/statements");
      expect(init.headers["X-Snowflake-Authorization-Token-Type"]).toBe("KEYPAIR_JWT");
      expect(init.headers["User-Agent"]).toBeTruthy();
      expect(JSON.parse(init.body).statement).toBe("SELECT 1");
      return new Response(JSON.stringify({
        resultSetMetaData: { rowType: [{ name: "A" }, { name: "B" }] },
        data: [["1", "x"], ["2", "y"]],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rows = await snowflakeQuery(AUTH, "SELECT 1");
    expect(rows).toEqual([{ A: "1", B: "x" }, { A: "2", B: "y" }]);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(snowflakeQuery(AUTH, "SELECT 1")).rejects.toThrow(/Snowflake 401/);
  });

  it("concatenates all partitions when partitionInfo has multiple entries", async () => {
    const capturedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrls.push(String(url));
      // POST — initial statement execution, returns partition 0 inline
      if (!init?.method || init.method === "POST") {
        return new Response(
          JSON.stringify({
            resultSetMetaData: {
              rowType: [{ name: "A" }],
              partitionInfo: [{ rowCount: 1 }, { rowCount: 2 }],
            },
            statementHandle: "H1",
            data: [["p0r0"]],
          }),
          { status: 200 },
        );
      }
      // GET — partition fetch
      return new Response(
        JSON.stringify({ data: [["p1r0"], ["p1r1"]] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await snowflakeQuery(AUTH, "SELECT A FROM T");

    expect(rows).toEqual([{ A: "p0r0" }, { A: "p1r0" }, { A: "p1r1" }]);

    // Exactly one GET must have been made for partition 1
    const getUrls = capturedUrls.filter((u) => u.includes("?partition="));
    expect(getUrls).toHaveLength(1);
    expect(getUrls[0]).toContain("H1");
    expect(getUrls[0]).toContain("partition=1");
  });
});

// ---------------------------------------------------------------------------
// Tables stub (mirrors the pattern in il-agent-configs-data.test.ts)
// ---------------------------------------------------------------------------

type TableRow = { id: string; data: Record<string, unknown> };
type TableFilter = { column: string; operator: string; value: unknown };

type SyncStores = {
  pod_agents?: TableRow[];
  il_agent_snapshot?: TableRow[];
  il_agent_metrics?: TableRow[];
  pod_agents_baseline?: TableRow[];
};

// Map each table to its PRIMARY KEY column — the SDK derives row.id from this.
const PK_BY_TABLE: Record<string, string> = {
  pod_agents: "id",
  il_agent_snapshot: "agent_id",
  il_agent_metrics: "agent_id",
  pod_agents_baseline: "use_case",
  pod_agent_config_changes: "id",
};

function makeSyncTablesStub(initial: SyncStores = {}) {
  const stores: Record<string, TableRow[]> = {
    pod_agents: initial.pod_agents ?? [],
    il_agent_snapshot: initial.il_agent_snapshot ?? [],
    il_agent_metrics: initial.il_agent_metrics ?? [],
    pod_agents_baseline: initial.pod_agents_baseline ?? [],
  };

  function getStore(table: string): TableRow[] {
    if (!(table in stores)) {
      // Return empty for tables we don't care about in these tests
      stores[table] = [];
    }
    return stores[table];
  }

  return {
    stores,
    tables: {
      query: async (table: string, limit: number, offset: number) => {
        const rows = getStore(table);
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      },
      filter: async (table: string, filters: TableFilter[], limit: number, offset: number) => {
        let rows = getStore(table);
        for (const f of filters) {
          if (f.operator === "eq") {
            rows = rows.filter((r) => {
              const fromData = r.data ? (r.data as Record<string, unknown>)[f.column] : undefined;
              const fromRow = (r as unknown as Record<string, unknown>)[f.column];
              const v = fromData !== undefined ? fromData : fromRow;
              return v === f.value;
            });
          }
        }
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      },
      insert: async (table: string, data: Record<string, unknown>) => {
        const store = getStore(table);
        const pk = PK_BY_TABLE[table] ?? "id";
        const id = String(data[pk] ?? `row_${store.length + 1}`);
        store.push({ id, data });
        return data;
      },
      update: async (table: string, rowId: string, patch: Record<string, unknown>) => {
        const store = getStore(table);
        const row = store.find((r) => r.id === rowId);
        if (row) row.data = { ...row.data, ...patch };
        return row;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// sync action tests
// ---------------------------------------------------------------------------

describe("sync action", () => {
  it("sync upserts il_agent_snapshot from AGENT_METADATA OBJECT_CONSTRUCT", async () => {
    const stub = makeSyncTablesStub({
      pod_agents: [
        {
          id: "pa1",
          data: {
            id: "pa1",
            pod_id: "leumi",
            agent_use_case: "Observer",
            platform_agent_id: "AG-1",
          },
        },
      ],
      il_agent_snapshot: [],
    });

    const snowflakeRow = {
      AGENT_ID: "AG-1",
      AGENT_NAME: "obs",
      TENANT_ID: "t1",
      TENANT_DISPLAY_NAME: "Leumi",
      MODE: "active",
      LOCALE: "he-IL",
      LLM_SELECTED_PROVIDER: "azure",
      VOICE_CONFIGURATION: { backup_endpoints: [{ provider: "elevenlabs", elevenlabs: { voice_id: "abc" } }] },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          const stmt = JSON.parse(init.body as string).statement;
          if (stmt.includes("HAVING COUNT")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "AGENT_ID" }] },
                data: [["AG-1"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("AGENT_METADATA")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "ROW_JSON" }] },
                data: [[JSON.stringify(snowflakeRow)]],
              }),
              { status: 200 },
            );
          }
          // fallback (e.g. metrics query in future tasks)
          return new Response(
            JSON.stringify({ resultSetMetaData: { rowType: [] }, data: [] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const ctx: any = {
      data: { action: "sync" },
      metadata: { tenantId: "cto-office" },
      secrets: {
        get: (name: string) => {
          if (name === "SNOWFLAKE_AUTH") {
            return {
              host: "acct.snowflakecomputing.com",
              account: "IV28749",
              user: "CTO_OFFICE_ISRAEL_SITE",
              role: "R",
              warehouse: "W",
              private_key_pem: globalThis.__TEST_PEM__,
              public_key_fp: "SHA256:x",
            };
          }
          return undefined;
        },
      },
      tables: stub.tables,
    };

    const res: any = await userFunction(ctx);

    expect(res.ok).toBe(true);
    expect(res.synced_snapshots).toBe(1);

    // Verify the row was inserted into il_agent_snapshot
    const snapRows = stub.stores.il_agent_snapshot;
    expect(snapRows).toHaveLength(1);
    const snap = snapRows[0].data;
    expect(snap.agent_id).toBe("AG-1");
    expect(snap.agent_name).toBe("obs");
    const cfg = JSON.parse(snap.config_json as string);
    expect(cfg.LLM_SELECTED_PROVIDER).toBe("azure");
    expect(cfg.TTS_FALLBACK).toBe(true);
    expect(cfg.TTS_FALLBACK_DETAIL).toContain("elevenlabs");
  });

  it("returns ok:true with zero counts when discovery finds no active agents", async () => {
    const stub = makeSyncTablesStub({});

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes("snowflakecomputing.com")) {
        const stmt = JSON.parse(init.body as string).statement;
        if (stmt.includes("HAVING COUNT")) {
          // Discovery finds no active agents → empty result set.
          return new Response(
            JSON.stringify({
              resultSetMetaData: { rowType: [{ name: "AGENT_ID" }] },
              data: [],
            }),
            { status: 200 },
          );
        }
        // fallback
        return new Response(
          JSON.stringify({ resultSetMetaData: { rowType: [] }, data: [] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctx: any = {
      data: { action: "sync" },
      metadata: { tenantId: "cto-office" },
      secrets: {
        get: (name: string) =>
          name === "SNOWFLAKE_AUTH"
            ? {
                host: "acct.snowflakecomputing.com",
                account: "IV28749",
                user: "U",
                role: "R",
                warehouse: "W",
                private_key_pem: globalThis.__TEST_PEM__,
                public_key_fp: "SHA256:x",
              }
            : undefined,
      },
      tables: stub.tables,
    };

    const res: any = await userFunction(ctx);
    expect(res.ok).toBe(true);
    expect(res.active_agents).toBe(0);
    expect(res.synced_snapshots).toBe(0);
    expect(res.synced_metrics).toBe(0);
    // Nothing written downstream when discovery is empty.
    expect(stub.stores.il_agent_snapshot).toHaveLength(0);
    expect(stub.stores.il_agent_metrics).toHaveLength(0);
  });

  it("returns MISSING_SNOWFLAKE_AUTH when secret is absent", async () => {
    const stub = makeSyncTablesStub({});
    const ctx: any = {
      data: { action: "sync" },
      metadata: { tenantId: "cto-office" },
      secrets: { get: () => undefined },
      tables: stub.tables,
    };
    const res = await userFunction(ctx);
    expect(res).toEqual({ ok: false, error: "MISSING_SNOWFLAKE_AUTH" });
  });

  it("sync upserts il_agent_metrics from COMMUNICATION + ISSUES", async () => {
    const stub = makeSyncTablesStub({
      pod_agents: [
        {
          id: "pa1",
          data: {
            id: "pa1",
            pod_id: "leumi",
            agent_use_case: "Observer",
            platform_agent_id: "AG-1",
          },
        },
      ],
      il_agent_snapshot: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          const stmt = JSON.parse(init.body as string).statement;
          if (stmt.includes("HAVING COUNT")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "AGENT_ID" }] },
                data: [["AG-1"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("AGENT_METADATA")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "ROW_JSON" }] },
                data: [[JSON.stringify({ AGENT_ID: "AG-1", AGENT_NAME: "obs" })]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("COMMUNICATION")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: {
                  rowType: [
                    { name: "AGENT_ID" },
                    { name: "CALLS_24H" },
                    { name: "WEEK_AVG" },
                    { name: "LAST_CALL_AT" },
                  ],
                },
                data: [["AG-1", "412", "318.0", "2026-05-31T10:00:00Z"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("ISSUES")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: {
                  rowType: [{ name: "AGENT_ID" }, { name: "OPEN_ISSUES" }],
                },
                data: [["AG-1", "7"]],
              }),
              { status: 200 },
            );
          }
          // fallback
          return new Response(
            JSON.stringify({ resultSetMetaData: { rowType: [] }, data: [] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const ctx: any = {
      data: { action: "sync" },
      metadata: { tenantId: "cto-office" },
      secrets: {
        get: (name: string) => {
          if (name === "SNOWFLAKE_AUTH") {
            return {
              host: "acct.snowflakecomputing.com",
              account: "IV28749",
              user: "CTO_OFFICE_ISRAEL_SITE",
              role: "R",
              warehouse: "W",
              private_key_pem: globalThis.__TEST_PEM__,
              public_key_fp: "SHA256:x",
            };
          }
          return undefined;
        },
      },
      tables: stub.tables,
    };

    const res: any = await userFunction(ctx);

    expect(res.ok).toBe(true);
    expect(res.synced_metrics).toBe(1);

    const metricsRows = stub.stores.il_agent_metrics;
    expect(metricsRows).toHaveLength(1);
    const m = metricsRows[0].data;
    expect(m.agent_id).toBe("AG-1");
    expect(m.conversations_24h).toBe(412);
    expect(m.conversations_week_avg).toBe(318);
    expect(m.open_issues).toBe(7);
    expect(m.last_call_at).toBe("2026-05-31T10:00:00Z");
  });

  it("syncMetrics zero-fills absent agents for asymmetric COMMUNICATION/ISSUES results", async () => {
    const stub = makeSyncTablesStub({
      pod_agents: [
        {
          id: "pa1",
          data: {
            id: "pa1",
            pod_id: "leumi",
            agent_use_case: "Observer",
            platform_agent_id: "AG-1",
          },
        },
        {
          id: "pa2",
          data: {
            id: "pa2",
            pod_id: "leumi",
            agent_use_case: "Responder",
            platform_agent_id: "AG-2",
          },
        },
      ],
      il_agent_snapshot: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          const stmt = JSON.parse(init.body as string).statement;
          if (stmt.includes("HAVING COUNT")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "AGENT_ID" }] },
                data: [["AG-1"], ["AG-2"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("AGENT_METADATA")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "ROW_JSON" }] },
                data: [
                  [JSON.stringify({ AGENT_ID: "AG-1", AGENT_NAME: "agent-one" })],
                  [JSON.stringify({ AGENT_ID: "AG-2", AGENT_NAME: "agent-two" })],
                ],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("COMMUNICATION")) {
            // Only AG-1 appears in COMMUNICATION results
            return new Response(
              JSON.stringify({
                resultSetMetaData: {
                  rowType: [
                    { name: "AGENT_ID" },
                    { name: "CALLS_24H" },
                    { name: "WEEK_AVG" },
                    { name: "LAST_CALL_AT" },
                  ],
                },
                data: [["AG-1", "5", "2.0", "2026-05-30T00:00:00Z"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("ISSUES")) {
            // Only AG-2 appears in ISSUES results
            return new Response(
              JSON.stringify({
                resultSetMetaData: {
                  rowType: [{ name: "AGENT_ID" }, { name: "OPEN_ISSUES" }],
                },
                data: [["AG-2", "3"]],
              }),
              { status: 200 },
            );
          }
          // fallback
          return new Response(
            JSON.stringify({ resultSetMetaData: { rowType: [] }, data: [] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const ctx: any = {
      data: { action: "sync" },
      metadata: { tenantId: "cto-office" },
      secrets: {
        get: (name: string) => {
          if (name === "SNOWFLAKE_AUTH") {
            return {
              host: "acct.snowflakecomputing.com",
              account: "IV28749",
              user: "CTO_OFFICE_ISRAEL_SITE",
              role: "R",
              warehouse: "W",
              private_key_pem: globalThis.__TEST_PEM__,
              public_key_fp: "SHA256:x",
            };
          }
          return undefined;
        },
      },
      tables: stub.tables,
    };

    const res: any = await userFunction(ctx);

    expect(res.ok).toBe(true);
    expect(res.synced_metrics).toBe(2);

    const metricsRows = stub.stores.il_agent_metrics!;
    expect(metricsRows).toHaveLength(2);

    const ag1 = metricsRows.find((r) => r.data.agent_id === "AG-1")?.data;
    expect(ag1).toBeDefined();
    expect(ag1!.conversations_24h).toBe(5);
    expect(ag1!.conversations_week_avg).toBe(2);
    expect(ag1!.open_issues).toBe(0);
    expect(ag1!.last_call_at).toBe("2026-05-30T00:00:00Z");

    const ag2 = metricsRows.find((r) => r.data.agent_id === "AG-2")?.data;
    expect(ag2).toBeDefined();
    expect(ag2!.conversations_24h).toBe(0);
    expect(ag2!.conversations_week_avg).toBe(0);
    expect(ag2!.open_issues).toBe(3);
    expect(ag2!.last_call_at).toBe(null);
  });

});

// ---------------------------------------------------------------------------
// reconcile_mappings action tests
// ---------------------------------------------------------------------------

describe("reconcile_mappings", () => {
  it("auto-fills unambiguous match and flags ties without writing them", async () => {
    const stub = makeSyncTablesStub({
      pod_agents: [
        {
          id: "pa1",
          data: { id: "pa1", pod_id: "leumi", agent_use_case: "Q&A General Knowledge – Chat Agent" },
        },
        {
          id: "pa2",
          data: { id: "pa2", pod_id: "discount", agent_use_case: "Adi Private + Personal" },
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          return new Response(
            JSON.stringify({
              resultSetMetaData: {
                rowType: [
                  { name: "AGENT_ID" },
                  { name: "AGENT_NAME" },
                  { name: "AGENT_DISPLAY_NAME" },
                  { name: "TENANT_DISPLAY_NAME" },
                ],
              },
              data: [
                ["AG-QA", "qa_general_knowledge_chat", "Q&A General Knowledge", "Leumi"],
                ["AG-ADI-1", "adi_private", "Adi Private + Personal", "Discount"],
                ["AG-ADI-2", "adi_private_dynamic", "Adi Private + Personal", "wonderful"],
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const ctx: any = {
      data: { action: "reconcile_mappings" },
      metadata: { tenantId: "cto-office" },
      secrets: {
        get: (name: string) =>
          name === "SNOWFLAKE_AUTH"
            ? {
                host: "acct.snowflakecomputing.com",
                account: "IV28749",
                user: "CTO_OFFICE_ISRAEL_SITE",
                role: "R",
                warehouse: "W",
                private_key_pem: globalThis.__TEST_PEM__,
                public_key_fp: "SHA256:x",
              }
            : undefined,
      },
      tables: stub.tables,
    };

    const res: any = await userFunction(ctx);

    expect(res.ok).toBe(true);

    // pa1 should be auto-applied (unique match)
    expect(res.applied).toContainEqual({ pod_agent_id: "pa1", platform_agent_id: "AG-QA" });

    // pa2 should be flagged ambiguous with 2 candidates
    const pa2Ambiguous = res.ambiguous.find((a: any) => a.pod_agent_id === "pa2");
    expect(pa2Ambiguous).toBeDefined();
    expect(pa2Ambiguous.candidates.length).toBe(2);

    // pa2 must NOT have been written
    const pa2Row = stub.stores.pod_agents!.find((r) => r.id === "pa2");
    expect((pa2Row!.data as any).platform_agent_id).toBeFalsy();

    // pa1 store row must now have platform_agent_id set
    const pa1Row = stub.stores.pod_agents!.find((r) => r.id === "pa1");
    expect((pa1Row!.data as any).platform_agent_id).toBe("AG-QA");
  });

  it("records unmatched pod_agents that have no candidate and does not write them", async () => {
    const stub = makeSyncTablesStub({
      pod_agents: [
        {
          id: "pa1",
          data: { id: "pa1", pod_id: "leumi", agent_use_case: "Q&A General Knowledge – Chat Agent" },
        },
        {
          id: "pa2",
          data: { id: "pa2", pod_id: "discount", agent_use_case: "Adi Private + Personal" },
        },
        {
          id: "pa3",
          data: { id: "pa3", pod_id: "hapoalim", agent_use_case: "Completely Unknown Use Case XYZ" },
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          return new Response(
            JSON.stringify({
              resultSetMetaData: {
                rowType: [
                  { name: "AGENT_ID" },
                  { name: "AGENT_NAME" },
                  { name: "AGENT_DISPLAY_NAME" },
                  { name: "TENANT_DISPLAY_NAME" },
                ],
              },
              data: [
                ["AG-QA", "qa_general_knowledge_chat", "Q&A General Knowledge", "Leumi"],
                ["AG-ADI-1", "adi_private", "Adi Private + Personal", "Discount"],
                ["AG-ADI-2", "adi_private_dynamic", "Adi Private + Personal", "wonderful"],
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const ctx: any = {
      data: { action: "reconcile_mappings" },
      metadata: { tenantId: "cto-office" },
      secrets: {
        get: (name: string) =>
          name === "SNOWFLAKE_AUTH"
            ? {
                host: "acct.snowflakecomputing.com",
                account: "IV28749",
                user: "CTO_OFFICE_ISRAEL_SITE",
                role: "R",
                warehouse: "W",
                private_key_pem: globalThis.__TEST_PEM__,
                public_key_fp: "SHA256:x",
              }
            : undefined,
      },
      tables: stub.tables,
    };

    const res: any = await userFunction(ctx);

    expect(res.ok).toBe(true);

    // pa1 should still be auto-applied (unique match)
    expect(res.applied).toContainEqual({ pod_agent_id: "pa1", platform_agent_id: "AG-QA" });

    // pa2 should still be flagged ambiguous
    const pa2Ambiguous = res.ambiguous.find((a: any) => a.pod_agent_id === "pa2");
    expect(pa2Ambiguous).toBeDefined();
    expect(pa2Ambiguous.candidates.length).toBe(2);

    // pa3 should appear in unmatched with {pod_agent_id, use_case}
    expect(res.unmatched).toContainEqual({
      pod_agent_id: "pa3",
      use_case: "Completely Unknown Use Case XYZ",
    });

    // pa3 must NOT have been written to pod_agents
    const pa3Row = stub.stores.pod_agents!.find((r) => r.id === "pa3");
    expect((pa3Row!.data as any).platform_agent_id).toBeFalsy();
  });
});

describe("sync action — second sync run", () => {
  it("second sync run UPDATES an existing snapshot in place (no duplicate)", async () => {
    // Start with empty il_agent_snapshot — first sync will INSERT the row.
    // The row must be inserted with id === agent_id so the SECOND sync run can
    // UPDATE it by rowId rather than inserting a duplicate.
    const stub = makeSyncTablesStub({
      il_agent_snapshot: [],
      pod_agents: [
        {
          id: "pa1",
          data: { platform_agent_id: "AG-1", agent_use_case: "Observer", pod_id: "leumi" },
        },
      ],
    });

    function makeFetchMock(agentName: string) {
      return vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          const stmt = JSON.parse(init.body as string).statement;
          if (stmt.includes("HAVING COUNT")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "AGENT_ID" }] },
                data: [["AG-1"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("AGENT_METADATA")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "ROW_JSON" }] },
                data: [[JSON.stringify({ AGENT_ID: "AG-1", AGENT_NAME: agentName })]],
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({ resultSetMetaData: { rowType: [] }, data: [] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      });
    }

    const auth = {
      host: "acct.snowflakecomputing.com",
      account: "IV28749",
      user: "CTO_OFFICE_ISRAEL_SITE",
      role: "R",
      warehouse: "W",
      private_key_pem: globalThis.__TEST_PEM__,
      public_key_fp: "SHA256:x",
    };

    function makeCtx() {
      return {
        data: { action: "sync" },
        metadata: { tenantId: "cto-office" },
        secrets: { get: (name: string) => (name === "SNOWFLAKE_AUTH" ? auth : undefined) },
        tables: stub.tables,
      } as any;
    }

    // First sync run: inserts the row with agent_name "old"
    vi.stubGlobal("fetch", makeFetchMock("old"));
    const res1: any = await userFunction(makeCtx());
    expect(res1.ok).toBe(true);
    expect(stub.stores.il_agent_snapshot).toHaveLength(1);
    // The inserted row's id must equal the agent_id so the next update can find it
    expect(stub.stores.il_agent_snapshot[0].id).toBe("AG-1");

    // Second sync run: must UPDATE the existing row (agent_name → "new"), not insert a new one
    vi.stubGlobal("fetch", makeFetchMock("new"));
    const res2: any = await userFunction(makeCtx());
    expect(res2.ok).toBe(true);

    const snapRows = stub.stores.il_agent_snapshot;
    // Must still be exactly 1 row — no duplicate inserted
    expect(snapRows).toHaveLength(1);
    // The existing row must have been updated with the new agent_name
    expect(snapRows[0].data.agent_name).toBe("new");
  });

  it("stamps changed_at with the agent's real UPDATED_AT (normalized to ISO), not the sync run time", async () => {
    const stub = makeSyncTablesStub({
      il_agent_snapshot: [],
      pod_agents: [
        { id: "pa1", data: { platform_agent_id: "AG-1", agent_use_case: "Observer", pod_id: "leumi" } },
      ],
    });

    function makeFetchMock(cfg: Record<string, unknown>) {
      return vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes("snowflakecomputing.com")) {
          const stmt = JSON.parse(init.body as string).statement;
          if (stmt.includes("HAVING COUNT")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "AGENT_ID" }, { name: "AGENT_NAME" }, { name: "ACTIVITIES" }] },
                data: [["AG-1", "obs", "600"]],
              }),
              { status: 200 },
            );
          }
          if (stmt.includes("AGENT_METADATA")) {
            return new Response(
              JSON.stringify({
                resultSetMetaData: { rowType: [{ name: "ROW_JSON" }] },
                data: [[JSON.stringify(cfg)]],
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ resultSetMetaData: { rowType: [] }, data: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      });
    }

    const auth = {
      host: "acct.snowflakecomputing.com",
      account: "IV28749",
      user: "U",
      role: "R",
      warehouse: "W",
      private_key_pem: globalThis.__TEST_PEM__,
      public_key_fp: "SHA256:x",
    };
    const makeCtx = () =>
      ({
        data: { action: "sync" },
        metadata: { tenantId: "cto-office" },
        secrets: { get: (n: string) => (n === "SNOWFLAKE_AUTH" ? auth : undefined) },
        tables: stub.tables,
      } as any);

    // Baseline snapshot (first run never emits change rows).
    vi.stubGlobal("fetch", makeFetchMock({ AGENT_ID: "AG-1", AGENT_NAME: "obs", LLM_MODEL: "gpt-4o", UPDATED_AT: "2026-06-01 09:00:00.000 Z" }));
    await userFunction(makeCtx());

    // Second run: LLM_MODEL changes; the platform records UPDATED_AT for that edit.
    vi.stubGlobal("fetch", makeFetchMock({ AGENT_ID: "AG-1", AGENT_NAME: "obs", LLM_MODEL: "gpt-4o-mini", UPDATED_AT: "2026-06-03 15:07:11.071 Z" }));
    await userFunction(makeCtx());

    const changes = stub.stores.pod_agent_config_changes ?? [];
    const llm = changes.find((r) => (r.data as any).field_path === "LLM_MODEL");
    expect(llm).toBeDefined();
    // changed_at must reflect WHEN the platform recorded the edit, not the sync run.
    expect((llm!.data as any).changed_at).toBe("2026-06-03T15:07:11.071Z");
  });
});
