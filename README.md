# internal-apps

Wonderful internal apps for the **CTO Office** tenant, with their backend functions and table provisioning. Copied out of `il-cto-office` so the apps can live and ship independently.

## Layout

| Folder | What it holds |
|--------|---------------|
| `apps/il-agent-configs/` | React + Vite Wonderful App for browsing/editing agent configs (Snowflake-fed). Deploy via `apps/il-agent-configs/scripts/deploy-app.mjs`. |
| `apps/staffing/` | React + Vite Wonderful App that visualizes/edits the staffing data. App ID: `be2be265-6681-4524-8710-afd0c765426d`. Deploy via `apps/staffing/scripts/deploy-app.mjs`. |
| `functions/il-agent-configs-data/` | HTTP function backing the il-agent-configs app (reads the canonical config layer). |
| `functions/il-agent-configs-sync/` | Cron thin-trigger that syncs agent configs from Snowflake into the tables. |
| `functions/il-people-slack-ids/` | Resolves people → Slack IDs. |
| `functions/il-pod-slack-poster/` | Posts pod/config summaries to Slack. |
| `functions/staffing-data/` | Source of the `pod-staffing-data-v109` function backing the staffing app. |
| `tables/` | Schema docs, provisioning scripts, and seed data for the tenant's custom tables. |

All subprojects target the same `cto-office` tenant: `https://cto-office.api.wonderful.ai`.

## Setup

Each app/function uses pnpm or npm with the Wonderful registry (`.npmrc`):

```
@wonderful:registry=https://npm.wonderful.ai/
```

Deploys and the table provisioning scripts read `WONDERFUL_API_KEY` from the environment — never commit it (this repo is public).

## Deploy

```bash
# App (zips dist/, activates live on prod)
WONDERFUL_API_KEY=... node apps/il-agent-configs/scripts/deploy-app.mjs
WONDERFUL_API_KEY=... node apps/staffing/scripts/deploy-app.mjs

# Functions
WONDERFUL_API_KEY=... node functions/staffing-data/deploy-function.mjs

# Tables
WONDERFUL_API_KEY=... node tables/provision-il-agent-configs.mjs
```

See each subproject's `README.md` / `AGENTS.md` for details.
