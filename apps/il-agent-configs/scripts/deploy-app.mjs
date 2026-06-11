#!/usr/bin/env node
// Deploy the il-agent-configs Wonderful App bundle to the cto-office tenant
// via /api/v2/apps.
//
// Usage:
//   WONDERFUL_API_KEY="<key>" node scripts/deploy-app.mjs [bundle.zip]
//
// Optional env:
//   CONTROLLER_BASE_URL  (default: https://cto-office.api.wonderful.ai)
//   APP_ID               (default: 5f8a256d-5ee3-4f41-83a0-a9b38c6df721 / "IL Agent Configs")
//   VERSION              (default: <package-json-version>-<utc-timestamp>)
//   ACTIVATE=0           (skip activation; upload-only)

import { readFile, stat, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const CONTROLLER = process.env.CONTROLLER_BASE_URL ?? "https://cto-office.api.wonderful.ai";
const API_KEY = process.env.WONDERFUL_API_KEY ?? "";
const APP_ID = process.env.APP_ID ?? "5f8a256d-5ee3-4f41-83a0-a9b38c6df721";
const ACTIVATE = process.env.ACTIVATE !== "0";

if (!API_KEY) {
  console.error("WONDERFUL_API_KEY env var is required.");
  process.exit(1);
}

const pkg = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const VERSION = process.env.VERSION ?? `${pkg.version}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

async function resolveBundle() {
  if (process.argv[2]) {
    return path.isAbsolute(process.argv[2]) ? process.argv[2] : path.join(appRoot, process.argv[2]);
  }
  const distEntries = await readdir(path.join(appRoot, "dist"));
  const zips = distEntries.filter((n) => n.endsWith(".zip")).sort();
  if (zips.length === 0) throw new Error("No zip found in dist/. Run 'pnpm build && pnpm package' first.");
  return path.join(appRoot, "dist", zips[zips.length - 1]);
}

const bundle = await resolveBundle();

const authHeader = API_KEY.startsWith("Bearer ")
  ? { Authorization: API_KEY }
  : { "X-api-key": API_KEY };

async function api(method, urlPath, body) {
  const res = await fetch(`${CONTROLLER}${urlPath}`, {
    method,
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${urlPath} -> ${res.status} ${typeof parsed === "string" ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200)}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

const st = await stat(bundle);
console.log(`Bundle:    ${bundle}`);
console.log(`Size:      ${st.size} bytes`);
console.log(`App ID:    ${APP_ID}`);
console.log(`Version:   ${VERSION}`);
console.log(`Activate:  ${ACTIVATE}`);
console.log("");

console.log("[1/4] init upload");
const init = await api("POST", `/api/v2/apps/${APP_ID}/upload/init`, {
  version: VERSION,
  file_name: path.basename(bundle),
  content_type: "application/zip",
  file_size: st.size,
});
const { upload_url, upload_key } = init.data;
console.log(`  upload_key: ${upload_key}`);

console.log("[2/4] PUT zip to presigned URL");
const zipBytes = await readFile(bundle);
const putRes = await fetch(upload_url, {
  method: "PUT",
  headers: { "Content-Type": "application/zip" },
  body: zipBytes,
});
if (!putRes.ok) {
  console.error(`  upload failed: ${putRes.status}`, await putRes.text());
  process.exit(1);
}
console.log("  upload ok");

console.log("[3/4] complete upload");
const complete = await api("POST", `/api/v2/apps/${APP_ID}/upload/complete`, {
  version: VERSION,
  upload_key,
});
const versionId = complete.data.id;
console.log(`  version_id: ${versionId}  bundle_size: ${complete.data.bundle_size}`);

if (ACTIVATE) {
  console.log("[4/4] activate");
  await api("PUT", `/api/v2/apps/${APP_ID}/versions/${versionId}/activate`);
  console.log("  activated");
} else {
  console.log("[4/4] skipped (ACTIVATE=0)");
}

const app = await api("GET", `/api/v2/apps/${APP_ID}`);
console.log("");
console.log("Done.");
console.log(`  slug:                ${app.data.slug}`);
console.log(`  active_version_id:   ${app.data.active_version_id}`);
console.log(`  internal URL:        ${CONTROLLER.replace(".api.", ".")}/apps/${app.data.slug}`);
