// Code for the "IL Agent Configs Sync Daily v2" SCHEDULED FUNCTION (slug
// il-agent-configs-sync-daily-v2) in the cto-office tenant.
//
// THIN TRIGGER — by design this file contains NO sync logic. It just calls the
// il-agent-configs-sync-v1 API function, which is the single source of truth
// (functions/il-agent-configs-sync/il-agent-configs-sync.ts, deployed via
// deploy-function.mjs). Keeping the schedule as a thin caller means the nightly
// run can never drift from the deployed sync logic — the previous version
// duplicated the whole pipeline inline and silently went stale.
//
// Schedule: cron `0 3,6,17 * * *` (UTC) ≈ 06:00 / 09:00 / 20:00 Israel (IDT,
// UTC+3). NOTE: cron is fixed-UTC with no DST, so in winter (IST, UTC+2) these
// fire an hour earlier (05:00 / 08:00 / 19:00 Israel); re-adjust at the DST flip
// if exact Israel wall-clock times matter. The schedule lives on the
// `il-agent-configs-sync-daily-v2` cron function (platform-side), not in this
// file — edit it via the controller API / dashboard, not here. Scheduled runs
// have no request body; this reads the TENANT_API_KEY secret to authenticate.
//
// To change the actual sync behaviour, edit il-agent-configs-sync.ts and run
// `node functions/il-agent-configs-sync/deploy-function.mjs` — never this file.
async function userFunction(context) {
  try {
    const sec = context.secrets.get("TENANT_API_KEY");
    const key = sec && typeof sec === "object" ? (sec.api_key || sec.apiKey || sec.token) : sec;
    if (!key) return { ok: false, error: "MISSING_TENANT_API_KEY" };
    const res = await fetch("https://cto-office.api.wonderful.ai/api/v1/functions/il-agent-configs-sync-v1", {
      method: "POST",
      headers: { "X-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.ok, status: res.status, result: body };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
