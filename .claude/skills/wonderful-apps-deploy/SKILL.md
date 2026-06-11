---
name: wonderful-apps-deploy
description: Reference for building, shipping, and running Wonderful Apps end-to-end — deploying app bundles via `/api/v2/apps`, provisioning custom tables (`/api/v1/custom-tables`), registering regular and cron functions (`/api/v1/wonderful-functions` and `/api/v1/wonderful-cron-functions`), invoking them from inside the WASM/SpiderMonkey sandbox, fetching communications and recordings (`/api/v1/communications`), wiring tenant secrets (`/api/v1/secrets`), and calling tenant APIs from the React app via `@wonderful/app-sdk`. Use when scaffolding a Wonderful app, writing function `code` blobs, debugging 500s on the apps/functions/tables endpoints, designing a cron-driven worker, minting external share links via asset-session tokens, or wrapping platform flows in a CLI.
---

# Wonderful Apps + Platform Skill

This skill consolidates everything I've learned operating Wonderful Apps on tenant clusters: deployment, the on-platform data layer (custom tables), the on-platform compute layer (regular + cron functions, their WASM runtime), the communications/recordings surface, secrets, and the React `@wonderful/app-sdk`. Each topic has its own reference file with the authoritative details — **read the relevant one before generating code**.

## When to use

Invoke this skill when the prompt or the code I'm editing involves any of:

- Building a new Wonderful App (Vite + React + `@wonderful/app-sdk`) and shipping it.
- Provisioning or migrating custom tables in a tenant.
- Writing `code` strings for `/api/v1/wonderful-functions` or `/api/v1/wonderful-cron-functions`.
- Calling `/api/v1/communications` or working with recording URLs / transcript DTOs.
- Wiring `/api/v1/secrets` for runtime auth.
- Reading/writing data from the React app via `useWonderful()`.
- Debugging 500s, "function not found", `require is not defined`, duplicate-key errors, or "filter is ignored" issues on any of the above.

## Hard rules (the most expensive lessons)

These are non-obvious traps that cost real time. Always assume they're true.

1. **`PUT /api/v1/wonderful-functions/{id}` and the cron equivalent SILENTLY DROP `code`.** To change function code, `DELETE` then `POST` a fresh function. Use a `FORCE_UPDATE=1` style flag on your provisioner.
2. **The first column of a custom table is auto-promoted to PRIMARY KEY**, regardless of any `primary_key: true` field. Always put an explicit `id` column first and populate it with `crypto.randomUUID()` in your function code.
3. **The HTTP `GET /rows?filters=…` query param only honors a magic `text` full-text filter.** Column-level filters are silently dropped. Use `context.tables.filter()` from inside a function, or fetch all rows and filter client-side.
4. **`context.functions.dispatch({slug})` only resolves CRON FUNCTIONS, never regular functions.** If a function needs to be dispatched from inside another function, register it as a cron function (use `cron_schedules: []` if it shouldn't auto-fire).
5. **The function `code` sandbox doesn't support ES module imports.** `import x from "y"` gets transpiled to `require()` which is undefined in SpiderMonkey. Declare `async function userFunction(context): Promise<...>` at the top level and put helpers as inline declarations. No `npm` packages.
6. **`/api/v1/communications` listing REQUIRES a `filters=` query param** (a JSON object). Pagination is `page` + `limit`, not `page_size`.
7. **Recording URLs return `Content-Type: application/octet-stream`** from S3. Detect MIME from URL extension + magic bytes; default to `audio/mpeg`. Never pass the raw response header through to Gemini.
8. **App bundle upload via `/api/v2/apps`** works programmatically. The sandbox AGENTS.md warns "manual upload" but the API path (init → presigned PUT → complete → activate) is the same one the UI uses.
9. **Wonderful UI app contract:** `dist/app.js` (default-exported React component) + optional `dist/style.css` + `manifest.json`. Externalize `react`, `react-dom`, `react/jsx-runtime`, `@wonderful/app-sdk`, `@wonderful/ui-base` in Vite.
10. **`useWonderful().api` identity changes every render.** Wrap in a `useRef` before using it inside `useEffect` deps, or you'll loop infinitely.
11. **Tables and functions don't auto-appear under an app in the platform UI.** They're tenant-scoped resources, registered separately. To make them show up as "this app's resources," explicitly attach them via `POST /api/v2/apps/{id}/resources` after deployment (`resource_type ∈ {table, function}`). Tables are referenced by NAME, regular functions by UUID. **Cron functions are NOT supported** by this endpoint — the resolver only checks the regular-functions table and returns `app resource target not found` for cron UUIDs. Always include resource attachment in the deploy script; otherwise the platform UI shows the app with zero linked resources even though the worker is fully functional.
12. **The custom-tables `/rows` endpoint silently caps `page_size` at 10**, regardless of the value you pass. Paginate (and ideally fire pages 2..N in parallel) when fetching anything older than the 10 most-recent rows. Same trap exists on the functions and cron-functions listing endpoints.

## Map of reference files

Each is standalone — read just the one relevant to the current task.

| File | When to read |
|---|---|
| [`REFERENCE.md`](REFERENCE.md) | Deploying app bundles — apps API endpoints, presigned upload flow, asset sessions, external share links, permissions, end-to-end deploy shell script. |
| [`REFERENCE-custom-tables.md`](REFERENCE-custom-tables.md) | Custom tables: column types, primary-key auto-promotion, HTTP filter limitation, semantic search, aggregations, atomic increments. |
| [`REFERENCE-functions.md`](REFERENCE-functions.md) | Regular and cron functions: registration body, runtime sandbox constraints, context API surface (kv/secrets/tables/email/functions), dispatch semantics, runs/observability, recommended UI ↔ worker split. |
| [`REFERENCE-communications.md`](REFERENCE-communications.md) | Communications endpoints, DTO shape, required filter param, recording URL families, MIME detection helper, transcript-normalization helper. |
| [`REFERENCE-secrets.md`](REFERENCE-secrets.md) | Secrets manager endpoints, common secret-type UUIDs, value shapes (`{token}` etc.), upsert pattern, `fetch({secretName})` host-mediated injection. |
| [`REFERENCE-app-sdk.md`](REFERENCE-app-sdk.md) | React app side: `useWonderful()`, path rules, talking to tables/functions/crons, Shadow-DOM CSS rules, platform design tokens, npm.wonderful.ai-free build via type shims. |

## Recommended app architecture

```
┌────────────────────────────────────────────────────┐
│  React app (deployed via /api/v2/apps)             │
│    useWonderful() → api.get/post/put/del           │
│    ↑ Shadow DOM, design tokens, ref-stable api     │
└──────────────┬─────────────────────────────────────┘
               │ POST functions/{slug}   (regular fn → HTTP)
               ▼
┌────────────────────────────────────────────────────┐
│  Regular function "start-X"                        │
│    Thin HTTP shell                                 │
│    Reads body params, calls                        │
│    context.functions.dispatch({slug:"do-X-work"})  │
│    Returns { run_id } immediately                  │
└──────────────┬─────────────────────────────────────┘
               │ dispatch                  (cron fn slug)
               ▼
┌────────────────────────────────────────────────────┐
│  Cron function "do-X-work"                         │
│    Empty cron_schedules                            │
│    The long-running worker — Gemini/external API,  │
│    table writes, alerts                            │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Cron function "periodic-X" (real schedule)        │
│    Picks targets, dispatches workers in parallel   │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Custom tables                                     │
│    id (PK, UUID) + foreign-keys + data columns     │
│    Read by app via api.get; column-filter only     │
│    works inside functions (context.tables.filter)  │
└────────────────────────────────────────────────────┘
```

The split exists because regular functions are HTTP-callable but not dispatchable; cron functions are dispatchable but not HTTP-callable by path. You need both: a regular function for the UI manual-trigger entry point, a cron function with empty `cron_schedules` for the dispatchable worker.

## Provisioning skeleton (works for tables + functions + crons)

```js
// scripts/provision.mjs — outline
const TABLES = [/* { name, description, columns: [{name:"id", ...}, ...] } */];
const FUNCTIONS = [/* { file, payload: { name, method, path_slug, param_mapping, timeout_ms, is_enabled } } */];
const CRON_FUNCTIONS = [/* { file, payload: { name, slug, cron_schedules, param_mapping, timeout_ms, is_enabled } } */];

function buildCode(filename) {
  // Concatenate: TABLE_* consts + functions/_shared.ts + functions/{filename}
  // NO ES module imports anywhere in the bundle.
}

async function provisionTables() {
  for (const t of TABLES) {
    try { await api("GET", `/api/v1/custom-tables/${t.name}`); }
    catch (e) {
      if (e.status === 404 || e.status === 500) await api("POST", "/api/v1/custom-tables", t);
      else throw e;
    }
  }
}

async function provisionFunctions() {
  const existing = await api("GET", "/api/v1/wonderful-functions");
  const bySlug = new Map((existing.data ?? []).map(f => [f.path_slug, f]));
  for (const f of FUNCTIONS) {
    const code = buildCode(f.file);
    const prev = bySlug.get(f.payload.path_slug);
    if (!prev) {
      await api("POST", "/api/v1/wonderful-functions", { ...f.payload, code });
    } else if (FORCE_UPDATE) {
      await api("DELETE", `/api/v1/wonderful-functions/${prev.id}`);
      await api("POST",   "/api/v1/wonderful-functions", { ...f.payload, code });
    }
  }
}
// Same shape for cron functions.
```

## Diagnostic playbook

Symptom → first thing to check:

| Symptom | Investigate |
|---|---|
| `POST /api/v1/functions/{slug}` → 500 | `GET /api/v1/wonderful-functions/{fn_id}/runs` for the real error message. |
| Cron run status="error" | `GET /api/v1/wonderful-cron-functions/{fn_id}/runs` for the real error message. |
| `ReferenceError: require is not defined` | Your `code` blob has an `import` statement. Remove all `import`s. |
| `duplicate key value violates unique constraint` on inserts | First column of your custom table is being treated as PK. Add an explicit `id` column at position 0. |
| HTTP filter `filters=[{...}]` returns all rows anyway | The HTTP /rows endpoint ignores column filters. Filter client-side or via an in-function helper. |
| Code change didn't take effect after PUT | The `code` field is silently dropped on PUT. Use DELETE + POST. |
| `Unsupported MIME type: application/octet-stream` from Gemini | S3 returned a generic content-type. Detect MIME from URL/magic bytes; default to `audio/mpeg`. |
| `function not found: my-slug` from `context.functions.dispatch` | The target must be a cron function (not regular). Register it under `/api/v1/wonderful-cron-functions`. |
| Listing `/api/v1/communications` returns 500 | `filters=` is required. Pass at least `?filters=%7B%7D`. |
| App bundle uploads but `/apps/<slug>` shows blank | Zip must contain `app.js` at the root (no subdirectory). Manifest must reference it. |

## Quick checklist before going live

- [ ] First column on every custom table is an `id` (string, required).
- [ ] Function code blobs have no `import`, no `require`, no `export`.
- [ ] Every cron function schedule entry has `enabled: true` (it defaults to `false` if omitted).
- [ ] Tenant secrets created: external API keys + (if calling back to controller from inside) `WONDERFUL_BASE_URL` + `WONDERFUL_API_KEY`.
- [ ] App bundle: `dist/app.js` is the entry point (no subdirectory); `style.css` is at root if you ship CSS.
- [ ] React app uses `useStableApi`-style ref pattern; no `useEffect` deps include the raw `api`.
- [ ] Filter logic moved client-side OR into a function that uses `context.tables.filter()`.
