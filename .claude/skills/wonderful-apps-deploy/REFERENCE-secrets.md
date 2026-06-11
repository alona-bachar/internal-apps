# Wonderful Secrets Manager — Reference

Tenant-scoped secrets store. Used by Functions / cron / tools / agents via `context.secrets.get(name)`.

## Endpoints

```
GET    /api/v1/secrets                  list secrets (values redacted)
POST   /api/v1/secrets                  create
GET    /api/v1/secrets/{id}             get by id
PUT    /api/v1/secrets/{id}             update
DELETE /api/v1/secrets/{id}             delete

GET    /api/v1/secret-types              list available secret types
GET    /api/v1/secret-types/{id}         get type schema
```

## Request shape

```json
{
  "name":        "GEMINI_API_KEY",
  "type_id":    "748ece8f-53ef-456e-83b9-624fdf823bb9",
  "description": "Google AI Studio key for Gemini",
  "value":       { "token": "AIza..." }
}
```

`name` — global within the tenant; this is what `context.secrets.get(name)` resolves against. Use UPPER_SNAKE_CASE by convention.

`type_id` — pick the matching secret type. Common ones at the time of writing:

| Type | UUID | `value` shape |
|---|---|---|
| API Key            | `748ece8f-53ef-456e-83b9-624fdf823bb9` | `{"token": "..."}` (or a raw string) |
| AWS Credentials    | `88a7523d-4b24-4ce4-9bc5-023ebfec6249` | `{access_key_id, secret_access_key, region?}` |
| Azure Storage      | `4e25142d-3185-429b-b828-378178f9fc0c` | provider-specific |
| Basic Auth         | `148a9850-7134-43ad-821d-504a512edfc6` | `{username, password}` |
| Bearer Token       | `875d5ffa-d59e-4afa-98b7-1cb325b5f32e` | `{token}` |
| Certificate        | `a15f79da-19a7-4ef3-afef-ec8a24ee72d6` | `{cert, key}` |
| ElevenLabs         | `bdd7d7e0-b5d5-4950-b197-d71660f9c23c` | provider-specific |
| GCP Service Account| `c960fd96-212f-457e-951e-f1e938dbf7df` | service account JSON |
| HTTP Headers       | `440fce53-baf8-43f2-8ef7-7337812e245c` | `{headers: [...]}` for header injection |
| LiveKit            | `d8aa519f-1b76-499f-8677-b12c60ed7d8a` | provider-specific |

Hit `GET /api/v1/secret-types` to discover the current full list.

## Reading a secret from inside a function

```ts
const apiKey = context.secrets.get("GEMINI_API_KEY");
```

The wrapper parses the stored JSON and returns it. For "API Key" secrets stored as `{token: "..."}`, the returned object has shape `{ token: "AIza..." }`. Most code paths unwrap to a string:

```ts
function secretString(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.token === "string") return v.token;
  return String(v);
}
```

Use the unwrapped string for things like `Authorization: Bearer ${secretString(...)}` or a query-string API key.

For `fetch`'s `secretName` option (host-mediated injection via the runner proxy), pass the **secret name**, not the value:

```ts
await fetch(url, { secretName: "MY_BEARER_SECRET" });
```

The runner proxy resolves the secret server-side and adds the appropriate auth header before forwarding the request.

## Upsert pattern from a provisioning script

```sh
#!/usr/bin/env bash
BASE=...
KEY=...   # tenant API key with secrets:create / secrets:edit
TYPE_API_KEY=748ece8f-53ef-456e-83b9-624fdf823bb9

upsert_secret() {
  local NAME="$1" VALUE_JSON="$2" DESC="$3"
  EXISTING=$(curl -fsS -H "X-api-key: $KEY" "$BASE/api/v1/secrets" \
    | jq -r --arg n "$NAME" '[.data[]? // .[] | select(.name == $n)][0].id // empty')
  if [ -n "$EXISTING" ]; then
    curl -fsS -X PUT -H "X-api-key: $KEY" -H "Content-Type: application/json" \
      "$BASE/api/v1/secrets/$EXISTING" \
      -d "$(jq -nc --argjson v "$VALUE_JSON" --arg d "$DESC" '{value:$v, description:$d}')"
  else
    curl -fsS -X POST -H "X-api-key: $KEY" -H "Content-Type: application/json" \
      "$BASE/api/v1/secrets" \
      -d "$(jq -nc --arg n "$NAME" --arg t "$TYPE_API_KEY" --arg d "$DESC" --argjson v "$VALUE_JSON" \
            '{name:$n, type_id:$t, description:$d, value:$v}')"
  fi
}

upsert_secret "GEMINI_API_KEY"     "$(jq -nc --arg t "$GEMINI_KEY" '{token:$t}')"  "Gemini key"
upsert_secret "WONDERFUL_BASE_URL" "$(jq -nc --arg t "$BASE"       '{token:$t}')"  "Tenant URL"
upsert_secret "WONDERFUL_API_KEY"  "$(jq -nc --arg t "$KEY"        '{token:$t}')"  "Tenant key"
```

## Things to know

- Listing secrets does NOT return `value`. The `value` field is only ever returned encrypted/scrubbed. Treat secret values as write-only.
- A secret can be deleted any time; functions that reference it via `context.secrets.get(name)` will then receive `null` until it's restored.
- `name` is a unique key per tenant. If you want to rotate, PUT the existing secret with a new `value`. Don't delete-and-create — any cached references die in the interim.
- For runners / agents that hit external APIs with strict ToS, prefer the `fetch({secretName})` host-injected path over reading the secret into your code, so the value never leaves the host process.
