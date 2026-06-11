# Pod Staffing — Version Log

Pinned versions for quick rollback.

## Backing function (`pod-staffing-data-v109`)

| Template-node version | Notes |
|---|---|
| **`928f3133-4e5a-4368-b380-97393eadbfe1`** *(active)* | v2.1: adds `updateWeekly` action for inline weekly-row edits. |
| `69b9686e-d928-46f3-a44d-6f6bee8b4cf7` | v2.0: adds `planTransition`, `offboardPerson`, `reactivatePerson`; conditional email rule; UUID minting. |
| `b9b89b7b-2d46-44e5-8abd-59e02de7acf3` | Pre-v2 (original 8 actions, client-minted IDs). |

Rollback function: `functions code rollback pod-staffing-data-v109 --env cto-office --template-version-id b9b89b7b-2d46-44e5-8abd-59e02de7acf3` (requires confirmation code).

## App bundle (`pod-staffing`)

## Active

| Version label | ID | Bundle | Notes |
|---|---|---|---|
| **v3.1.2-shadow-event-fix** *(active)* | `f6573ad5-362e-480c-a534-587a28b0657c` | 136 KB | Fix: SearchableSelect outside-click handler uses `event.composedPath()` instead of `event.target`. Inside a shadow root, `document`-level listeners see the target retargeted to the shadow host, so the previous `contains(target)` check returned false for clicks on the popover options — closing the popover before React's onClick could fire, leaving the value unset. |
| v3.1.1-searchable-portal-fix | `bb773b4a-b441-448a-bddb-23fb65522c3d` | 136 KB | Fix: SearchableSelect popover anchors to `.app-root` instead of `document.body`, so it stays inside the production shadow root where the scoped stylesheet + `--app-*` custom properties live. Without this, the Customer picker in the Edit go-live modal (and every other SearchableSelect — AssignModal, EditAssignmentModal, PlanTransitionModal, EditPersonModal) rendered as an unstyled list at the bottom of the page and couldn't be clicked. |
| v2.9.1-role-palette | `a1596b0c-1aec-4efd-9981-23943df31b91` | 127 KB | Searchable dropdowns: AssignModal Client + Person, EditAssignmentModal Client + Person, PlanTransitionModal Target client, EditPersonModal Target client. Type to filter; hints (tier / "needs email") shown inline; "+ Create new person…" pinned at top of the Person search. Role palette recoloured to avoid clashing with tier colors — DS = indigo, FDE = teal, External FDE = rose; tier-1 (green), tier-2 (blue), strategic (purple) untouched. |
| v2.8.0-edit-from-anywhere | `c58de302-9859-44c4-a314-97e0f1eef755` | 123 KB | Roster columns gain per-role "+ DS / + FDE" (assign person) and "+ Open" (no-person slot) buttons in their header; AssignModal drops the open-slot toggle (use the dedicated Roster button) and adds "+ Create new person…" inline (opens AddPersonModal, returns to Assign with the new person pre-selected); EditAssignmentModal drops "Open" from Status (Open is a slot, not a status); Transitions section rows are clickable → opens Plan Transition modal for that person; "Changes" filter dropped from Tab 1 toolbar. |
| v2.7.0-clarity | `510bfcfb-ac25-4304-a306-b9c664f8dd31` | 123 KB | Pod overview cards now plain white inside + tier-colored left border only; soft slate active accent (no more pure black); "Moving / Leaving" renamed to "Moving"; Inactive segment + status option removed from UI (column retained in DB); reconcile-from-server-response replaces full reload after each mutation (no more page flash); Edit Person modal cert section rebuilt as a clean 3-row table — setting a date auto-fills the attempt status to "Scheduled" and updates the overall to "Scheduled N"; weekly tracking labels clarified. |
| v2.6.0-ui-polish | `2665e283-b527-47e5-a592-fa9f625aac09` | 121 KB | Toolbar aligns flex-end so labelled inputs + segmented filter + button sit on one bottom line; subtler seats (light tint + colored text + 1px border, no chair-base shape); tier tint as flat soft fill (no gradient); detail panel also gets the tier color as a left-rule + tier-tag chip in the header. |
| v2.5.0-cert-and-names | `63a58907-7280-45b3-9814-1089f2091a86` | 121 KB | First names in seats (replaces 2-char initials); "Unassigned only" toggle on Pipeline (cross-cutting filter) + Unassigned stat card; Bench segment removed (use the toggle instead); cert workflow now retry-based — single "Cert N · Status" chip, Graduate fires on first pass at any attempt (matches the spreadsheet semantics: scheduled 2 = retry after failing 1). |
| v2.4.0-pm-fixes | `5e87d860-4c04-4507-81d7-1bd5cb0e5e39` | 120 KB | Bench segment (active people with no pod); cert dots derived from `certification_status` ("Scheduled 1/2/3"→progressive dots); Graduate-to-Active CTA on fully-passed Onboarding; initials inside seats; forecasted gaps (upcoming departures in next 30 days); hide "This week" until data exists; auto-dim empty segments. |
| v2.3.0-tenant-design | `1acd668a-30f8-4326-b4c7-8b8ca7591c8c` | 117 KB | Adopt the tenant design system (Inter font, color tokens, card+border+shadow tokens, tier-tag chips, pill tabs) shared with pod-documentation-tracker; tier-tinted backgrounds on pod overview cards (Strategic→purple, T1→green, T2→blue, T3→gray, T4→amber). |
| v2.2.0-overview | `dd85f3f7-7f88-4a6b-b4c7-08f8a1fe962c` | 120 KB | Overview seat-map grid as default Tab 1 view (click pod to drill into detail); open slots sorted last in roster; emoji removed from chair; seat legend (DS/FDE/External/Open). |
| v2.1.0-feedback | `9d2d2013-9226-4dc7-ae2f-5f44c488d1ec` | 115 KB | Compact number-prominent stats; merge Leaving into Moving segment; remove Active+Primary chips; External chip; chair visual for open slots; OOO range (vacation_from + vacation_until); This week collapsed; DS goal removed; Plan transition on assignment cards; one + New person button. |
| v2.0.0-redesign | `343cd0da-7f48-4dfb-bb8d-9e3ec7ade661` | 114 KB | v2 full redesign: 4-section pod detail, segmented pipeline, optimistic mutations, modals, conditional email, transitions, offboarding, weekly inline edit. |

## Previous (rollback targets)

| Version label | ID | Notes |
|---|---|---|
| v1.0.11-stabilize | `441279a3-7b7d-4d92-8d93-98869771519b` | Step 1 stabilization (use this for fast revert to last known-good). |
| 1.0.10 | `429b5933-53e1-4561-8a3d-0440588e98c7` | Last pre-stabilization build. |
| 1.0.9 | `2451687a-cd39-4144-9c83-adf95bff4436` | |
| 1.0.8 | `73af7c5c-2c23-432c-bb6e-facb398e2855` | |

## Rollback

Fast revert to v1.0.11-stabilize:

```bash
~/.claude/skills/wonderful-prompts/scripts/cli.mjs apps activate pod-staffing 441279a3-7b7d-4d92-8d93-98869771519b --env cto-office
```
