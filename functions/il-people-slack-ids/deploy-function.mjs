#!/usr/bin/env node
// Deploy il-agent-configs-data-v1 to the cto-office tenant.
// PUT silently drops `code` on Wonderful Functions, so this script DELETE+POSTs.
//
// Usage:
//   WONDERFUL_API_KEY="<key>" node functions/il-agent-configs-data/deploy-function.mjs

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "il-people-slack-ids.ts");
// Resolve the esbuild CLI from the first workspace location that has it
// installed (staffing or any of the apps ship esbuild@0.21.5 via pnpm).
const ESBUILD = [
  "../../apps/staffing/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild",
  "../../apps/il-agent-configs/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild",
]
  .map((p) => path.resolve(__dirname, p))
  .find((p) => existsSync(p));

if (!ESBUILD) {
  console.error("esbuild CLI not found in any workspace node_modules.");
  process.exit(1);
}

const CONTROLLER = process.env.CONTROLLER_BASE_URL ?? "https://cto-office.api.wonderful.ai";
const API_KEY = process.env.WONDERFUL_API_KEY ?? "";
const SLUG = process.env.FUNCTION_SLUG ?? "il-people-slack-ids-v1";
const NAME = process.env.FUNCTION_NAME ?? "IL People Slack IDs v1";

if (!API_KEY) {
  console.error("WONDERFUL_API_KEY env var is required.");
  process.exit(1);
}

async function api(method, urlPath, body) {
  const res = await fetch(`${CONTROLLER}${urlPath}`, {
    method,
    headers: { "X-api-key": API_KEY, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${urlPath} -> ${res.status} ${typeof parsed === "string" ? parsed.slice(0, 400) : JSON.stringify(parsed).slice(0, 400)}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

// Strip TS using the esbuild CLI installed under apps/staffing.
const stripped = execFileSync(
  ESBUILD,
  ["--format=esm", "--target=es2020", SRC],
  { encoding: "utf8" },
);

// Drop any export keywords that survived (esbuild keeps them in format: esm).
const code = stripped
  .replace(/^export\s+/gm, "")
  .replace(/^export\s+\{[^}]*\};?\s*$/gm, "");

console.log(`Code size: ${code.length} bytes`);

// Find any existing function with our slug.
const list = await api("GET", "/api/v1/wonderful-functions?limit=200");
const existing = (list.data ?? []).find((f) => f.path_slug === SLUG);

if (existing) {
  console.log(`Found existing function ${existing.id} (${existing.path_slug}) — deleting.`);
  await api("DELETE", `/api/v1/wonderful-functions/${existing.id}`);
}

console.log(`POSTing new function with slug ${SLUG}...`);
const payload = {
  name: NAME,
  path_slug: SLUG,
  method: "POST",
  timeout_ms: 120000,
  is_enabled: true,
  param_mapping: {
    body_params: [
      { name: "action", type: "string", required: true },
      { name: "payload", type: "string", required: false },
    ],
  },
  code,
};
const created = await api("POST", "/api/v1/wonderful-functions", payload);
console.log(`Created: ${created.data.id}  slug=${created.data.path_slug}`);
