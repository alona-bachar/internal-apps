# Wonderful Custom Tables — Reference

Tenant-scoped relational tables for app data, with HTTP CRUD plus an in-function SDK that supports more operations than the HTTP layer.

## Endpoints

```
POST   /api/v1/custom-tables                              create table
GET    /api/v1/custom-tables                              list tables
GET    /api/v1/custom-tables/{name}                       get table (with column metadata)
PUT    /api/v1/custom-tables/{name}                       update name/description (NOT columns reliably — see below)
DELETE /api/v1/custom-tables/{name}                       drop table

GET    /api/v1/custom-tables/{name}/rows                  list rows
GET    /api/v1/custom-tables/{name}/rows/{row_id}         get row by PK value
POST   /api/v1/custom-tables/{name}/rows                  insert  {data: {...}}
PUT    /api/v1/custom-tables/{name}/rows/{row_id}         update  {data: {...}}
DELETE /api/v1/custom-tables/{name}/rows/{row_id}         delete

POST   /api/v1/custom-tables/{name}/rows/{row_id}/atomic-increase   {column, amount}
POST   /api/v1/custom-tables/{name}/rows/{row_id}/atomic-decrease   {column, amount}
POST   /api/v1/custom-tables/{name}/semanticSearch        {query, column, top_k, min_score?, metric?}
```

## Create-table request

```json
{
  "name": "my_table",
  "description": "...",
  "columns": [
    { "name": "id",          "type": "string", "required": true },
    { "name": "owner_email", "type": "string", "required": false },
    { "name": "amount",      "type": "number" },
    { "name": "approved",    "type": "boolean" },
    { "name": "due_date",    "type": "date" },
    { "name": "embedding",   "type": "vector" }
  ]
}
```

Column types: `string | number | boolean | date | vector | big_vector`.
- `vector` → 1536 dims, embedded with `text-embedding-3-small`.
- `big_vector` → 3072 dims, embedded with `text-embedding-3-large`.
- `string` → Postgres `text`; `number` → `double precision`; `boolean` → `boolean`; `date` → `date`.
- There is NO native JSON column. Serialize structured data as a `string` (and parse on read).

## **CRITICAL — primary-key auto-promotion**

The controller hardcodes the FIRST column in `columns[]` as the PRIMARY KEY, regardless of any `primary_key: true` field in the request (see `wonderful-controller/components/custom_tables/service/service.go:430`):

```go
if i == 0 {
    def += " PRIMARY KEY"
}
```

Consequences:
- The `primary_key` field in `CustomTableColumn` is **informational only** when reading. It's not honored on create.
- If your first column is `communication_id` and you want many rows per comm → you can't. Every insert with a repeat value fails with `duplicate key value violates unique constraint ..._pkey (SQLSTATE 23505)`.
- The `id` field returned by `tables.insert(...)` is the value of the PK column, not a separately auto-generated UUID.

**Fix pattern:** put an explicit `id` column at position 0 and generate the UUID in your function code:

```ts
const newId = crypto.randomUUID();
await context.tables.insert("my_table", { id: newId, /* other fields */ });
// Use newId everywhere else as the row's PK.
```

## **CRITICAL — HTTP filter limitation**

The HTTP `GET /rows` endpoint only honors a magic `text` filter (full-text search over string columns). Column-level filters in the `filters=` query string are **silently dropped**.

```sh
# This filter is IGNORED at the HTTP layer. The endpoint returns all rows.
GET /api/v1/custom-tables/runs/rows?filters=%5B%7B%22column%22%3A%22status%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%22error%22%7D%5D
```

(Controller path: `buildRowsTextSearchWhereClause` in `service.go` only looks for a filter named "text".)

**Workarounds:**
1. **Client-side filter** — fetch all rows (or a large page) and filter in JS.
2. **In-function `context.tables.filter(...)`** — fully supports column filters with operators (`eq, neq, starts_with, ends_with, contains, gt, gte, lt, lte, in, is_null, is_not_null`). Wrap in a Wonderful Function and call that from your app instead of hitting the HTTP /rows endpoint.
3. **Page-and-merge** — accept that you fetch up to a few hundred rows and filter client-side. Fine for app dashboards; not for high-cardinality data.

## **CRITICAL — column schema is mostly immutable**

`PUT /api/v1/custom-tables/{name}` updates `name` and `description`. Adding a column may work (controller has `ALTER TABLE ADD COLUMN`), but **renaming, retyping, or marking a column as PK after the fact is not supported**.

To fix a column-layout mistake: `DELETE` the table and recreate it. Row data is lost.

## Insert / response shape

```http
POST /api/v1/custom-tables/{name}/rows
{ "data": { "id": "...", "communication_id": "...", "status": "queued" } }
```

Response:

```json
{
  "data": {
    "id": "value-of-PK-column",
    "data": { ...all fields... },
    "created_at": 1778921644277,
    "updated_at": 1778921644277
  },
  "status": 200
}
```

`created_at` / `updated_at` are bigint epoch milliseconds, auto-managed by the controller.

## Filter wire format (in-function only)

When using `context.tables.filter(tableName, filters, limit, offset, orderBy?)`:

```ts
await context.tables.filter("runs", [
  { column: "status",        operator: "eq",         value: "done" },
  { column: "started_at",    operator: "gte",        value: "2026-05-15" },
  { column: "communication_id", operator: "in",      value: ["uuid1", "uuid2"] },
  { column: "error",         operator: "is_null" },
], 100, 0, [{ column: "created_at", direction: "desc" }]);
```

- `value` is JSON-encoded by the SDK for `in`; ignored for `is_null` / `is_not_null`.
- `value` is forced to a string for all other operators.

## Aggregations and distinct (in-function only)

```ts
await context.tables.aggregate("orders", {
  aggregation: "sum", column: "amount",
  groupBy: "customer_id",
  filters: [{ column: "status", operator: "eq", value: "paid" }],
});
// → { "customer-id-1": 12345, "customer-id-2": 6789, ... }

await context.tables.distinct("orders", "status");
// → ["paid", "pending", "refunded"]

await context.tables.count("orders", [
  { column: "status", operator: "eq", value: "error" },
]);
// → 7
```

## Semantic search

```http
POST /api/v1/custom-tables/{name}/semanticSearch
{
  "query":  "anomaly about billing",
  "column": "evidence_embedding",
  "top_k":  10,
  "min_score": 0.3,
  "metric": "cosine"
}
```

Or in-function:

```ts
await context.tables.semanticSearch("docs", "billing anomaly", "embedding", {
  topK: 10, minScore: 0.3, metric: "cosine",
});
```

Vector columns are auto-embedded on write — when you insert `{ description: "..." }` into a row whose `description` column has type `vector`, the controller computes the embedding and stores it in a companion column. You don't pre-compute embeddings on the client.

## Things to avoid

- Naming the first column anything except a unique-per-row identifier.
- Using the HTTP `filters=` query param for column filters — it does nothing.
- Storing structured JSON in a column that you'll later want to query — there's no JSON path support; you have to fetch the row and parse client-side.
