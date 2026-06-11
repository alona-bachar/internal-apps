# `@wonderful/app-sdk` — Reference for the React app side

The React bundle that ships inside a Wonderful App has zero secrets. All API calls go through `useWonderful().api`, which the platform host wires up at runtime.

## The hook

```tsx
import { useWonderful } from "@wonderful/app-sdk";

function MyComponent() {
  const { api, context } = useWonderful();
  // ...
}
```

`api` shape (matches `WonderfulAPI` in the SDK):

```ts
interface WonderfulAPI {
  fetch(path: string, options?: RequestInit): Promise<Response>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
}
```

`context` shape:

```ts
interface WonderfulContext {
  tenantId:  string;     // empty string for external/anonymous app-view sessions
  userId:    string;     // empty for external sessions
  userName:  string;     // empty for external sessions
  theme:     "light" | "dark";
  apiBaseUrl: string;
}
```

## API path rules

- `api.get("/agents")` → `/api/v1/agents`
- `api.get("custom-tables/runs/rows")` → `/api/v1/custom-tables/runs/rows`
- `api.get("/api/v2/apps")` → `/api/v2/apps` (explicit `/api/*` is preserved)

You can pass either bare paths (auto-prefixed with `/api/v1`) or full `/api/v2/...` paths.

## **CRITICAL — `api` identity changes every render**

The `api` object returned by `useWonderful()` is recreated on every render. Using it directly in `useEffect` / `useCallback` deps **causes an infinite fetch loop**. Stash it in a ref:

```tsx
import { useEffect, useRef, useState } from "react";
import { useWonderful } from "@wonderful/app-sdk";

function MyList() {
  const { api } = useWonderful();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiRef.current.get("custom-tables/runs/rows?page=1&page_size=20");
      if (!cancelled) setRows((res as any).data ?? []);
    })();
    return () => { cancelled = true; };
  }, []);  // empty deps; ref is stable
}
```

## Calling Wonderful Functions from the app

A regular function registered with `path_slug: "start-detection"` and `method: "POST"` is invoked from the app as:

```ts
const { run_id } = await apiRef.current.post<{ run_id: string }>(
  "functions/start-detection",
  { communication_id, triggered_by: "manual" },
);
```

The response is the raw return value of `userFunction(context)` — whatever you `return` from the function body is what arrives here. (Note: not wrapped in a `data` envelope.)

For cron functions (which are NOT HTTP-callable by path), trigger them via the cron API:

```ts
// 1. discover the id once
const list = await apiRef.current.get<{ data: Array<{ id: string; slug: string }> }>("wonderful-cron-functions");
const cronId = list.data.find((c) => c.slug === "sample-and-sweep")!.id;

// 2. fire it
await apiRef.current.post(`wonderful-cron-functions/${cronId}/trigger`, {});
```

## Reading tables from the app

```ts
type Row<T> = { id: string; data: T; created_at: number; updated_at: number };

const resp = await apiRef.current.get<{
  data: Row<RunData>[];
  pagination: { total_rows: number; total_pages: number; page: number; limit: number };
}>("custom-tables/transcript_anomaly_runs/rows?page=1&page_size=50");
```

**Reminder:** the HTTP `/rows` endpoint silently ignores column filters. To filter, either:
1. Fetch and filter client-side.
2. Call a Wonderful Function that uses `context.tables.filter(...)` and returns the filtered subset.

## Error shape

Errors from the controller arrive as `{message, original_message?, status, details?}`. The SDK's `fetch`/`get`/`post`/`put` throw on non-2xx. Axios-style error: `error.response.data.message`. Catch carefully:

```ts
try {
  await apiRef.current.post("functions/start-detection", body);
} catch (e: any) {
  const msg = e?.response?.data?.message ?? e?.message ?? String(e);
  // ...
}
```

When a function throws inside its `code`, the controller returns HTTP 500 to the SDK. The actual error message is in the function's run-history entry (`GET /api/v1/wonderful-functions/{id}/runs`), not in the 500 body.

## App bundle contract

The platform host imports exactly `/app-assets/<token>/app.js` and optionally `style.css`. So:

- `src/index.ts` MUST default-export a React component.
- `pnpm build` (Vite library mode) MUST produce `dist/app.js`.
- Externalize the host-provided modules in `vite.config.ts`:

```ts
rollupOptions: {
  external: [
    "react", "react-dom", "react/jsx-runtime",
    "@wonderful/app-sdk",
    "@wonderful/ui-base",
  ],
  output: {
    assetFileNames: (info) =>
      info.name?.endsWith(".css") ? "style.css" : "[name][extname]",
  },
},
cssCodeSplit: false,
```

Vite library-mode names the CSS bundle after the package by default — the `assetFileNames` rule forces it to `style.css` to match the manifest.

## App SDK without `npm.wonderful.ai` auth

If you can't auth against the private registry, you can still build:

1. Remove `@wonderful/ui-base` if you weren't using it.
2. Leave `@wonderful/app-sdk` externalized in vite config.
3. Add an ambient TypeScript shim so TS stops complaining at build time:

```ts
// src/types/wonderful-app-sdk.d.ts
declare module "@wonderful/app-sdk" {
  export interface WonderfulAPI {
    fetch(path: string, options?: RequestInit): Promise<Response>;
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
    put<T = unknown>(path: string, body?: unknown): Promise<T>;
    del(path: string): Promise<void>;
  }
  export interface WonderfulContext {
    tenantId: string; userId: string; userName: string;
    theme: "light" | "dark"; apiBaseUrl: string;
  }
  export function useWonderful(): { api: WonderfulAPI; context: WonderfulContext };
}
```

At runtime the host provides the real module. The shim is purely for TypeScript.

## Shadow DOM gotchas

The app renders inside a Shadow DOM. Two consequences:

1. **CSS variables defined on `:root` don't reach inside the shadow root.** Re-declare your custom CSS variables on your app's top-level element:

```css
.app-root {
  --app-bg: var(--neutral-100, #f5f5f5);
  --app-fg: var(--foreground-100, #141414);
  /* ... */
  background: var(--app-bg);
  color:      var(--app-fg);
}
```

2. **`body { ... }` styles don't apply.** Move any body-level font, color, or background rules to your app root selector.

3. **Avoid global CSS variable name collisions** — the platform loads Tailwind which uses common names (`--green`, `--blue`, etc.). Prefix yours (e.g. `--myapp-blue`).

## Platform design tokens

The Wonderful theme exposes these CSS variables (light/dark variants resolve automatically):

```
Surfaces / borders
  --surface-00      (card / panel background)
  --neutral-00      (secondary surface)
  --neutral-100     (page background)
  --neutral-200..500 (borders, dividers)

Text
  --foreground-100  (primary text)
  --neutral-800..600 (secondary, placeholder)

Semantic (-100 full, -5 tint, -30 border)
  --color-blue-*    --color-green-*    --color-amber-*
  --color-red-*     --color-purple-*   --color-orange-*
```

Always prefer these over hardcoded hex so your app picks up theme changes (and dark mode) automatically.
