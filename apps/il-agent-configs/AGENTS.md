# Wonderful Build-Time Sandbox

This `template-ready` copy is the build-time sandbox working template.

- Dependencies are already installed; `pnpm build` works from this set.
- `@wonderful/ui-base` and `@wonderful/app-sdk` are baked into `node_modules` — read [node_modules/@wonderful/ui-base/ui-base.es.d.ts](node_modules/@wonderful/ui-base/ui-base.es.d.ts) for the live API surface before copying any snippet from docs.
- Use `/workspace/skills/wonderful-apps/assets/bin/new-app /workspace/<app-dir>` to start from this copy.
- The raw upstream reference template stays at `/workspace/skills/wonderful-apps/assets/template`.

## Adding a new npm dependency

Public packages install normally:

```bash
pnpm add <pkg>
```

The pnpm store is writable and seeded with the template's pre-resolved deps, so installs are fast. Then in your `vite.config.ts`:

- **Bundle it.** Do NOT add it to the `external` array. Only the host-shared libs already listed there are import-mapped at runtime; anything else must be bundled or the browser throws `Failed to resolve module specifier`.
- **If the package reads `process.env.NODE_ENV`**, add `define: { "process.env.NODE_ENV": JSON.stringify("production") }` to the library-build branch of `vite.config.ts`. Otherwise it crashes at runtime with `process is not defined`.

## Already in the template

`react`, `react-dom`, `@wonderful/ui-base`, `@wonderful/app-sdk`, `@vitejs/plugin-react`, `archiver`, `typescript`, `vite`, `@types/*`. Apps that only need these don't need `pnpm add` at all.
# AGENTS.md for Template Forks

This file is for developers (and coding assistants) working in a fork of this template.
Use it as the implementation contract for a Wonderful App bundle.

## What to Keep Intact

- Keep `src/index.ts` as a default export entry point for your app component.
- Keep the bundle contract: `pnpm build` outputs `dist/app.js` (and optional `dist/style.css`).
- Keep packaging contract: `pnpm package` must include build files plus `manifest.json`.
- Keep the source-in-bundle contract: `pnpm package` ships a snapshot of the
  app's source under `source/` inside the zip. The controller stores it inside
  `bundle.zip` for `controller-cli apps download --extract` round-trips, but
  never serves it to the deployed app. To rebuild a fresh source checkout from
  a deployed app: `controller-cli apps download --app <slug> --extract <dir>`.
  Set `BUNDLE_INCLUDE_SOURCE=false` only if you intentionally need a
  source-free bundle (rare; loses the ability to round-trip edits).

## First Steps After You Fork

1. Install dependencies:

```bash
pnpm install
pnpm add @wonderful/app-sdk @wonderful/ui-base@0.5.0
```

2. Build your app UI in `src/App.tsx` (or split into `src/components/*`).
3. Use runner mode when building features that call Wonderful APIs.

If scoped package installs fail, configure registry in `.npmrc`:

```ini
@wonderful:registry=https://npm.wonderful.ai
registry=https://registry.npmjs.org
```

## Styling

This template uses plain CSS.

- Keep `src/index.ts` export-only (no CSS imports).
- Import `src/style.css` from `src/App.tsx` (or your top-level app component).
- Write styles in `src/style.css` using standard CSS. The file is bundled into `dist/style.css` on build.

## Accessing Wonderful APIs from the App

Use `useWonderful()` from `@wonderful/app-sdk`. Do not put API keys or controller base URLs in browser code.

```tsx
import { useEffect, useState } from "react";
import { useWonderful } from "@wonderful/app-sdk";

type ApiEnvelope<T> = {
  data: T;
  status?: string;
};

type AgentSummary = {
  id: string;
  name: string;
};

export function AgentsList() {
  const { api, context } = useWonderful();
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  useEffect(() => {
    const load = async () => {
      const response = await api.get<ApiEnvelope<AgentSummary[]>>("/agents");
      setAgents(response.data);
    };
    void load();
  }, [api]);

  const createAgent = async () => {
    const response = await api.post<ApiEnvelope<AgentSummary>>("/agents", {
      name: `New agent by ${context.userName}`,
    });
    setAgents((prev) => [response.data, ...prev]);
  };

  return (
    <div>
      <button onClick={() => void createAgent()}>Create agent</button>
      <pre>{JSON.stringify(agents, null, 2)}</pre>
    </div>
  );
}
```

### API Path Rules

- `api.get("/something")` -> `/api/v1/something`
- `api.get("/api/v2/apps")` -> `/api/v2/apps` (keeps explicit `/api/*`)

If you need v2, pass a full `/api/v2/...` path.

## Importing UI from `@wonderful/ui-base`

Use root imports from `@wonderful/ui-base` (no deep imports).

```tsx
import { Button, InputText, Stack, Text } from "@wonderful/ui-base";
import { useState } from "react";

export function CreateForm() {
  const [name, setName] = useState("");

  return (
    <Stack gap={3}>
      <Text variant="heading-3">Create item</Text>
      <InputText
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        isDisabled={!name.trim()}
        onClick={() => {
          // submit action
        }}
      >
        Save
      </Button>
    </Stack>
  );
}
```

### UI Import Rules

- Prefer `@wonderful/ui-base` components over custom primitives.
- Import types as `import type { ... } from "@wonderful/ui-base"` when needed.
- Avoid deep imports like `@wonderful/ui-base/dist/...`.

## Local Development Modes

- `pnpm dev`: static UI iteration.
- `pnpm runner`: preferred for SDK context + API integration testing.

Runner reads `WONDERFUL_API_KEY` server-side and proxies app API calls through `/proxy/*`.

### Required Local Runner Compatibility

Keep these behaviors when editing template infrastructure:

- Load `@wonderful/ui-base/style.css` in local entrypoints:
  - `dev/main.tsx`
  - `runner/main.tsx`
- Do not import `@wonderful/ui-base/style.css` from `src/index.ts` (bundle entry).
- Do not import `src/style.css` from `src/index.ts` (bundle entry).
- In `runner/server.mjs`, preserve proxy decoding safeguards:
  - remove `accept-encoding` before proxying upstream requests
  - remove `content-encoding` when forwarding upstream responses
- Keep `@wonderful/app-sdk` aliasing to `runner/sdk-shim.ts` for `dev` and `runner` modes in `vite.config.ts`.

## Uploading to Wonderful

App upload is currently manual in the Wonderful UI.

1. `pnpm build && pnpm package`
2. Open your app in Wonderful UI
3. Upload the zip from `dist/` in the **Versions** page
4. Activate the uploaded version

Do not rely on API-key upload flow for app bundle publishing.

## Custom Tables API

Use `api` from `useWonderful()` to read and write custom tables.

```ts
// Create a table
await api.post("custom-tables", {
  name: "my_table",
  description: "...",
  columns: [
    { name: "title",  type: "string", required: true },
    { name: "amount", type: "number", required: true },
  ],
});

// Insert a row
await api.post("custom-tables/my_table/rows", {
  data: { title: "Foo", amount: 1000 },
});

// Fetch rows — pages are 1-indexed
const res = await api.get<{
  data: Array<{ id: string; data: Record<string, unknown> }>;
  pagination: { total_rows: number; total_pages: number; page: number; limit: number };
}>("custom-tables/my_table/rows?page=1&limit=20");

// Update a row
await api.put(`custom-tables/my_table/rows/${id}`, { data: { amount: 2000 } });

// Delete a row
await api.del(`custom-tables/my_table/rows/${id}`);
```

**Error behaviour:** When a table does not exist, the API returns **500**, not 404. Do not rely on 404 detection.

## Preventing Infinite Fetch Loops with `useWonderful()`

The `api` object from `useWonderful()` is recreated on every render. Using it directly in `useCallback` or `useEffect` deps causes an infinite loop. Store it in a ref:

```ts
const { api } = useWonderful();
const apiRef = useRef(api);
apiRef.current = api;

const fetchData = useCallback(async () => {
  const res = await apiRef.current.get("...");
  // ...
}, []); // empty deps — stable reference via ref

useEffect(() => { fetchData(); }, [fetchData]);
```

## Platform Design Tokens

The Wonderful platform ships a design token system in `base-theme.css`. Always use these tokens instead of hardcoded hex values so your app stays visually consistent with the platform and picks up future theme changes.

### Surfaces & Borders

| Token | Light value | Dark value | Use for |
|---|---|---|---|
| `--surface-00` | `#ffffff` | `#181818` | Card / panel background |
| `--neutral-00` | `#fafafa` | `#080808` | Secondary surface, input background |
| `--neutral-100` | `#f5f5f5` | `#1e1e1e` | Page background |
| `--neutral-200` | `#f1f1f1` | `#252525` | Subtle tint |
| `--neutral-300` | `#e5e5e5` | `#2e2e2e` | Border, divider |
| `--neutral-400` | `#dbdbdb` | `#383838` | Strong border |
| `--neutral-500` | `#dddddd` | `#484848` | Disabled border |

### Text

| Token | Light value | Dark value | Use for |
|---|---|---|---|
| `--foreground-100` | `#141414` | `#f5f5f5` | Primary text |
| `--neutral-800` | `#393939` | `#e0e0e0` | Strong secondary text |
| `--neutral-700` | `#777777` | `#b0b0b0` | Secondary / label text |
| `--neutral-600` | `#a9a9a9` | `#9e9e9e` | Placeholder / muted text |

### Semantic Colors (static — same in light and dark)

Each semantic color comes in three strengths:

| Name | Full (`-100`) | Tint bg (`-5`) | Border (`-30`) |
|---|---|---|---|
| Blue | `#2399fa` | `#2399fa0d` | `#2399fa4d` |
| Green | `#03a97e` | `#03a97e0d` | `#03a97e4d` |
| Amber | `#faad14` | `#faad140d` | `#faad144d` |
| Red | `#ff3f3f` | `#ff3f3f0d` | `#ff3f3f4d` |
| Purple | `#ba98ff` | `#ba98ff0d` | `#ba98ff4d` |
| Orange | `#ffa75a` | — | — |

CSS variables: `--color-blue-100`, `--color-blue-5`, `--color-blue-30` (same pattern for each color).

**Typical badge pattern:**
```css
.badge-success {
  color:      var(--color-green-100);
  background: var(--color-green-5);
  border:     1px solid var(--color-green-30);
}
```

**Chart colors** — use the `-100` values: blue `#2399fa`, green `#03a97e`, amber `#faad14`, red `#ff3f3f`, purple `#ba98ff`, orange `#ffa75a`.

### How to use tokens in your app

Declare an alias layer on your root element so tokens resolve inside the Shadow DOM, then reference the aliases throughout your CSS:

```css
.app-root {
  /* Surfaces */
  --app-bg:       var(--neutral-100,  #f5f5f5);
  --app-surface:  var(--surface-00,   #ffffff);
  --app-surface2: var(--neutral-00,   #fafafa);
  --app-border:   var(--neutral-300,  #e5e5e5);

  /* Text */
  --app-text:     var(--foreground-100, #141414);
  --app-text-2:   var(--neutral-700,    #777777);
  --app-text-3:   var(--neutral-600,    #a9a9a9);

  /* Semantic */
  --app-blue:     var(--color-blue-100,  #2399fa);
  --app-blue-lt:  var(--color-blue-5,    #2399fa0d);
  --app-blue-bd:  var(--color-blue-30,   #2399fa4d);
  --app-green:    var(--color-green-100, #03a97e);
  --app-green-lt: var(--color-green-5,   #03a97e0d);
  --app-green-bd: var(--color-green-30,  #03a97e4d);
  --app-amber:    var(--color-amber-100, #faad14);
  --app-amber-lt: var(--color-amber-5,   #faad140d);
  --app-amber-bd: var(--color-amber-30,  #faad144d);
  --app-red:      var(--color-red-100,   #ff3f3f);
  --app-red-lt:   var(--color-red-5,     #ff3f3f0d);
  --app-red-bd:   var(--color-red-30,    #ff3f3f4d);
}
```

The hardcoded fallbacks ensure correct rendering in local `pnpm dev` / `pnpm runner` before the platform stylesheet loads. Always use a unique prefix (e.g. `--app-`, `--myapp-`) to avoid collisions with platform-level variables.

## Styling in Shadow DOM

Apps are embedded inside a Shadow DOM in the Wonderful UI. This affects CSS in two important ways:

### 1. Define CSS variables on your root element, not `:root`

CSS custom properties declared in `document.head` stylesheets do not reliably reach inside the shadow root. Re-declare all variables on the app's top-level element so they resolve for all descendants:

```css
.app-root {
  --myapp-bg: #F4F5F7;
  --myapp-text: #111827;
  --myapp-border: #E5E7EB;
  /* ... */
  background: var(--myapp-bg);
  color: var(--myapp-text);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
}
```

### 2. Use a unique CSS variable prefix

The platform loads Tailwind v4 which defines common names like `--green`, `--blue`, `--red`, `--amber` as CSS variables. Using the same names will cause collisions. Always namespace your variables (e.g. `--myapp-green`, `--myapp-blue`).

### 3. Move `body` styles to your root element

`body {}` rules do not apply inside the shadow root. Any font, color, or background set on `body` must be moved to `.app-root` (or equivalent).

## Required Validation Before Handoff

Every implementation must run and pass:

```bash
pnpm install
pnpm build
pnpm build:runner
```

When handing work off to another agent, include:

- exact files changed
- short implementation summary
- results of the three required commands above
