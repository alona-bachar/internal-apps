# External App Deployment to Wonderful Apps Platform via API

Generated: 2026-05-14

## Executive summary

External/local app development and deployment to the Wonderful Apps platform is already supported by API.

The production API surface used by the UI and internal `controller-cli` is under:

```text
/api/v2/apps
```

The deployment flow is:

1. Build a Wonderful app locally into a zip bundle containing `app.js`, optional CSS, and `manifest.json`.
2. Create or resolve an app in the target tenant/site.
3. Initialize a bundle upload to receive a presigned upload URL.
4. `PUT` the zip directly to the presigned URL.
5. Complete the upload, which creates an immutable app version.
6. Activate that version so `/apps/<app-slug>` serves it.
7. Optionally enable anonymous/external sharing, attach function resources, and mint `/app-view/?access_token=...` links.

Key finding from the codebase: the route registration in `wonderful-controller/infra/router/router.go` mounts Apps APIs on `/api/v2/apps`, and the UI client also calls `/api/v2/apps`. Some Go swagger comments still mention `/api/v1/apps`; treat those as stale for this feature.

---

## Source evidence from the codebase

Important files inspected:

- `wonderful-controller/infra/router/router.go`
  - v2 includes Apps APIs at `handleAPIsV2` (`/api/v2`): lines 638-650.
  - `/api/v2/apps` route table: lines 838-866.
  - signed asset/function runtime endpoints: `/app-assets/:assetToken/*path` and `/app-functions/:assetToken/:slug`: lines 402-408.
- `wonderful-ui/src/features/apps/data/apps.api.ts`
  - UI API base is `WORKSPACE_API_URL('/apps...', 'v2')`: line 19.
  - UI upload sequence is init -> presigned `PUT` -> complete: lines 48-84.
  - UI activation call: lines 91-95.
- `common/shared_types/wonderful_app.go`
  - request/response contracts for app CRUD, upload, versions, asset sessions, and access: lines 3-112.
- `common/shared_types/wonderful_app_resource.go`
  - app resource link contracts: lines 3-22.
- `wonderful-controller/components/wonderful_apps/service/bundles.go`
  - bundle limits and upload URL expiry: lines 26-35.
  - init upload validation and response: lines 56-87.
  - complete upload and version creation: lines 90-132.
  - bundle processing/storage/version row creation: lines 173-241.
  - zip validation/manifest parsing: lines 357-403.
- `wonderful-controller/components/wonderful_apps/service/session.go`
  - asset-session TTLs and JWT claims: lines 17-44.
  - create asset session, active/preview version resolution, share TTL cap: lines 56-135.
  - function allowlist resolution: lines 137-153.
  - live access revocation checks at token redemption: lines 254-297.
- `wonderful-ui/src/features/apps/components/AppHostShell.tsx`
  - host imports `/app-assets/<token>/app.js` and style candidates: lines 231-244.
  - internal app runtime context: lines 138-155.
- `wonderful-ui/src/features/apps/pages/ExternalAppPage.tsx`
  - external share page reads `access_token`, imports `app.js`, and sets function-only context: lines 47-88 and 117-127.
- `build/wonderful-sandbox/template-src/scripts/package.js`
  - official packaging script requires `dist/app.js`, writes manifest, and zips bundle/source files: lines 80-134.
- `common/context_helper/response.go`
  - raw HTTP responses are wrapped as `{ "data": ..., "status": ... }`: lines 16-20.

---

## Concepts

### Tenant/site

A deployment target is a Wonderful tenant/site/environment. The API is tenant-scoped by the authenticated request, usually through the tenant host/subdomain plus `X-api-key`.

If you deploy the same app to multiple sites, repeat the same API sequence for each target `BASE_URL` + `API_KEY`. App IDs are tenant-local, so do not assume an app ID from one tenant works in another.

### App

An app record has:

```ts
type App = {
  id: string;
  name: string;
  slug: string;
  description: string;
  permissions: "restricted" | "public";
  anonymous_access_enabled: boolean;
  is_archived: boolean;
  is_bookmarked: boolean;
  preview_url?: string | null;
  active_version_id?: string | null;
  active_version?: AppVersion;
  created_at: number;
  updated_at: number;
};
```

Notes:

- `slug` is derived server-side from `name`; there is no public API field to force a slug.
- `permissions` controls internal tenant visibility:
  - `restricted`: owner + explicit access list + admins/maintainers with app edit privileges.
  - `public`: visible to tenant users who have app view access.
- `anonymous_access_enabled` is separate from `permissions`. It gates external anonymous share links.

### Version

Every bundle upload creates a new immutable version:

```ts
type AppVersion = {
  id: string;
  version: string;
  bundle_size: number;
  entry_point: string;
  created_at: number;
};
```

Activating a version switches what users see at `/apps/<slug>`.

### Bundle

The platform host imports exactly:

```text
/app-assets/<asset-token>/app.js
```

It also tries to load stylesheet candidates:

```text
style.css
app.css
```

The recommended zip shape is:

```text
my-app-1.0.0.zip
├── app.js
├── style.css          # optional
└── manifest.json
```

The official template packaging script can also include source files under `source/...` and list them in `manifest.source_files`; the controller stores them in the downloadable bundle but does not serve them as runtime assets.

Bundle limits:

- Max bundle size: **100 MB**.
- Upload presigned URL expiry: **1 hour**.

### Asset session

The app runtime does not load assets with API-key headers. Instead, the frontend mints a signed asset-session token and loads:

```text
/app-assets/<token>/app.js
/app-assets/<token>/style.css
```

Asset-session token rules:

- Default TTL: **3 hours**.
- Share-link custom TTL (`expires_in`) max: **24 hours**.
- `expires_at` in asset-session responses is a Unix timestamp in **seconds**.
- Bundle upload/download `expires_at` values are Unix timestamps in **milliseconds**.

### External/anonymous app sharing

External apps are the same React bundle served through a public route:

```text
https://<tenant-site>/app-view/?access_token=<asset-session-token>
```

In external mode:

- No Wonderful user identity is provided (`tenantId`, `userId`, `userName` are empty strings).
- `functionBaseUrl` is set to `/app-functions/<token>`.
- The SDK only allows `api.invokeFunction(...)`; direct `api.get/post/put/delete/fetch` calls are blocked by the SDK.
- Function calls are checked against app-linked function resources.
- The code currently re-resolves the live function allowlist at function invocation time, so removing a function resource should stop new calls without waiting for the token to expire.
- Turning off `anonymous_access_enabled` revokes anonymous token redemption.

---

## Authentication and response format

### Headers

For tenant API calls:

```http
X-api-key: <YOUR_API_KEY>
Content-Type: application/json
```

For presigned upload/download URLs returned by the API, do **not** add the Wonderful API key. Use the presigned URL directly.

### Raw response envelope

Raw controller responses are wrapped:

```json
{
  "data": {
    "id": "..."
  },
  "status": 200
}
```

Errors look like:

```json
{
  "message": "share links require anonymous access to be enabled for this app",
  "original_message": "...",
  "status": 400,
  "details": {
    "operation_id": "..."
  }
}
```

The UI's Axios client unwraps this envelope, which is why frontend code sees only `response.data` from the wrapper.

---

## Permissions model

The router splits `/api/v2/apps` into view and edit groups:

### `apps:view`

Allowed:

- `GET /api/v2/apps`
- `GET /api/v2/apps/{id}`
- `GET /api/v2/apps/{id}/versions`
- `GET /api/v2/apps/{id}/resources`
- `POST /api/v2/apps/{id}/asset-session` without `version_id` and without `expires_in`
- `PUT /api/v2/apps/{id}/bookmark`

### `apps:edit`

Required for deployment and management:

- `POST /api/v2/apps`
- `PUT /api/v2/apps/{id}`
- `DELETE /api/v2/apps/{id}`
- `POST /api/v2/apps/{id}/upload/init`
- `POST /api/v2/apps/{id}/upload/complete`
- `PUT /api/v2/apps/{id}/versions/{version_id}/activate`
- `GET /api/v2/apps/{id}/versions/{version_id}/download`
- `POST /api/v2/apps/{id}/resources`
- `DELETE /api/v2/apps/{id}/resources/{resource_type}/{resource_ref}`
- preview image upload endpoints
- access-list endpoints
- `POST /api/v2/apps/{id}/asset-session` when using `version_id` or `expires_in`

### Owner-only updates

Even with `apps:edit`, only the app owner can change:

- `permissions`
- `anonymous_access_enabled`

This prevents a maintainer from making someone else's private app public or externally shareable.

---

## Endpoint reference

All paths below are relative to `BASE_URL`.

### List apps

```http
GET /api/v2/apps?include_archived=true
```

Permission: `apps:view`

Response:

```json
{
  "data": [
    {
      "id": "app_uuid",
      "name": "Operations Console",
      "slug": "operations-console",
      "description": "Internal ops app",
      "permissions": "restricted",
      "anonymous_access_enabled": false,
      "is_archived": false,
      "is_bookmarked": false,
      "preview_url": null,
      "active_version_id": "version_uuid",
      "created_at": 1760000000000,
      "updated_at": 1760000000000
    }
  ],
  "status": 200
}
```

### Create app

```http
POST /api/v2/apps
Content-Type: application/json
```

Permission: `apps:edit`

Request:

```json
{
  "name": "Operations Console",
  "description": "Internal ops app"
}
```

Response data: `App`.

Notes:

- New apps default to `permissions: "restricted"`.
- The slug is auto-derived from `name`.

### Get app

```http
GET /api/v2/apps/{app_id_or_slug}
```

Permission: `apps:view`

Response data: `App`, including `active_version` when present.

Practical note: some read/session paths resolve slug-or-UUID, but deployment upload paths should use the UUID returned by create/list because lower-level upload code checks `id = ?`.

### Update app

```http
PUT /api/v2/apps/{app_id}
Content-Type: application/json
```

Permission: `apps:edit`

Request fields are optional:

```json
{
  "name": "Operations Console",
  "description": "Updated description",
  "permissions": "public",
  "anonymous_access_enabled": true,
  "is_archived": false
}
```

Response data: `App`.

Valid `permissions` values:

```text
restricted
public
```

There is no `external` permission value. External sharing is controlled by `anonymous_access_enabled`.

### Delete app

```http
DELETE /api/v2/apps/{app_id}
```

Permission: `apps:edit`

Response:

```json
{
  "data": { "status": "deleted" },
  "status": 200
}
```

---

## Deployment API flow

### 1. Initialize bundle upload

```http
POST /api/v2/apps/{app_id}/upload/init
Content-Type: application/json
```

Permission: `apps:edit`

Request:

```json
{
  "version": "2026.05.14-commit-abc123",
  "file_name": "operations-console.zip",
  "content_type": "application/zip",
  "file_size": 1234567
}
```

Response:

```json
{
  "data": {
    "upload_url": "https://presigned-upload-url...",
    "upload_key": "apps/<tenant>/<app>/uploads/<uuid>.zip",
    "expires_at": 1760000000000
  },
  "status": 200
}
```

Validation:

- `version` is required.
- `file_size` must be `<= 100 MB` when supplied.
- `expires_at` is in Unix milliseconds.

### 2. Upload zip to presigned URL

```bash
curl -fsS -X PUT \
  -H "Content-Type: application/zip" \
  --upload-file "./dist/operations-console.zip" \
  "$UPLOAD_URL"
```

Do not include `X-api-key` here.

### 3. Complete bundle upload

```http
POST /api/v2/apps/{app_id}/upload/complete
Content-Type: application/json
```

Permission: `apps:edit`

Request:

```json
{
  "version": "2026.05.14-commit-abc123",
  "upload_key": "apps/<tenant>/<app>/uploads/<uuid>.zip"
}
```

Response:

```json
{
  "data": {
    "id": "version_uuid",
    "version": "2026.05.14-commit-abc123",
    "bundle_size": 1234567,
    "entry_point": "index.html",
    "created_at": 1760000000000
  },
  "status": 200
}
```

Even though the version response has `entry_point: "index.html"`, the current UI host loads `/app-assets/<token>/app.js`. The zip must contain `app.js` at the root.

### 4. Activate version

```http
PUT /api/v2/apps/{app_id}/versions/{version_id}/activate
```

Permission: `apps:edit`

Response:

```json
{
  "data": { "status": "activated" },
  "status": 200
}
```

After activation, internal tenant users open:

```text
https://<tenant-site>/apps/<app-slug>
```

---

## Version and rollback APIs

### List versions

```http
GET /api/v2/apps/{app_id}/versions
```

Permission: `apps:view`

Returns newest-first:

```json
{
  "data": [
    {
      "id": "version_uuid",
      "version": "2026.05.14-commit-abc123",
      "bundle_size": 1234567,
      "entry_point": "index.html",
      "created_at": 1760000000000
    }
  ],
  "status": 200
}
```

### Roll back

There is no separate rollback endpoint. Activate an older version:

```http
PUT /api/v2/apps/{app_id}/versions/{old_version_id}/activate
```

### Download a version bundle

```http
GET /api/v2/apps/{app_id}/versions/{version_id}/download
```

Permission: `apps:edit`

Response:

```json
{
  "data": {
    "download_url": "https://presigned-download-url...",
    "expires_at": 1760000000000
  },
  "status": 200
}
```

`expires_at` is Unix milliseconds.

---

## External/anonymous sharing APIs

### 1. Enable anonymous access

```http
PUT /api/v2/apps/{app_id}
Content-Type: application/json
```

Permission: `apps:edit` and caller must be app owner for this field.

```json
{
  "anonymous_access_enabled": true
}
```

### 2. Attach function resources

**Resource attachment is also what makes tables + functions show up under the
app in the platform UI** — not just an external-share concern. Without it, the
platform admin views show your app with zero linked resources even though
they were created in the same tenant. ALWAYS attach the app's tables and
regular functions at deploy time.

**Supported resource types:** `table`, `function` (regular only).
**NOT supported:** cron functions. POSTing a cron function UUID returns
`404 app resource target not found` — the resolver only consults
`/api/v1/wonderful-functions`, not `/api/v1/wonderful-cron-functions`. Cron
functions remain visible at the tenant level but never appear "under" any
app. Don't try to link them; the script should skip them silently.

**`resource_ref` value:**
- Tables → the table **name** (e.g. `"transcript_anomaly_runs"`)
- Regular functions → the function **UUID** (resolve from
  `GET /api/v1/wonderful-functions`)

External app users can only call Functions explicitly attached to the app.

```http
POST /api/v2/apps/{app_id}/resources
Content-Type: application/json
```

Permission: `apps:edit`

Request:

```json
{
  "resource_type": "function",
  "resource_ref": "function_uuid",
  "relationship": "linked",
  "required": true
}
```

Response:

```json
{
  "data": {
    "id": "resource_link_uuid",
    "app_id": "app_uuid",
    "resource_type": "function",
    "resource_ref": "function_uuid",
    "resource_name": "Customer Status",
    "relationship": "linked",
    "required": true,
    "created_at": 1760000000000,
    "updated_at": 1760000000000
  },
  "status": 200
}
```

Valid resource types:

```text
table
function
```

Valid relationships:

```text
managed
linked
```

If `relationship` is omitted, the service currently defaults it to `managed`; for externally callable existing functions, send `linked` explicitly.

### 3. List resources

```http
GET /api/v2/apps/{app_id}/resources
```

Permission: `apps:view`

### Idempotent bulk-attachment snippet

Drop this into the deploy script (just after activation). Tables are listed
by name, regular functions by slug; cron functions are intentionally absent
because the resources API rejects them.

```js
// Reusable bulk resource attachment — runs after `activate version`.
// Tables resolved by name, regular functions by slug → UUID.
// Cron functions skipped (resources API returns 404 for cron UUIDs).
const APP_TABLE_NAMES    = ["my_app_runs", "my_app_items", /* ... */];
const APP_FUNCTION_SLUGS = ["start-x", "trigger-y"];

async function listAll(api, path) {
  const all = [];
  for (let p = 1; p < 60; p++) {
    const r = await api("GET", `${path}?page=${p}&page_size=100`);
    const rows = r.data ?? [];
    all.push(...rows);
    if (rows.length === 0 || (r.pagination?.total_rows && all.length >= r.pagination.total_rows)) break;
  }
  return all;
}

async function attachAppResources(api, appId) {
  // 1. Already-linked set so we don't duplicate-POST.
  let existing = { data: [] };
  try { existing = await api("GET", `/api/v2/apps/${appId}/resources`); } catch {}
  const linked = new Set((existing.data || []).map((r) => `${r.resource_type}/${r.resource_ref}`));

  // 2. Resolve function slugs → UUIDs from the regular-functions table.
  const regs = await listAll(api, "/api/v1/wonderful-functions");
  const fnIdBySlug = new Map(regs.map((f) => [f.path_slug, f.id]));

  // 3. Build targets and POST what's missing.
  const targets = [
    ...APP_TABLE_NAMES.map((n)    => ({ type: "table",    ref: n,                  label: n   })),
    ...APP_FUNCTION_SLUGS.map((s) => ({ type: "function", ref: fnIdBySlug.get(s),  label: s   })),
  ];
  for (const t of targets) {
    if (!t.ref) { console.log(`  - skip ${t.type} ${t.label} (not in tenant)`); continue; }
    if (linked.has(`${t.type}/${t.ref}`)) { console.log(`  ✓ ${t.type} ${t.label} already linked`); continue; }
    try {
      await api("POST", `/api/v2/apps/${appId}/resources`, {
        resource_type: t.type,
        resource_ref:  t.ref,
        relationship:  "linked",
        required:      true,
      });
      console.log(`  + linked ${t.type} ${t.label}`);
    } catch (e) {
      console.log(`  ! could not link ${t.type} ${t.label}: ${e.message}`);
    }
  }
}
```

Why we POST after every deploy rather than once: it's idempotent (GETs the
current set first), and if the tenant ever had its app deleted-and-recreated
the new app id needs fresh resource links anyway.

### 4. Detach a resource

```http
DELETE /api/v2/apps/{app_id}/resources/{resource_type}/{resource_ref}
```

Permission: `apps:edit`

Example:

```http
DELETE /api/v2/apps/app_uuid/resources/function/function_uuid
```

### 5. Mint external share token

```http
POST /api/v2/apps/{app_id}/asset-session
Content-Type: application/json
```

Permission: `apps:edit` when `expires_in` is supplied.

Request:

```json
{
  "expires_in": 86400
}
```

Response:

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "version_id": "active_version_uuid",
    "expires_at": 1760000000
  },
  "status": 200
}
```

Rules:

- `expires_in` is seconds.
- Max `expires_in` is capped to 24 hours.
- Custom `expires_in` requires `anonymous_access_enabled: true`; otherwise the API returns HTTP 400.
- `expires_at` is Unix seconds.

Share URL:

```text
https://<tenant-site>/app-view/?access_token=<token>
```

### 6. Preview a specific version without activating

```http
POST /api/v2/apps/{app_id}/asset-session
Content-Type: application/json
```

Permission: `apps:edit`

```json
{
  "version_id": "version_uuid"
}
```

Use the returned token to load assets from:

```text
/app-assets/<token>/app.js
```

---

## Optional access-list APIs

For restricted apps, you can grant/revoke individual users.

### List app access

```http
GET /api/v2/apps/{app_id}/access
```

Permission: `apps:edit` plus `users:view` because the response includes user identity.

### Grant access

```http
POST /api/v2/apps/{app_id}/access
Content-Type: application/json
```

Permission: `apps:edit`

```json
{
  "user_id": "user_uuid"
}
```

The target user must already be a member of the tenant/workspace.

### Revoke access

```http
DELETE /api/v2/apps/{app_id}/access/{user_id}
```

Permission: `apps:edit`

The app owner cannot be removed from the access list.

---

## Optional preview image APIs

These upload a thumbnail image, not the app bundle.

### Initialize preview image upload

```http
POST /api/v2/apps/{app_id}/preview/upload/init
```

Permission: `apps:edit`

Response:

```json
{
  "data": {
    "upload_url": "https://presigned-upload-url...",
    "upload_key": "apps/<tenant>/<app>/uploads/preview-<uuid>.png"
  },
  "status": 200
}
```

### Complete preview image upload

```http
POST /api/v2/apps/{app_id}/preview/upload/complete
Content-Type: application/json
```

Permission: `apps:edit`

```json
{
  "upload_key": "apps/<tenant>/<app>/uploads/preview-<uuid>.png"
}
```

Preview image max size: **5 MB**.

---

## End-to-end deployment script

This is a minimal deploy script that creates the app if missing, uploads a bundle, and activates the new version.

Requirements: `bash`, `curl`, `jq`.

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?Set BASE_URL, e.g. https://tenant.example.com}"
: "${API_KEY:?Set API_KEY}"
: "${APP_NAME:?Set APP_NAME}"
: "${BUNDLE:?Set BUNDLE, e.g. ./dist/my-app-1.0.0.zip}"

VERSION="${VERSION:-$(date -u +%Y%m%d-%H%M%S)}"
APP_DESCRIPTION="${APP_DESCRIPTION:-Deployed via Apps API}"

api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "X-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "X-api-key: $API_KEY" \
      -H "Content-Type: application/json"
  fi
}

slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

APP_SLUG="$(slugify "$APP_NAME")"

echo "Resolving app '$APP_NAME' / '$APP_SLUG'..."
apps_resp="$(api_json GET "/api/v2/apps?include_archived=true")"
APP_ID="$(echo "$apps_resp" | jq -r --arg name "$APP_NAME" --arg slug "$APP_SLUG" '
  .data[]? | select(.name == $name or .slug == $slug) | .id
' | head -n1)"

if [[ -z "$APP_ID" || "$APP_ID" == "null" ]]; then
  echo "Creating app..."
  create_body="$(jq -nc --arg name "$APP_NAME" --arg desc "$APP_DESCRIPTION" '{name:$name, description:$desc}')"
  create_resp="$(api_json POST "/api/v2/apps" "$create_body")"
  APP_ID="$(echo "$create_resp" | jq -r '.data.id')"
  APP_SLUG="$(echo "$create_resp" | jq -r '.data.slug')"
fi

echo "App ID: $APP_ID"
echo "Version: $VERSION"

FILE_NAME="$(basename "$BUNDLE")"
FILE_SIZE="$(wc -c < "$BUNDLE" | tr -d ' ')"

init_body="$(jq -nc \
  --arg version "$VERSION" \
  --arg file_name "$FILE_NAME" \
  --arg content_type "application/zip" \
  --argjson file_size "$FILE_SIZE" \
  '{version:$version, file_name:$file_name, content_type:$content_type, file_size:$file_size}')"

init_resp="$(api_json POST "/api/v2/apps/$APP_ID/upload/init" "$init_body")"
UPLOAD_URL="$(echo "$init_resp" | jq -r '.data.upload_url')"
UPLOAD_KEY="$(echo "$init_resp" | jq -r '.data.upload_key')"

echo "Uploading bundle to presigned URL..."
curl -fsS -X PUT \
  -H "Content-Type: application/zip" \
  --upload-file "$BUNDLE" \
  "$UPLOAD_URL"

echo "Completing upload..."
complete_body="$(jq -nc --arg version "$VERSION" --arg upload_key "$UPLOAD_KEY" '{version:$version, upload_key:$upload_key}')"
complete_resp="$(api_json POST "/api/v2/apps/$APP_ID/upload/complete" "$complete_body")"
VERSION_ID="$(echo "$complete_resp" | jq -r '.data.id')"

echo "Activating version $VERSION_ID..."
api_json PUT "/api/v2/apps/$APP_ID/versions/$VERSION_ID/activate" >/dev/null

echo "Done."
echo "Internal app URL: $BASE_URL/apps/$APP_SLUG"
echo "App ID: $APP_ID"
echo "Version ID: $VERSION_ID"
```

Run:

```bash
BASE_URL="https://<tenant-site>" \
API_KEY="<tenant-api-key>" \
APP_NAME="Operations Console" \
BUNDLE="./dist/operations-console-1.0.0.zip" \
VERSION="$(git rev-parse --short HEAD)" \
bash deploy-wonderful-app.sh
```

---

## External share-link script

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?Set BASE_URL}"
: "${API_KEY:?Set API_KEY}"
: "${APP_ID:?Set APP_ID}"
: "${FUNCTION_ID:?Set FUNCTION_ID}"

EXPIRES_IN="${EXPIRES_IN:-86400}"

api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "X-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "X-api-key: $API_KEY" \
      -H "Content-Type: application/json"
  fi
}

echo "Enable anonymous access..."
api_json PUT "/api/v2/apps/$APP_ID" '{"anonymous_access_enabled":true}' >/dev/null

echo "Attach function resource..."
attach_body="$(jq -nc --arg function_id "$FUNCTION_ID" '{resource_type:"function", resource_ref:$function_id, relationship:"linked", required:true}')"
api_json POST "/api/v2/apps/$APP_ID/resources" "$attach_body" >/dev/null

echo "Mint share token..."
session_body="$(jq -nc --argjson expires_in "$EXPIRES_IN" '{expires_in:$expires_in}')"
session_resp="$(api_json POST "/api/v2/apps/$APP_ID/asset-session" "$session_body")"
TOKEN="$(echo "$session_resp" | jq -r '.data.token')"
EXPIRES_AT="$(echo "$session_resp" | jq -r '.data.expires_at')"

echo "Share URL: $BASE_URL/app-view/?access_token=$TOKEN"
echo "Expires at (Unix seconds): $EXPIRES_AT"
```

---

## Deploying to multiple tenant sites

Use the same zip and version label for every site, but a different `BASE_URL` and `API_KEY` per tenant.

Example deployment matrix:

```json
[
  {
    "name": "dev",
    "base_url": "https://dev-tenant.example.com",
    "api_key_env": "DEV_API_KEY"
  },
  {
    "name": "staging",
    "base_url": "https://staging-tenant.example.com",
    "api_key_env": "STAGING_API_KEY"
  },
  {
    "name": "prod",
    "base_url": "https://prod-tenant.example.com",
    "api_key_env": "PROD_API_KEY"
  }
]
```

Recommended version labels:

- Git SHA: `app-$(git rev-parse --short HEAD)`
- Semver: `1.4.2`
- Date build: `2026.05.14.1`

Operational advice:

- Create the app independently in each tenant and store each tenant's `app_id` in CI/CD variables.
- If you prefer app-name resolution, resolve by `slug`/`name` first, then use the returned UUID for upload/activation.
- Activate only after complete upload succeeds.
- To promote from staging to production, use the exact same zip artifact, not a rebuild.
- Rollback is just activating a previous version.

---

## Existing CLI support in the repo

The monorepo already contains internal CLI commands that use this API:

```bash
controller-cli apps list
controller-cli apps create --name "Northstar CRM" --description "Sales CRM demo"
controller-cli apps upload --app northstar-crm-demo --bundle ./dist/app.zip --version v0.1.0 --activate=true
controller-cli apps versions list --app northstar-crm-demo
controller-cli apps versions activate --app northstar-crm-demo --version v0.1.0
controller-cli apps asset-session --app northstar-crm-demo
controller-cli apps resources attach --app northstar-crm-demo --type function --ref <function-id>
```

The important part is not the CLI itself; the CLI confirms the API flow:

- `POST /api/v2/apps/{id}/upload/init`
- presigned `PUT`
- `POST /api/v2/apps/{id}/upload/complete`
- `PUT /api/v2/apps/{id}/versions/{version_id}/activate`

If the public Wonderful CLI does not expose these commands yet, adding first-class app deployment would be mostly a wrapper around the API documented above.

---

## Common errors and fixes

### `403 Forbidden`

Likely causes:

- API key/user lacks `apps:edit` for deployment endpoints.
- API key/user only has `apps:view`.
- Trying to mint `version_id` or `expires_in` asset session without `apps:edit`.
- Trying to attach resources without `apps:edit`.

### `404 app not found`

Likely causes:

- Wrong tenant/site/API key.
- App ID from a different tenant.
- Caller cannot view the restricted app.
- Using slug on an endpoint that expects UUID in lower-level upload code. Resolve slug first, then use UUID.

### `bundle exceeds maximum size of 100MB`

Reduce bundle size or remove large bundled assets. The server checks `file_size` at init and object metadata at complete.

### `dist/app.js not found` before upload

The official package script refuses to package without `dist/app.js`. Run:

```bash
pnpm build
pnpm package
```

### Uploaded app shows blank/error page

Likely causes:

- Zip root does not contain `app.js`.
- `app.js` does not default-export a React component.
- Missing host-shared externals in `vite.config.ts`, causing duplicate React/router instances.
- Added a package to Vite `external` that the host does not provide.
- Bundled code references `process.env.NODE_ENV` without Vite `define` substitution.

### `share links require anonymous access to be enabled for this app`

You called asset-session with `expires_in` before enabling anonymous access:

```json
{ "anonymous_access_enabled": true }
```

### External app can load but function calls fail

Check:

- Function is attached to the app as `resource_type: "function"`.
- You minted a fresh share token after initial setup.
- App code calls `api.invokeFunction("function-slug", ...)`, not raw `api.get/post`.
- Function slug is the path slug, not necessarily the function display name.

---

## Implementation notes for a future public CLI

A polished external app deployment command could be:

```bash
wonderful apps deploy \
  --app "Operations Console" \
  --bundle ./dist/operations-console.zip \
  --version "$(git rev-parse --short HEAD)" \
  --env prod \
  --activate
```

Internally it should:

1. Read target environment config (`BASE_URL`, tenant, API key).
2. Build/package if requested.
3. List apps and resolve by name/slug.
4. Create app if missing unless `--no-create`.
5. Call upload init.
6. Upload to presigned URL.
7. Call upload complete.
8. Optionally activate.
9. Print internal URL and version ID.
10. Optionally enable external sharing and mint a link.

Recommended safety flags:

- `--activate=false` for dry upload/preview.
- `--version` required in CI.
- `--expect-app-id` to prevent accidentally deploying to a same-named app in the wrong tenant.
- `--max-size` local precheck below 100 MB.
- `--external --function <id>` to configure share-link functions explicitly.
- `--json` for CI output.

---

## Quick checklist

Before deployment:

- [ ] App builds locally: `pnpm build`.
- [ ] Package exists and includes root `app.js` and `manifest.json`.
- [ ] Bundle size is under 100 MB.
- [ ] Target tenant API key has `apps:edit`.
- [ ] Version label is deterministic.
- [ ] App ID is resolved in the target tenant, not copied from another tenant.

After deployment:

- [ ] `GET /api/v2/apps/{id}` shows `active_version_id` equal to the deployed version.
- [ ] `/apps/<slug>` loads for a tenant user.
- [ ] If external: `anonymous_access_enabled` is true.
- [ ] If external: required functions are attached as resources.
- [ ] External URL `/app-view/?access_token=...` loads.
- [ ] External app only uses `api.invokeFunction(...)`.
