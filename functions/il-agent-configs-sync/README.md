# il-agent-configs-sync

Cron function `il-agent-configs-sync-v1`. Pulls live config + metrics from
Snowflake (`WONDERFUL.DATA_LAYER`) for the IL pod agents and upserts the
`il_agent_snapshot` / `il_agent_metrics` / `pod_agents_baseline` custom tables,
which `il-agent-configs-data` reads.

Reads the `SNOWFLAKE_AUTH` secret (key-pair JWT auth). Deploy:
`WONDERFUL_API_KEY=<key> node functions/il-agent-configs-sync/deploy-function.mjs`.
Scheduled 3×/day via the `il-agent-configs-sync-daily-v2` cron function: cron
`0 3,6,17 * * *` (UTC) ≈ 06:00 / 09:00 / 20:00 Israel (IDT). See the plan's Phase 4.

Actions: `sync` (refresh snapshot+metrics), `seed_baselines` (one per use_case,
idempotent), `reconcile_mappings` (auto-fill platform_agent_id for unmapped
pod_agents where the match is unambiguous).
