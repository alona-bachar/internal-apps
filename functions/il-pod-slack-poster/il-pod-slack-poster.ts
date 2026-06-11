// Source of the il-pod-slack-poster-v1 Wonderful Function.
//
// HTTP endpoint the `apps/il-agent-configs` Wonderful App calls when the user
// clicks "Send Slack update". For each pod_id it looks up the pod's
// slack_channel_id, renders the message template against that pod, and POSTs to
// Slack as the configured bot. Skipped pods come back in `skipped`; unexpected
// HTTP failures throw.
//
// Template tokens (resolved PER channel, against that channel's pod):
//   {fde} / {ds}      -> that pod's FDE / DS people, as <@SlackID> mentions
//                        (falls back to the plain name when no Slack ID is known)
//   {tier} {customer} -> that pod's tier / customer name (plain text)
//   {<customer>_fde}  -> a NAMED customer's FDE/DS/tier/name, regardless of which
//   {<customer>_ds}      channel it's posted to (customer token = lowercased,
//   {<customer>_tier}    non-alphanumerics stripped). e.g. {maccabi_fde}.
//   {<customer>_name}
// Unknown tokens are left untouched. FDE/DS come from pod_assignments (role
// "FDE"/"DS") joined to people; Slack IDs come from the people_slack_ids side
// table (populated by il-people-slack-ids).
//
// The runtime calls `userFunction(context)`; inputs arrive on
// `context.data.{action,payload}`. The `export` on `userFunction` /
// `renderTemplate` is for vitest and is stripped at deploy time.
//
// Table reads go through `context.tables.*`; the Slack POST stays a raw fetch().

const ROLE_DS = new Set(["DS", "Data Scientist"]);
const ROLE_FDE = new Set(["FDE", "Forward Deployed Engineer"]);

const personName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(" ");
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

function mention(person) {
  return person.slack_user_id ? `<@${person.slack_user_id}>` : person.name;
}

// Substitute {token}s in `message`. `self` is the resolved vars for the channel
// being posted to; `byCustomer` maps a normalized customer token -> resolved
// vars, for absolute {<customer>_field} references.
export function renderTemplate(message, self, byCustomer) {
  return String(message ?? "").replace(/\{([a-z0-9_]+)\}/gi, (whole, token) => {
    const t = String(token).toLowerCase();
    if (t === "fde") return self.fde;
    if (t === "ds") return self.ds;
    if (t === "tier") return self.tier ?? whole;
    if (t === "customer") return self.customer ?? whole;
    const m = t.match(/^(.+)_(fde|ds|tier|name)$/);
    if (m) {
      const target = byCustomer.get(m[1]);
      if (!target) return whole; // unknown customer — leave the token as typed
      if (m[2] === "fde") return target.fde;
      if (m[2] === "ds") return target.ds;
      if (m[2] === "tier") return target.tier ?? whole;
      if (m[2] === "name") return target.customer ?? whole;
    }
    return whole; // unknown token — leave untouched
  });
}

// Load pods + assignments + people + slack ids once and build, per pod_id, the
// resolved template vars { fde, ds, tier, customer } plus a customer-token index.
async function buildVarContext(context) {
  const [pods, assignments, people, slackIdRows] = await Promise.all([
    queryAll(context, "pods"),
    queryAll(context, "pod_assignments"),
    queryAll(context, "people"),
    queryAll(context, "people_slack_ids"),
  ]);

  const slackIdByPerson = new Map();
  for (const row of slackIdRows) {
    const d = row?.data ?? {};
    if (d.person_id && d.slack_user_id) slackIdByPerson.set(String(d.person_id), d.slack_user_id);
  }

  const peopleById = new Map();
  for (const row of people) {
    const d = row?.data ?? {};
    const key = d.id ?? row?.id;
    if (key != null) peopleById.set(String(key), d);
  }

  const fdeByPod = new Map();
  const dsByPod = new Map();
  for (const row of assignments) {
    const d = row?.data ?? {};
    const { pod_id, person_id, role } = d;
    if (!pod_id || !person_id || !role) continue;
    const person = peopleById.get(String(person_id));
    if (!person) continue;
    const name = personName(person);
    if (!name) continue;
    const entry = { name, slack_user_id: slackIdByPerson.get(String(person_id)) ?? null };
    if (ROLE_FDE.has(role)) {
      if (!fdeByPod.has(pod_id)) fdeByPod.set(pod_id, []);
      fdeByPod.get(pod_id).push(entry);
    } else if (ROLE_DS.has(role)) {
      if (!dsByPod.has(pod_id)) dsByPod.set(pod_id, []);
      dsByPod.get(pod_id).push(entry);
    }
  }

  const varsByPod = new Map();
  const byCustomer = new Map();
  for (const row of pods) {
    const d = row?.data ?? {};
    const podId = d.id ?? row?.id;
    if (podId == null) continue;
    const vars = {
      fde: (fdeByPod.get(podId) ?? []).map(mention).join(", "),
      ds: (dsByPod.get(podId) ?? []).map(mention).join(", "),
      tier: d.tier ?? null,
      customer: d.pod_name ?? null,
    };
    varsByPod.set(String(podId), vars);
    if (d.pod_name) byCustomer.set(normName(d.pod_name), vars);
  }

  return { varsByPod, byCustomer };
}

async function postAction(context, payload) {
  const { pod_ids, message } = payload ?? {};
  if (!Array.isArray(pod_ids) || pod_ids.length === 0 || !message) {
    return { ok: false, error: "MISSING_FIELDS" };
  }

  const slackToken = context.secrets.get("slack_bot_token")?.token;
  if (!slackToken) throw new Error("slack_bot_token secret not configured");

  const { varsByPod, byCustomer } = await buildVarContext(context);
  const emptySelf = { fde: "", ds: "", tier: null, customer: null };

  const posted = [];
  const skipped = [];

  for (const pod_id of pod_ids) {
    const matches = await context.tables.filter(
      "pods",
      [{ column: "id", operator: "eq", value: pod_id }],
      1,
      0,
    );
    if (!matches.rows || matches.rows.length === 0) {
      skipped.push({ pod_id, reason: "pod_not_found" });
      continue;
    }
    const row = matches.rows[0].data ?? {};
    const channel = row.slack_channel_id;
    if (!channel) {
      skipped.push({ pod_id, reason: "no_channel_configured" });
      continue;
    }

    const text = renderTemplate(message, varsByPod.get(String(pod_id)) ?? emptySelf, byCustomer);

    // Best-effort: join the channel so the bot can post without a manual invite.
    // No-op for private channels / DMs; any failure here must never block the post.
    try {
      await fetch("https://slack.com/api/conversations.join", {
        method: "POST",
        headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
    } catch {
      // ignore — fall through to postMessage, which reports the real outcome
    }

    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
    if (!slackRes.ok) {
      throw new Error(`slack postMessage -> ${slackRes.status}: ${await slackRes.text()}`);
    }
    const sj = await slackRes.json();
    if (!sj.ok) {
      skipped.push({ pod_id, reason: `slack_error:${sj.error}` });
      continue;
    }
    posted.push({ pod_id, channel, ts: sj.ts });
  }

  return { ok: true, posted, skipped };
}

export async function userFunction(context) {
  const action = context?.data?.action;
  const payload = context?.data?.payload || {};
  if (!action) return { ok: false, error: "MISSING_ACTION" };
  if (action === "post") return postAction(context, payload);
  return { ok: false, error: `UNKNOWN_ACTION: ${action}` };
}
