# Wonderful Functions — Reference

Two flavors of server-side code: **regular** functions (HTTP-accessible) and **cron** functions (scheduled and/or dispatchable by slug).

## Endpoints

### Regular functions (HTTP-callable)

```
GET    /api/v1/wonderful-functions                          list
POST   /api/v1/wonderful-functions                          create   (full body, including `code`)
GET    /api/v1/wonderful-functions/{id}                     get      (code is NOT returned)
GET    /api/v1/wonderful-functions/{id}/runs                run history
GET    /api/v1/wonderful-functions/{id}/runs/{run_id}       single run
PUT    /api/v1/wonderful-functions/{id}                     update   ⚠️ silently drops `code`
DELETE /api/v1/wonderful-functions/{id}                     delete
```

### Cron functions (scheduled + dispatchable by slug)

```
GET    /api/v1/wonderful-cron-functions
POST   /api/v1/wonderful-cron-functions
GET    /api/v1/wonderful-cron-functions/{id}
GET    /api/v1/wonderful-cron-functions/{id}/runs
GET    /api/v1/wonderful-cron-functions/{id}/runs/{run_id}
GET    /api/v1/wonderful-cron-functions/{id}/scheduled-runs
PUT    /api/v1/wonderful-cron-functions/{id}                ⚠️ silently drops `code`
POST   /api/v1/wonderful-cron-functions/{id}/trigger        run immediately (uses last params)
POST   /api/v1/wonderful-cron-functions/{id}/schedule       schedule a one-off run at a future time
DELETE /api/v1/wonderful-cron-functions/{id}
```

### Invoking a regular function as HTTP

```
{method} /api/v1/functions/{path_slug}
```

The function's registered `method` (GET/POST/PUT/...) and `path_slug` define this. Body/query params are parsed against `param_mapping`. Authentication is the same `X-api-key` header.

## **CRITICAL — `code` is only writable on POST**

Both `Update` handlers (regular function and cron function) **explicitly omit** the `code` field from the GORM updates map. Sending `code` in a PUT silently does nothing. To change the code of an existing function:

```sh
DELETE /api/v1/wonderful-functions/{id}
POST   /api/v1/wonderful-functions       (with the new code)
```

(Or the cron equivalent.) The run-history rows survive in their own table; the function and its underlying flow are the only thing recreated. Slugs and path_slugs can be reused after a delete.

Idempotent provisioning pattern: list existing → check if slug exists → if no, POST; if yes and you want to change code, DELETE then POST.

## **CRITICAL — `context.functions.dispatch({slug})` only resolves CRON functions**

The in-function `context.functions.run / dispatch / schedule` API looks up the target by slug **against the cron-functions table only** (`wonderful_cron_functions.GetBySlug`). A regular function's `path_slug` is NOT matched. Result: dispatching `{slug: "my-regular-fn"}` silently fails (or surfaces as `function not found`).

This means: if you want a function dispatchable from inside another function, **register it as a cron function** with an empty `cron_schedules: []`. It won't fire on its own (no schedule), but `context.functions.dispatch` will be able to invoke it.

A typical app has both: a regular function for the UI (callable via HTTP from `useWonderful().api.post("functions/...", body)`) and a cron function for the worker (dispatchable from cron + from the regular function).

## Create-function request shape

### Regular function

```json
{
  "name": "start-detection",
  "description": "Creates a run row and dispatches the worker.",
  "method": "POST",
  "path_slug": "start-detection",
  "param_mapping": {
    "query_params": [],
    "body_params": [
      { "name": "communication_id", "type": "string",  "required": true },
      { "name": "triggered_by",     "type": "string",  "required": false }
    ]
  },
  "timeout_ms": 10000,
  "is_enabled": true,
  "code": "<TS source string>"
}
```

Param `type` ∈ `{string | number | boolean}`. Validated at invocation time.

### Cron function

```json
{
  "name": "sample-and-sweep",
  "slug": "sample-and-sweep",
  "description": "...",
  "cron_schedules": [
    { "cron_expression": "0 * * * *", "enabled": true }
  ],
  "param_mapping": [],
  "timeout_ms": 60000,
  "is_enabled": true,
  "code": "<TS source string>"
}
```

For a cron function that should ONLY be dispatched (never auto-fire): `cron_schedules: []`. The function is still triggerable manually via `POST /trigger` and dispatchable from other functions.

`cron_expression`: standard cron syntax. Common: `0 * * * *` (hourly at :00), `*/15 * * * *` (every 15 min), `0 9 * * 1-5` (weekday mornings 09:00 UTC).

Each schedule entry has its own `enabled` flag. **The default for that field is `false` if you omit it** — schedules with `enabled: false` don't fire. Always set `enabled: true` explicitly when you want the cron active.

## **CRITICAL — `code` runtime constraints**

The function's `code` string is run through `(0, eval)(wrappedCode)` inside a SpiderMonkey-based WASM sandbox (componentize-js / jco). The sandbox does NOT do bundler-level resolution at execution time.

Consequences:

1. **No ES module imports.** A line like `import { foo } from "bar"` will get transpiled to `require("bar")` by the controller's TS step, and the sandbox throws `ReferenceError: require is not defined`.
2. **No `npm` dependencies.** The wrapper `@wonderful/types/langchain` works only in tool/skill projects bundled via `npx wonderful` (which runs esbuild before deploying). For raw `code`-field functions, you can't use it.
3. **Plain JS/TS only.** `crypto`, `fetch`, `console`, `setTimeout`, the `URL` constructor, `btoa`/`atob`, `Promise`, `Map`, `Set`, etc. are available. TS type annotations are stripped before eval.
4. **No filesystem.** Use `context.tables`, `context.kv`, `context.secrets` for state.

The wrapper that runs your code (`wonderful-runner-platform/wonderful-runner/lib/build/universal/universal.js`) does:

```js
const wrappedCode = userCode + `
globalThis.__userFunction =
  typeof userFunction === "function" ? userFunction :
  (typeof globalThis.userFunction === "function" ? globalThis.userFunction : undefined);
globalThis.__main =
  typeof main === "function" ? main :
  (typeof globalThis.main === "function" ? globalThis.main : undefined);
//# sourceURL=usercode.js
`;
(0, eval)(wrappedCode);
const userResult = typeof main === "function"
  ? await main(context, parsedContext.data)
  : await userFunction(context);
```

So your function MUST declare either:

```ts
async function userFunction(context) { /* ... */ return {} }
```

or

```ts
async function main(ctx, params) { /* ... */ return {} }
```

`return` value is JSON-serialized into the function's output. Errors thrown propagate up; the runtime captures them as `{ error: { message: "..." } }`.

When you concatenate helper code (e.g. shared utilities) before the function declaration, that's fine — `eval` accepts a single big script. The runtime just looks for `userFunction` / `main` as a global at the end.

## Context library (`context`)

Always present. Method index:

```ts
context.data       // input params (query + body merged), { [name]: value }
context.metadata   // tenant, user (when applicable), communication (when applicable), agent

context.kv         // session KV (string keys, JSON-serialized values)
  .get(key) / .set(key, value) / .setIfNotExist(key, value)
  .exists(key) / .delete(key) / .deleteIfEqual(key, expectedValue)

context.secrets    // tenant secrets manager (read-only from inside a function)
  .get(name)       // returns the secret value — either a raw string or an object like { token: "..." }

context.globals    // tenant globals
  .get(name)

context.tables     // custom-tables CRUD (column filters work here, unlike the HTTP /rows endpoint)
  .query / .filter / .insert / .update / .deleteRow
  .getRow / .getRows / .count / .distinct
  .semanticSearch / .atomicIncrease / .atomicDecrease / .aggregate

context.email      // outbound email
  .send(destination, subject, message)

context.telephony  // only sendSms available in BaseContextLibrary
  .sendSms(destination, message)

context.functions  // schedule / run / dispatch other CRON functions by slug
  .schedule({ slug, runAt: Date | number | ISO string, params?, maxRetries? }) → { scheduledRunId }
  .dispatch({ slug, params?, maxRetries? })                                    → { scheduledRunId }   (== schedule with runAt: now)
  .run({ slug, params? })                                                       → { result, logs }    (SYNC, blocks until done)
```

Additional namespaces are available when a function runs as an agent tool inside a live session (`context.agent`, `context.session`, `context.attachments`, `context.outbound`, `context.campaign`, `context.tools`, `context.a2a`, `context.transcriber`). These are NOT present in standalone Wonderful Functions or cron functions.

## `fetch` and outbound HTTP

The sandbox's `fetch` is patched. Supports the standard `Request`/`Response`, plus three extra options:

```ts
await fetch(url, {
  secretName: "MY_SECRET",   // inject the secret as auth via runner proxy (proxy resolves it server-side)
  verify: false,             // skip TLS verification (use sparingly)
  hostOverride: "real.host", // for Host-header SNI
});
```

For simple cases, just call regular `fetch(...)` with manual `Authorization: Bearer ${context.secrets.get("KEY")}` or query strings (e.g. Gemini's `?key=...`).

Streaming response bodies are supported; `response.arrayBuffer()` / `.text()` / `.json()` all work. Use binary downloads via `new Uint8Array(await resp.arrayBuffer())`.

## Run history and observability

```sh
# Regular function runs (history of HTTP-invocations + dispatches)
GET /api/v1/wonderful-functions/{id}/runs?page=1&page_size=20

# Cron function runs (history of cron firings + manual triggers + dispatched runs)
GET /api/v1/wonderful-cron-functions/{id}/runs?page=1&page_size=20

# Scheduled-but-not-yet-fired cron runs
GET /api/v1/wonderful-cron-functions/{id}/scheduled-runs
```

Each run row contains `status` (`success` / `error` / `timeout`), `duration_ms`, `input_params`, `output`, `error_message`, and `logs` (concatenated `console.log` / `.error` output from the function).

When debugging a 500 from `POST /api/v1/functions/{slug}`, the first thing to check is this runs endpoint — the error message there is much more specific than the HTTP 500.

## Timeout and retry behavior

- `timeout_ms` on the function record bounds a single invocation. Default is 60_000.
- For cron-dispatched runs (i.e. `context.functions.dispatch`), the dispatching call accepts `maxRetries`. Failed runs are retried up to that many times with backoff. Set `maxRetries: 0` for fire-and-forget without retry.
- Synchronous `context.functions.run({slug, ...})` does NOT retry. It blocks the caller until the run finishes (or its timeout fires) and returns `{ result, logs }`.

## Recommended split for an app

| Concern | Where it lives |
|---|---|
| UI manual trigger ("start a run") | Regular function (HTTP POST). Body has the user inputs. |
| The actual worker (long-running) | Cron function with `cron_schedules: []`. Dispatched by the trigger. |
| Recurring background job | Cron function with a `cron_schedules` entry. |
| Reading rows for the UI | Either direct `api.get("custom-tables/...")` from the React app, OR a regular function that returns filtered/joined data via `context.tables.filter(...)`. |

Why this split: the UI needs an HTTP-callable function (regular). The worker needs to be dispatchable by slug (cron-only). Treat regular functions as "thin HTTP shells that dispatch cron workers".
