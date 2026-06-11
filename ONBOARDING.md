# Onboarding — internal-apps

Everything a teammate needs to clone this repo on a fresh machine and start
building/deploying. Two Wonderful Apps + their backend functions + table
provisioning, all targeting the **`cto-office`** tenant
(`https://cto-office.api.wonderful.ai`).

> ⚠️ **Secrets are NOT in this repo (it's public).** You must obtain your own
> `WONDERFUL_API_KEY` and controller credentials — see [Secrets](#secrets-you-must-obtain) below.

---

## 1. What's in here

| Path | What | Deploy with |
|------|------|-------------|
| `apps/il-agent-configs/` | Agent-config viewer/editor (Snowflake-fed) | `node scripts/deploy-app.mjs` |
| `apps/staffing/` | Staffing data visualizer/editor (App ID `be2be265-…`) | `node scripts/deploy-app.mjs` |
| `functions/il-agent-configs-data/` | HTTP fn backing il-agent-configs | `node deploy-function.mjs` |
| `functions/il-agent-configs-sync/` | Cron sync (Snowflake → tables) | `node deploy-function.mjs` |
| `functions/il-people-slack-ids/` | People → Slack IDs | `node deploy-function.mjs` |
| `functions/il-pod-slack-poster/` | Posts to Slack | `node deploy-function.mjs` |
| `functions/staffing-data/` | `pod-staffing-data-v109` backing staffing | `node deploy-function.mjs` |
| `tables/` | Schema + provisioning + seed scripts | `node tables/<script>.mjs` |
| `.claude/skills/` | Claude Code skills: `controller-cli`, `wonderful-apps-deploy` | (auto-loaded by Claude) |

---

## 2. Prerequisites (machine setup)

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | ≥ 20 (tested on 22/25) | https://nodejs.org or `nvm install 22` |
| **pnpm** | ≥ 10 | `corepack enable && corepack prepare pnpm@latest --activate` |
| **git** | any | |
| **gh** (GitHub CLI) | any | `brew install gh && gh auth login` |
| **Go** | 1.25 | only needed to build `controller-cli` (see §6) |
| **Claude Code** | latest | `claude update`; the included skills/settings load automatically when you run it from this repo |

No registry auth is needed — `.npmrc` points `@wonderful` at the public
`https://npm.wonderful.ai/` and everything else at npmjs.

---

## 3. Secrets you must obtain

These are **not** committed. Ask Alona (or a CTO-office admin) for:

| Secret | Used by | How to set |
|--------|---------|-----------|
| `WONDERFUL_API_KEY` | every app/function/table deploy script | `export WONDERFUL_API_KEY=...` in your shell (or a local `.env` — already gitignored) |
| **Controller admin API key** (`c4ea…`) *or* a **bearer token** + base URL | `controller-cli` (§6) | `export ADMIN_API_KEY=...`, or pass `--token` per call |

Never paste these into tracked files. `.env`, `.env.*`, `.secrets/`, `*.p8` are
all gitignored.

---

## 4. Install

No monorepo workspace — install **per app** (functions reuse the apps'
`node_modules`, so install both apps before deploying functions):

```bash
cd apps/il-agent-configs && pnpm install
cd ../staffing          && pnpm install
```

If a build later fails on an esbuild binary, run `pnpm approve-builds` once in
that app and re-install (pnpm 10 blocks postinstall scripts by default).

---

## 5. Build & deploy

### Apps
```bash
cd apps/staffing
pnpm build                                   # tsc + vite → dist/
WONDERFUL_API_KEY=... node scripts/deploy-app.mjs
# Optional env: ACTIVATE=0 (upload only), APP_ID=..., VERSION=..., CONTROLLER_BASE_URL=...
```
Same flow for `apps/il-agent-configs`.

### Functions
```bash
# NOTE: staffing-data's deploy borrows esbuild from apps/staffing/node_modules,
# so `pnpm install` in apps/staffing must have run first.
WONDERFUL_API_KEY=... node functions/staffing-data/deploy-function.mjs
```
(`PUT` drops `code` on Wonderful Functions, so these scripts DELETE+POST.)

### Tables
```bash
WONDERFUL_API_KEY=... node tables/provision-il-agent-configs.mjs            # create-if-missing + report drift
WONDERFUL_API_KEY=... node tables/provision-il-agent-configs.mjs --recreate # drop + recreate drifted tables
WONDERFUL_API_KEY=... node tables/provision-pod-agents.mjs
WONDERFUL_API_KEY=... node tables/reseed-april-2026.mjs
```

---

## 6. controller-cli (external — not bundled here)

The `controller-cli` skill (`.claude/skills/controller-cli/SKILL.md`) drives a
Go admin CLI that talks directly to the tenant's controller API. **The binary is
NOT in this repo** — it's built from a separate Wonderful source repo:

```bash
# Clone the wonderful controller source (ask an admin for access), then:
cd <wonderful-repo>
go build -o controller-cli ./wonderful-controller/cli/cmd/controller-cli
```

⚠️ **The skill assumes the binary lives at `~/Documents/Git/wonderful/controller-cli`.**
On your machine, either put it there or update the path in the SKILL when you use it.

**Auth** — either an admin API key or a bearer token:
```bash
export ADMIN_API_KEY=<c4ea…>     # admin key (different from the `wonderful` CLI key)
# …or pass a bearer token per call: --token '<token>'
```

Every call needs `--base-url` and `--host-header` (derive the host by stripping
the scheme from the base URL), e.g.:
```bash
controller-cli --base-url 'https://cto-office.api.wonderful.ai' \
               --host-header 'cto-office.api.wonderful.ai' \
               agents list
```
A Cloudflare 403 means `--host-header` is wrong/missing.

---

## 7. The `wonderful` CLI (optional)

Some docs reference `wonderful …` commands (chat, run, import). Deploys here use
the `node …deploy*.mjs` scripts above and don't require it, but if you want it:
`npm i -g @wonderful/cli` then `wonderful login`. Its key (`488d…`, in
`credentials.toml`) is **separate** from the controller admin key.

---

## 8. Claude Code in this repo

- `CLAUDE.md` — project instructions (loaded automatically).
- `.claude/skills/` — `controller-cli` and `wonderful-apps-deploy` skills travel with the repo.
- `.claude/settings.json` — a permission allowlist (pnpm/node/git/gh/go/wonderful) so deploys and CLI runs don't prompt every time. Adjust to taste; secrets still never live here.

Just run `claude` from the repo root and ask it to deploy / inspect / change things.
