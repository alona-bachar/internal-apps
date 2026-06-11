#!/usr/bin/env node
// Deploy the pod-staffing Wonderful App bundle to a tenant via /api/v2/apps.
// Follows the 4-step flow: upload init -> presigned PUT -> upload complete -> activate.
//
// Usage:
//   WONDERFUL_API_KEY="<key>" node scripts/deploy-app.mjs [bundle.zip]
//
// Optional env:
//   CONTROLLER_BASE_URL  (default: https://cto-office.api.wonderful.ai)
//   APP_ID               (default: be2be265-6681-4524-8710-afd0c765426d / "Client Staffing")
//   VERSION              (default: <package-json-version>-<utc-timestamp>)
//   ACTIVATE=0           (skip activation; upload-only)

import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const CONTROLLER = process.env.CONTROLLER_BASE_URL ?? "https://cto-office.api.wonderful.ai";
const API_KEY = process.env.WONDERFUL_API_KEY ?? "";
const APP_ID = process.env.APP_ID ?? "be2be265-6681-4524-8710-afd0c765426d";
const ACTIVATE = process.env.ACTIVATE !== "0";

if (!API_KEY) {
  console.error("WONDERFUL_API_KEY env var is required.");
  process.exit(1);
}

const pkg = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const VERSION = process.env.VERSION ?? `${pkg.version}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const bundleArg = process.argv[2] ?? path.join("dist", `cto-office-pod-staffing-${pkg.version}.zip`);
const bundle = path.isAbsolute(bundleArg) ? bundleArg : path.join(appRoot, bundleArg);

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
