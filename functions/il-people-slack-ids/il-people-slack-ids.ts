// Source of the il-people-slack-ids-v1 Wonderful Function.
//
// One-off / periodic backfill that resolves each person's Slack member ID and
// stores it in the `people_slack_ids` mapping table (person_id -> slack_user_id).
// The il-pod-slack-poster function joins this table to render {fde}/{ds} tokens
// as real <@ID> mentions.
//
// Why a side table: the `people` custom-table schema is immutable (adding a
// column requires recreating the table, which would disrupt the staffing app +
// pod-staffing-ops agent). So the Slack ID lives in its own table keyed by the
// people row id.
//
// The runtime calls `userFunction(context)`; inputs arrive on
// `context.data.{action,payload}`. The `export` is stripped at deploy time.
//
// Idempotent: people already present in `people_slack_ids` are skipped, so the
// function can be re-run to converge (each run resolves up to `limit` people —
// keeps us under Slack's rate limit + the function timeout). users.lookupByEmail
// needs the bot token's `users:read.email` scope; a missing scope surfaces
// per-row in `unmatched` (reason "missing_scope").

const MAP_TABLE = "people_slack_ids";

async function queryAll(context, tableName) {
  const limit = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    const result = await context.tables.query(tableName, limit, offset);
    rows.push(...(result.rows || []));
    if (!result.rows || result.rows.length < limit || rows.length >= Number(result.total || 0)) break;
    offset += limit;
  }
  return rows;
}

function fullName(d) {
  return [d?.first_name, d?.last_name].filter(Boolean).join(" ") || null;
}

// Upsert into people_slack_ids keyed by person_id (patch if present, else insert).
async function upsertMapping(context, personId, data) {
  const match = await context.tables.filter(MAP_TABLE, [{ column: "person_id", operator: "eq", value: personId }], 1, 0);
  if (match.rows && match.rows.length > 0) {
    await context.tables.update(MAP_TABLE, match.rows[0].id, data);
  } else {
    await context.tables.insert(MAP_TABLE, { person_id: personId, ...data });
  }
}

async function backfill(context, payload) {
  const slackToken = context.secrets.get("slack_bot_token")?.token;
  if (!slackToken) throw new Error("slack_bot_token secret not configured");

  // Cap lookups per run so we stay under Slack's Tier-3 rate limit and the
  // function timeout; re-run to finish the rest (resolved people are skipped).
  const max = Math.max(1, Math.min(200, Number(payload?.limit ?? 60)));
  const onlyRoles = Array.isArray(payload?.roles) ? new Set(payload.roles) : null;

  const [people, existingMap] = await Promise.all([
    queryAll(context, "people"),
    queryAll(context, MAP_TABLE),
  ]);
  const resolved = new Set(
    existingMap
      .map((r) => r?.data ?? {})
      .filter((d) => d.slack_user_id)
      .map((d) => String(d.person_id)),
  );

  const nowIso = new Date().toISOString();
  let alreadySet = 0;
  let noEmail = 0;
  let processed = 0;
  let rateLimited = false;
  const matched = [];
  const unmatched = [];

  for (const row of people) {
    const d = row?.data ?? {};
    const id = row.id ?? d.id;
    if (!id) continue;
    if (onlyRoles && !onlyRoles.has(d.role)) continue;
    if (resolved.has(String(id))) { alreadySet += 1; continue; }
    const email = typeof d.email === "string" ? d.email.trim() : "";
    if (!email) { noEmail += 1; unmatched.push({ name: fullName(d), reason: "no_email" }); continue; }
    if (processed >= max) break;
    processed += 1;

    const res = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${slackToken}` } },
    );
    if (res.status === 429) { rateLimited = true; break; } // stop; re-run later
    const j = await res.json();
    if (j.ok && j.user && j.user.id) {
      await upsertMapping(context, id, { slack_user_id: j.user.id, name: fullName(d), email, synced_at: nowIso });
      matched.push({ name: fullName(d), email, slack_user_id: j.user.id });
    } else {
      unmatched.push({ name: fullName(d), email, reason: j.error || "unknown" });
    }
  }

  return {
    ok: true,
    total_people: people.length,
    already_set: alreadySet,
    matched: matched.length,
    matched_detail: matched,
    no_email: noEmail,
    unmatched,
    rate_limited: rateLimited,
    note: rateLimited ? "Hit Slack rate limit — re-run to continue." : undefined,
  };
}

// Read-back check against the mapping table.
async function verify(context) {
  const rows = (await queryAll(context, MAP_TABLE)).map((r) => r?.data ?? {});
  const withId = rows.filter((d) => d.slack_user_id);
  return {
    ok: true,
    mapping_rows: rows.length,
    with_slack_id: withId.length,
    sample: withId.slice(0, 5).map((d) => ({ name: d.name, slack_user_id: d.slack_user_id })),
  };
}

export async function userFunction(context) {
  const action = context?.data?.action;
  const payload = context?.data?.payload || {};
  if (!action) return { ok: false, error: "MISSING_ACTION" };
  if (action === "backfill") return backfill(context, payload);
  if (action === "verify") return verify(context);
  return { ok: false, error: `UNKNOWN_ACTION: ${action}` };
}
