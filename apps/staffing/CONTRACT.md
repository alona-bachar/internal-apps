# Pod Staffing — Function & Schema Contract

Captured during Step 1c audit. Single source of truth: the tables.

## Backing function

- **Slug (current):** `pod-staffing-data-v109`
- **Function ID:** `89722c43-8254-4a20-bd35-d54f8abdf67a`
- **Flow ID:** `c0efffd3-f609-449d-b672-bfb84327fd1c`
- **Method:** POST
- **Body params:** `action: string (required)`, `payload: string (optional, JSON object)`

## Action contract

Every action writes to a named table — no KV, no in-memory side state.

| Action | Tables written | Tables read | Notes |
|---|---|---|---|
| `load` | — | `pods`, `people`, `pod_assignments`, `pod_staffing_by_week` | Paginated; returns `{pods, people, assignments, weekly}` |
| `createPod` | `pods`, `pod_staffing_by_week` | — | Also seeds an empty weekly row with same `id`. Falls back gracefully if weekly insert fails. |
| `createPerson` | `people` | — | Email is currently set if provided; no enforcement. |
| `createAssignment` | `pod_assignments` | — | Sets `status="Open"` and `person_id=null` if `is_open_slot`. |
| `updateAssignment` | `pod_assignments` | — | Forces `person_id=null` when `status==="Open"`. |
| `deleteAssignment` | `pod_assignments` | — | Hard delete. |
| `updatePerson` | `people` | — | Cleans dates and strings. |
| `updatePipelineField` | `people` | — | Allow-listed fields only; arbitrary writes rejected. |

## Pending function changes (deferred to Step 3 / v2 cutover)

1. **Conditional email rule** — reject `createAssignment` and any cert-field write when target person has empty `email`. Error code `EMAIL_REQUIRED`.
2. **Server-minted UUIDs** — replace `normalizeId(payload.id || ...)` with UUID v4. Eliminates name-collision IDs.
3. **Stable slug** — rename `pod-staffing-data-v109` → `pod-staffing-data` (or version internally).
4. **`updated_at` on every mutation** — add column to `people` and `pods`; populate consistently.

## Table schemas (read 2026-05-19)

### `pods` (3 cols, 43 rows)
- `id` *(string, PK, required)*
- `tier` *(string, required)*
- `pod_name` *(string, required)*

### `people` (18 cols, 84 rows)
- `id` *(string, PK, required)*
- `first_name` *(string, required)*
- `last_name` *(string)*
- **`email`** *(string, **optional in schema**)*
- `role` *(string, required)*
- `status` *(string, required)*
- `expected_start_date` *(date)*
- `certification_status` *(string)*
- `vacation_until` *(date)*
- `notes` *(string)*
- `cert1_status`, `cert1_date`, `cert2_status`, `cert2_date`, `cert3_status`, `cert3_date`
- `move_to_pod_id` *(string)* — references `pods.id`
- `move_date` *(date)*
- **No `updated_at`** — must add in Step 3 for optimistic-reconciliation keying.

### `pod_assignments` (8 cols, 133 rows)
- `id` *(string, PK, required)*
- `pod_id` *(string, required)* — references `pods.id`
- `person_id` *(string, optional)* — `null` represents an open slot
- `role` *(string, required)*
- `status` *(string, required)* — `Active|Backup|Onboarding|Leaving|Open`
- `is_primary` *(boolean)*
- `notes` *(string)*
- `last_updated` *(date)* — populated on every mutation

### `pod_staffing_by_week` (37 cols, 40 rows)
- `id` *(string, PK, required)* — equal to `pod_id`
- `pod_id` *(string, required)*
- `account_id` *(string)*
- `deployment_strategist_goal` *(string)*
- **Per-week columns** (string): `ds_week_YYYY_MM_DD` and `fde_week_YYYY_MM_DD` for each tracked week (15 DS weeks + 16 FDE weeks currently, Feb 2026 – May 2026).
- `fde_missing_count` *(number)*
- `total_fde_needed` *(number)*
- `notes` *(string)*
- `last_updated` *(date)*

**Note:** the model is row-per-pod with week-named columns. Adding new weeks requires `tables columns add` for both `ds_week_<date>` and `fde_week_<date>`.

## Validation rules currently enforced (server)

- `createPod`: `pod_name` required.
- `createPerson`: `first_name` required.
- `createAssignment`: `pod_id` required; `person_id` required unless open slot.
- `updateAssignment`, `updatePerson`, `updatePipelineField`, `deleteAssignment`: `row_id` required.
- `updatePipelineField`: field name must be in allow-list (17 fields).

## Validation rules NOT yet enforced (Step 3 targets)

- Email required for `createAssignment` against email-less person.
- Email required when any cert field is being set.
- Status transitions sanity (e.g. cannot move `Inactive` → `Onboarding` without explicit reactivation).
- `pod_id` and `person_id` must reference existing rows.
