# il-pod-slack-poster

Source of the `il-pod-slack-poster-v1` Wonderful Function — the HTTP endpoint
the `apps/il-agent-configs` Wonderful App calls when the user clicks "Send
Slack update" to post the same message to one or more pod Slack channels.

Requires the `slack_bot_token` Wonderful Secret on the cto-office tenant,
with payload shape `{ "token": "xoxb-..." }`.

Deploy via `node functions/il-pod-slack-poster/deploy-function.mjs` with
`WONDERFUL_API_KEY` set.

See `docs/superpowers/plans/2026-05-28-il-agent-configs-v1.md` (Phase 3
Task 3.1) for the full plan.
