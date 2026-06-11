# internal-apps

Wonderful internal apps for the **CTO Office** tenant, extracted from `il-cto-office`. Two React + Vite Wonderful Apps plus the backend functions and table provisioning they depend on. See `README.md` for the full folder map.

| Folder | What it holds |
|--------|---------------|
| `apps/il-agent-configs/` | Agent-config viewer/editor (Snowflake-fed). Backed by `functions/il-agent-configs-data` and `functions/il-pod-slack-poster`. Deploy via its `scripts/deploy-app.mjs`. |
| `apps/staffing/` | Staffing data visualizer/editor. App ID `be2be265-6681-4524-8710-afd0c765426d`. Backed by `functions/staffing-data` (`pod-staffing-data-v109`). Deploy via its `scripts/deploy-app.mjs` (NOT `wonderful deploy`). |
| `functions/` | HTTP/cron Wonderful Functions backing the apps. Deploy each via its `deploy-function.mjs`. |
| `tables/` | Schema docs, provisioning scripts, and seed data for the tenant's custom tables. |

All target the `cto-office` tenant at `https://cto-office.api.wonderful.ai`.

## Conventions

- Apps and functions use the Wonderful registry — see `.npmrc` (`@wonderful:registry=https://npm.wonderful.ai/`).
- Deploys and table scripts read `WONDERFUL_API_KEY` from the environment. **This repo is public — never commit secrets, `.env*`, `node_modules/`, or `dist/`** (all gitignored).
- App deploy = `apps/<app>/scripts/deploy-app.mjs` (zips `dist/`, activates live on prod). Build the app first.
- The richest per-app SDK/runner reference lives in each app's `AGENTS.md`.

## SDK Reference (`@wonderful/types/schema`)

Import the schema/definition builders:

```typescript
import { s, w } from "@wonderful/types/schema";
```

`s` builds types (`s.string()`, `s.number()`, `s.object({...})`, `s.array(...)`, `s.enum(...)`, `s.optional(...)`, `s.union(...)`, all with `.describe(...)`). `w` builds definitions: `w.tool`, `w.skill`, `w.agent`, `w.account`, `w.env`. Tool handlers receive `(ctx, params)`; `ctx` exposes `ctx.kv`, `ctx.secrets`, `ctx.globals`, `ctx.metadata`, `ctx.tools.call`, `ctx.email`, `ctx.telephony`, etc.

## Testing (`@wonderful/test`)

Vitest in an isolated WASM sandbox:

```typescript
import { createToolTester } from "@wonderful/test";
const tester = await createToolTester({ toolPath: "./src/tools/my-tool" });
tester.mockFetch(() => ({ status: 200, body: { data: "value" } }));
const result = await tester.run({ query: "test" });
```

Run: `npx vitest`.

## Gotchas

- **KV is session-scoped** — persists only within a single call session.
- **`ctx.kv.get()` throws** on a missing key — guard with `ctx.kv.exists()`.
- **`mockFetch` intercepts all fetch calls**, including nested ones.
- **Tool names are global** — not scoped to a skill.
