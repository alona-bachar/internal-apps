# Pod Staffing v2 — Design

Audience: CTO office (you). Purpose: align on the v2 information architecture, key states, and per-action behavior *before* code is written. Approve / comment inline.

---

## 1. Goals

- **Single source of truth.** Every change in the app immediately updates the corresponding row in `pods` / `people` / `pod_assignments` / `pod_staffing_by_week`. The UI mirrors the tables; tables are canonical.
- **Weekly workflow first.** Six core actions, each reachable in ≤2 clicks: add person, update status, verify onboarding, assign to pod, document pod transition, offboard.
- **Gap visibility without clicking.** A pod's coverage gaps must be apparent from the pod list, not hidden in detail panels.
- **Keep the two-tab structure**, deepen the separation inside each tab. Tab bar must be additive for future tabs (Projects, Go-lives).

## 2. Non-goals (this iteration)

- Mobile. Wide-screen first; degrades to ~1280px laptop layout. Below that: usable but compact.
- Multi-tenant access controls.
- Persistent audit log.
- Weekly *planning* grid as a separate tab — `pod_staffing_by_week` data appears inline in the pod detail.

---

## 3. Global shell

```
┌─ App shell ────────────────────────────────────────────────────────────────┐
│  [Pod Staffing]            [ Client Coverage | Human Pipeline ]   [Refresh]│
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   <Active tab content>                                                     │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Tab nav:** sourced from a single `TABS` config array. Adding Projects / Go-lives later = one entry, one component.
- **Refresh button:** explicit manual reload. Auto-refresh on focus is retained but suppressed while any modal is open.
- **Persistent toasts:** success notice top-right (auto-dismiss 3.5s); error banner inline at the top of the active tab (manual dismiss).

---

## 4. Tab 1 — Client Coverage

### 4.1 Layout

```
┌─ Tab 1 ──────────────────────────────────────────────────────────────────────┐
│ ┌─ Stats strip ──────────────────────────────────────────────────────────┐   │
│ │ [42 Clients]  [28 Staffed]  [14 Gaps]   |   34 Open slots (read-only) │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│ ┌─ Toolbar ──────────────────────────────────────────────────────────────┐   │
│ │ Search... | Tier ▾ | [All|Gaps|Changes|Staffed] | Sort ▾  [+New client]│   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│ ┌─ Pod list (left, ~32%) ──────┐  ┌─ Pod detail (right, ~68%) ──────────┐    │
│ │ ◉ Acme Corp                  │  │  Acme Corp · Tier 1                 │    │
│ │   Tier 1 · 1 DS · 2 FDE      │  │  ─ Roster ────────────────────────  │    │
│ │   ● 1 gap                    │  │   DS    │   FDE                     │    │
│ │ ─────────────────────────    │  │   Dani  │   Liat                    │    │
│ │   BetaCo                     │  │         │   Open · [Fill]           │    │
│ │   Tier 2 · 0 DS · 3 FDE      │  │  ─ Gaps ──────────────────────────  │    │
│ │   ● 2 gaps                   │  │   • No DS assigned  [Assign DS]    │    │
│ │   ...                        │  │   • 1 open FDE slot [Assign FDE]   │    │
│ │                              │  │  ─ Transitions (next 30 days) ────  │    │
│ │                              │  │   Incoming: Maya (2026-06-01)       │    │
│ │                              │  │   Outgoing: Liat → BetaCo (06-15)  │    │
│ │                              │  │  ─ This week (May 17, 2026) ──────  │    │
│ │                              │  │   DS coverage: [editable text]      │    │
│ │                              │  │   FDE coverage: [editable text]     │    │
│ │                              │  │   Missing FDEs: [number]            │    │
│ │                              │  │   Total FDE need: [number]          │    │
│ │                              │  │   Goal: [textarea]                  │    │
│ │                              │  │   Notes: [textarea]                 │    │
│ └──────────────────────────────┘  └─────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Stats strip

| Stat | Behavior |
|---|---|
| Total clients | Click → set filter "all" |
| Fully staffed | Click → set filter "staffed" |
| Clients with gaps | Click → set filter "gaps" |
| Open slots | Read-only count (not a filter) |

The current "Clients at a glance" duplicate-grid card is **removed** — it duplicates the left list.

### 4.3 Pod list (left)

- Sorted by current sort order (tier / name / gap count).
- Card shows: pod name, tier, DS count, FDE count, gap badge (red dot + count, or green "OK").
- Selecting a card scrolls the detail to top and persists `selectedPodId` in URL state.

### 4.4 Pod detail (right) — 4 sub-sections

#### 4.4.1 Roster
- Two columns: DS / FDE. Each column shows assignment cards.
- **Open slot variant:** dashed border, "Open slot" label, single "[Fill]" button (opens Assign modal pre-filled with `pod_id` + `role`).
- **Filled card:** identity, role, primary chip, status chip, inline notes. Clicking the card opens the Edit Assignment modal.
- Inline-edit status via dropdown on each card (debounced commit, optimistic).

#### 4.4.2 Gaps
- Explicit list, one row per missing role or open slot.
- Each row: short description ("No DS assigned" / "1 open FDE slot at status Open"), plus a CTA button ("Assign DS" / "Assign FDE").
- If no gaps: green pill "Fully staffed."

Gap definition:
- `dsGaps = openDsSlots` (Open-status DS assignments) + (0 if any filled DS, else 1)
- `fdeGaps = openFdeSlots + (0 if any filled FDE, else 1)`
- `weeklyMissing = pod_staffing_by_week.fde_missing_count for this pod`
- `total = dsGaps + fdeGaps + weeklyMissing`

#### 4.4.3 Transitions (next 30 days)
Derived from people rows. **Read-only on the pod side** — all editing happens on the person card.

- **Incoming:** people with `move_to_pod_id == this pod` AND `move_date <= today+30d`. Show name, source pod (derived from current active assignment), move date.
- **Outgoing:** active assignments at this pod where the person has `move_to_pod_id` set OR person `status == "Leaving"`. Show name, destination pod (or "Leaving the company"), date.

#### 4.4.4 This week
- Schema: `pod_staffing_by_week` is one row per pod with per-week columns (e.g. `ds_week_2026_05_17`, `fde_week_2026_05_17`).
- "This week" finds the current Monday-week and reads/writes those two columns.
- Inline-editable: `deployment_strategist_goal`, `ds_week_<current>`, `fde_week_<current>`, `fde_missing_count`, `total_fde_needed`, `notes`.
- "Last updated" timestamp shown muted at bottom.
- **OPEN QUESTION 1:** if the current week's columns don't exist yet on the schema (we run out of pre-created weeks at `2026_05_31`), what should happen? Options: (a) auto-`tables columns add` from the function; (b) freeze on the latest available week; (c) show a one-click "Add next week" button in the UI for admins. **Default: (b)** — show the latest week the schema has + a banner "Schema needs new week column for [date]" so we don't silently fail.

---

## 5. Tab 2 — Human Pipeline

### 5.1 Layout

```
┌─ Tab 2 ──────────────────────────────────────────────────────────────────────┐
│ ┌─ Stats strip (each clickable = filter) ──────────────────────────────┐    │
│ │ [12 Onboarding] [58 Active] [4 Moving] [2 Leaving] [8 Inactive]      │    │
│ └──────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Toolbar ────────────────────────────────────────────────────────────┐    │
│ │ Search... | Onboarding|Active|Moving|Leaving|Inactive  [+New person] │    │
│ └──────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Person card list ───────────────────────────────────────────────────┐    │
│ │  ┌────────────────────────────────────────────────────────────────┐  │    │
│ │  │ Maya Cohen                                       [Edit]        │  │    │
│ │  │ maya@…  ·  Forward Deployed Engineer                            │  │    │
│ │  │ Attached to: Acme Corp                                          │  │    │
│ │  │ Status: [Onboarding ▾]    Expected start: [2026-06-01]         │  │    │
│ │  │  ── Certification ──                                            │  │    │
│ │  │   ● ● ○   Cert 1 Passed · Cert 2 Passed · Cert 3 Not scheduled │  │    │
│ │  └────────────────────────────────────────────────────────────────┘  │    │
│ │  ┌─ Card for Move-planned person (different sub-section) ─────────┐  │    │
│ │  │ Liat Bar                                                        │  │    │
│ │  │ Status: Move to other client    Move plan:                      │  │    │
│ │  │   To: [BetaCo ▾]   Move date: [2026-06-15]                      │  │    │
│ │  └────────────────────────────────────────────────────────────────┘  │    │
│ │                                                                       │    │
│ │  ┌─ Card for email-less person ───────────────────────────────────┐  │    │
│ │  │ Roni Nahum                       ⚠ Email needed before pod/cert│  │    │
│ │  │ <no email>  ·  Forward Deployed Engineer                       │  │    │
│ │  │ Status: [Active ▾]                                              │  │    │
│ │  │ [Edit] (Assign + Cert controls disabled)                       │  │    │
│ │  └────────────────────────────────────────────────────────────────┘  │    │
│ └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Stats strip = segment selector
- Stat values become the segmented control's options.
- Default segment: Onboarding (highest-attention bucket weekly).
- "All" is **not** an option — keep the segments focused. Use search to find someone across segments.

### 5.3 Person card — status-adaptive content

Common to all: identity, email-or-warning, role (in long form), attached pods, status dropdown (optimistic commit on change), `[Edit]` opens full Edit Person modal.

| Status | Extra inline content |
|---|---|
| Onboarding | Cert progress dots + "Expected start" date input |
| Active | (just the common content) |
| Move to other client | Inline target pod + move date inputs |
| Leaving | "Last updated" date shown muted (no end-date column today; see OPEN QUESTION 2) |
| Inactive | Read-only card + `[Reactivate]` action |

### 5.4 Cert progress dots
- Three dots: cert1, cert2, cert3. Color/glyph:
  - `○` = empty / "Not Scheduled" / null
  - `◐` = "Scheduled" / "Scheduled 1/2/3" / "In Progress"
  - `●` = "Passed"
  - `✕` = "Failed" / "Blocked"
- Hovering shows the literal status + date.
- Clicking opens a small popover with three dropdown rows (cert N status + date).
- **Hard-gated by email:** if `person.email` is empty, dots are rendered but unclickable, with the warning tooltip.

### 5.5 Sort within a segment

| Segment | Default sort |
|---|---|
| Onboarding | `expected_start_date` asc |
| Active | role then name |
| Move to other client | `move_date` asc |
| Leaving | `last_updated` desc (proxy until we add an end date) |
| Inactive | name asc |

---

## 6. Cross-cutting actions

Single entry per action. All actions are optimistic + reconcile-against-server.

### 6.1 Add person
**Modal fields (minimal):**
- First name (required)
- Last name (optional)
- Email (**optional** — helper text: "Required later before pod assignment or onboarding cert")
- Role (required, select from `PERSON_ROLES`)
- Status (required, default "Active")

After submit:
1. Optimistic insert into local `people` state.
2. POST `createPerson`.
3. On success: replace optimistic row with server's row. Open the person's Edit modal so the rest of the fields can be filled.
4. On error: roll back, show error in modal.

### 6.2 Add client
Modal: name, tier. Same flow. After success: select the new pod in Tab 1.

### 6.3 Assign person to pod
Modal opened from:
- Tab 1 → Roster open-slot "Fill"
- Tab 1 → Gaps row "Assign"
- Tab 2 → Person card menu "Assign to pod"
- Top header "Add DS/FDE" (current button)

**Modal fields:**
- Pod (required, pre-filled if launched from a pod)
- Open slot toggle (mutually exclusive with person)
- Person (required if not open slot — **disabled options for email-less people**, with inline reason)
- Role (DS / FDE, pre-filled if launched from a gap)
- Status (default Active; forced Open if open-slot toggle on)
- Primary toggle
- Notes

**Guard:** if the chosen person has no email, submit is disabled with inline message linking to "Add email to [person]" (opens that person's Edit modal).

### 6.4 Plan transition
Action on person card. Modal fields:
- Target pod (required)
- Move date (required)
- Optional: "**Create open slot for [role] at [source pod] on [move date]**" — default-on checkbox; only shown when the person has an active assignment.

**Replacement rule:** if person already has `move_to_pod_id` set, modal opens with the existing target pre-filled and a header "Replace planned transition to [old target]?". Submit overwrites.

### 6.5 Offboard
Action on person card. Confirmation modal:
- Lists the person's currently active assignments.
- Each row: dropdown choice — **Set Leaving** (default) / **Set Leaving + create open slot** / **Delete row**.
- Submit:
  - Person `status` → "Inactive"
  - Each assignment processed per row choice.
- All within a single action call (function gains a new `offboardPerson` action — see §8).

### 6.6 Reactivate
Action on Inactive person card. Single-click → person `status` flips to "Active". **Does not** restore old assignments.

---

## 7. Conditional email rule (canonical)

Email is required the moment any of the following is attempted on a person:
1. `createAssignment` against that person.
2. Any cert field is set (`certification_status`, `cert1_*`, `cert2_*`, `cert3_*`).

Email is NOT required by status alone (status="Onboarding" is fine without email until cert is touched).

### 7.1 Enforcement

**Function-layer (canonical):**
- New shared helper `requireEmail(personId, reason)`:
  ```
  const person = await context.tables.get("people", personId);
  if (!person.email || !String(person.email).trim()) {
    throw { code: "EMAIL_REQUIRED", reason, action_to_resolve: "Add email to this person first." };
  }
  ```
- Called from:
  - `createAssignment` when `payload.person_id` set.
  - `updatePerson` when any cert field is in the patch.
  - `updatePipelineField` when `payload.field` starts with `cert` or equals `certification_status`.

**Frontend (UX layer):**
- Person card without email shows the warning chip.
- Assign target dropdown disables email-less people with inline reason.
- Cert dots/popover disabled with tooltip.
- Edit Person modal: if user attempts to save with cert set + no email, inline error on email field with focus jump.

### 7.2 Existing data
Any row already in the table with cert set + no email gets a stronger "Resolve: add email" CTA on its card. (Data quality scan in 1e found 0 such rows today — confirmed at 2026-05-19.)

---

## 8. Backing function — Step 3 changes

Add the following actions (existing ones remain; payload shapes unchanged unless noted):

| Action | Notes |
|---|---|
| `createPerson` | No change. |
| `createAssignment` | Reject with `EMAIL_REQUIRED` if `person_id` set and target has no email. |
| `updatePerson` | Reject with `EMAIL_REQUIRED` if any cert field in patch and target has no email. |
| `updatePipelineField` | Reject with `EMAIL_REQUIRED` if field is cert and target has no email. |
| **NEW** `planTransition` | Sets `move_to_pod_id` + `move_date` on person. If `payload.create_open_slot` is true, also inserts a `pod_assignments` row with `status="Open"`, `person_id=null`, `pod_id=<source pod>`, `role=<from active assignment>`. |
| **NEW** `offboardPerson` | Atomically: sets person `status="Inactive"`, then for each assignment row in `payload.assignment_actions`, applies one of {`leaving`, `leaving_and_open_slot`, `delete`}. |
| **NEW** `reactivatePerson` | Sets person `status="Active"`. |

ID minting: all `createX` actions switch to server-minted UUIDs (`crypto.randomUUID()`). FE stops sending `id` in payloads.

**`updated_at` columns:** add `updated_at: date` to `people` and `pods` tables. Populate on every mutation. (Note: `pod_assignments.last_updated` and `pod_staffing_by_week.last_updated` already exist; rename for consistency is *not* in this scope — they keep their existing names.)

Slug rename: `pod-staffing-data-v109` → `pod-staffing-data` if rename is supported by the platform; otherwise FE keeps `STAFFING_FN_SLUG` constant pointing at the versioned slug.

---

## 9. Data flow: `useStaffingState`

State container is a hook, not a library.

### 9.1 Shape

```ts
{
  pods: Row<PodData>[],
  people: Row<PersonData>[],
  assignments: Row<AssignmentData>[],
  weekly: Row<WeeklyData>[],
  isLoading: boolean,
  isMutating: boolean,
  error: string | null,
  notice: string | null,
}
```

### 9.2 `mutate({action, payload, optimistic})`

1. Apply `optimistic` patch to local state immediately. Capture an undo snapshot.
2. POST `{action, payload}` to function.
3. On success: replace optimistic patch with the row(s) from the server response. Server wins on every field.
4. On error: revert to the undo snapshot. Surface `error.code` (special-case `EMAIL_REQUIRED` → open the relevant person's Edit modal with email field focused).

### 9.3 Reconciliation rule
After every successful mutation, **also schedule a debounced full `load`** (500ms) so derived rows (e.g. `pod_staffing_by_week` created as a side-effect of `createPod`) refresh without explicit hooks.

---

## 10. Component tree (target)

```
<App>
 ├ <Header>            tab nav, refresh, global actions
 ├ <Alerts>            error + notice toasts
 ├ <ClientCoverageTab> (Tab 1)
 │   ├ <StatsStrip>
 │   ├ <PodToolbar>    search, tier, filter buttons, sort, [+New client]
 │   ├ <PodList>
 │   │   └ <PodListRow> × N
 │   └ <PodDetail>
 │       ├ <RosterSection>
 │       │   └ <AssignmentCard> × N (open-slot variant + filled variant)
 │       ├ <GapsSection>
 │       │   └ <GapRow> × N
 │       ├ <TransitionsSection>
 │       │   ├ <IncomingRow> × N
 │       │   └ <OutgoingRow> × N
 │       └ <ThisWeekSection>
 ├ <HumanPipelineTab>  (Tab 2)
 │   ├ <StatsStrip>
 │   ├ <PipelineToolbar>
 │   ├ <SegmentedControl>
 │   └ <PersonCard> × N (status-adaptive)
 │       └ <CertProgressDots> (Onboarding only)
 ├ <Modals>
 │   ├ <AddPersonModal>
 │   ├ <AddClientModal>
 │   ├ <AssignModal>
 │   ├ <EditAssignmentModal>
 │   ├ <EditPersonModal>
 │   ├ <PlanTransitionModal>
 │   └ <OffboardModal>
 └ <Primitives>
     ├ <Modal>         shared (Esc, focus trap, backdrop dismiss)
     ├ <InlineEditField>
     ├ <Chip>
     ├ <EmptyState>
     └ <MissingEmailWarning>
```

---

## 11. Empty states

| Surface | Empty state |
|---|---|
| Tab 1 — no pods | Centered card: "No clients yet." + `[+ Create first client]` CTA. |
| Tab 1 — filter returns 0 | Inline: "No clients match this filter. [Clear filters]". |
| Tab 1 — selected pod has no roster | Inline within Roster sub-section: "No assignments yet. [Add DS] [Add FDE]". |
| Tab 1 — no gaps | "Fully staffed." pill. |
| Tab 1 — no transitions | "No transitions planned in the next 30 days." |
| Tab 1 — no weekly row | "Weekly tracking not initialized for this client. [Initialize]" (creates the weekly row). |
| Tab 2 — no people in segment | "No people in [segment]." Centered. |
| Tab 2 — search returns 0 | "No matches. [Clear search]". |

## 12. Accessibility

- All chips: `aria-label` includes the literal status (not just color).
- All modals: shared `<Modal>` enforces Esc, backdrop dismiss, focus trap, restore-focus on close.
- Pod list + person list: arrow keys move between cards, Enter selects.
- Status dropdowns: native `<select>` for keyboard support.
- All clickable cards: `role="button"` + tab-index + Enter/Space handlers.

## 13. URL state

If `@wonderful/app-sdk` permits `window.history.pushState` inside the iframe (to be verified in Step 2.5 prep), state lives in the URL:

```
?tab=pods&filter=gaps&tier=Tier+1&pod=acme_corp
?tab=pipeline&segment=Onboarding&q=cohen
```

Fallback: localStorage under `pod-staffing/state`.

---

## 14. Smoke checklist (pre-cutover)

1. App loads with current data; zero console errors.
2. Tab 1: each stat-filter applies correctly.
3. Tab 1: select a pod; all four sub-sections render.
4. Tab 1: inline-edit one assignment status → row updates in table (verify via `tables rows get pod_assignments <id>`).
5. Tab 1: "Assign" from a Gaps row pre-fills pod + role.
6. Tab 1: edit `this week` field → row updates in `pod_staffing_by_week`.
7. Tab 2: switch segments via stat strip + segmented control.
8. Tab 2: edit cert dots on an Onboarding person → row updates in `people`.
9. Tab 2: Plan transition with backfill-checkbox → person `move_to_pod_id`/`move_date` set AND new open `pod_assignments` row appears at source pod.
10. Tab 2: Offboard a person → checklist applied per row; person `status` flips to Inactive; tables reflect.
11. Tab 2: Create person without email → succeeds. Card shows "Email needed" chip.
12. Tab 2: Try to assign that email-less person → action disabled. Function-layer also rejects (verified via curl/cli).
13. Tab 2: Add email → chip clears; Assign + Cert controls enable.
14. Modals: Esc, backdrop click, focus-trap all work.
15. Network disconnect → mutate → error toast appears, optimistic patch rolls back.
16. Refresh page → previous tab / pod / filter restored from URL or localStorage.

---

## 15. Open questions (please confirm or override)

1. **Schema week columns running out** (§4.4.4): default plan is to show the latest available week with a banner. Acceptable, or prefer auto-`columns add` from the function?
2. **`Leaving` end date** (§5.3): currently no `end_date` column on `people`. Two options: (a) add `end_date: date` to `people` and surface inline in Leaving cards; (b) keep `last_updated` proxy and skip the column add. Default: (a) if you do want to track planned end dates, else skip.
3. **Tab bar — future tabs**: confirm the planned future tabs are `Projects` and `Go-lives` (your earlier message). Anything else worth designing-for now?
4. **URL state**: ok with my proposed query-param shape, or any preferences?
5. **`assignment.status="Leaving"` vs `person.status="Leaving"`**: today both exist independently. Should setting person to Leaving auto-flip their active assignments to Leaving? Currently the plan keeps them independent — offboarding is the one place we cascade.

---

## 16. What I am deliberately NOT including

- A separate weekly *planning* grid tab.
- An activity feed (deferred until `updated_at` exists everywhere and we know it's reliable).
- Bulk operations (multi-select pods/people).
- Filter combinations beyond the single-axis filters specified.
- Custom tier values beyond "Tier 1–4" + "Unspecified" (current dropdown stays).

---

## 17. Sign-off

Approve this doc or comment on §15 before I start coding Phase 3 of the v7 plan.
