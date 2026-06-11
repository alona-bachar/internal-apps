---
name: controller-cli
description: Use when a task needs the Wonderful controller-cli — the Go admin CLI that talks directly to a tenant's controller API (agents, skills, tools, evals, RAGs, MCP, drafts, diacritics, tags, governance, dashboards, secrets, calls, issues, tasks, apps, tables, functions). Triggers: "use controller-cli", running an eval/smoke from the CLI, listing/inspecting agents or MCP connections, or anything the higher-level `wonderful` command / wonderful-prompts skill / wonderful-prompt-mcp has no subcommand for.
allowed-tools: Bash, Read, Grep, Glob
---

# controller-cli

Native Go CLI that hits a Wonderful tenant's controller API directly — same surface as the `wonderful-prompt-mcp` MCP, but as a binary. Reach for it when the higher-level `wonderful` command (or the `wonderful-prompts` skill) has no subcommand for what you need.

## Binary

**Pre-built:** `~/Documents/Git/wonderful/controller-cli`

If it's missing or stale, build it (source: `~/Documents/Git/wonderful/wonderful-controller/cli/cmd/controller-cli/`):

```bash
cd ~/Documents/Git/wonderful
go build -o controller-cli ./wonderful-controller/cli/cmd/controller-cli
```

Produces a ~35MB binary. One `.go` file per command group (`agents.go`, `evals.go`, `tools.go`, `rags.go`, `governance_*.go`, `dashboards*.go`, …). Go 1.25, single `go.mod` at the repo root.

## Auth — two modes

You authenticate **either** with a bearer token **or** an admin API key. Use whichever you have:

**A) Bearer token (ad-hoc, per tenant).** Ask the user for two things each session:
1. **Base URL** — the tenant's controller endpoint, e.g. `https://cto-office.api.wonderful.ai` or `https://maccabi-alona.app.dev.wonderful.cx`.
2. **Token** — a bearer access token (e.g. the Cognito access token from the logged-in web app). Tokens expire (~1h); re-ask when calls start returning 401/403 with an auth message. Pass via `--token` (or `--token-file <path>` to keep it out of shell history).

**B) Admin API key (repos with stored credentials).** Export the **admin** key as an env var — this is a *different* key from the `wonderful` CLI's (which starts `488d…` and lives in `credentials.toml`; **don't use that one here**). The demo/admin key starts `c4ea…`:

```bash
export ADMIN_API_KEY=<admin-key>
```

Per-env API keys are stored on this machine in `.wonderful/credentials.toml` files, keyed by `"<env>|<base-url>"` (e.g. `~/Documents/Git/israel-site/customers/maccabi/.wonderful/credentials.toml` has dev/prod/sandbox entries). Look them up there instead of asking.

## Required flags (always)

```bash
~/Documents/Git/wonderful/controller-cli \
  --base-url    '<BASE_URL>' \
  --host-header '<HOST>' \
  [--token '<TOKEN>']          # mode A; omit if using ADMIN_API_KEY
  <command> [args]
```

- `--base-url` — the full URL.
- `--host-header` — **derive from the base URL: strip the scheme and any trailing slash, keep just the host.**
  - `https://maccabi-alona.app.dev.wonderful.cx/` → `maccabi-alona.app.dev.wonderful.cx`
  - `https://cto-office.api.wonderful.ai` → `cto-office.api.wonderful.ai`

### Why `--host-header` is mandatory

The CLI defaults its Host header to `localhost:5050` and **forces that even when `--base-url` points elsewhere**. Cloudflare (in front of `*.wonderful.ai` / `*.wonderful.cx`) rejects `Host: localhost:5050` with a **403 Forbidden (cloudflare)** HTML page. Setting `--host-header` to the real host makes the request route correctly. A Cloudflare 403 means the host-header is wrong or missing.

## Golden rules

- **CLI-first.** Use `--help` on the exact command for discovery (`controller-cli evals run --help`). Don't read source unless the user asks.
- **Keep output small.** `--output summary` (count-only) or `--fields 'data[].id,data[].name'` after the command as command-local overrides.
- **Failure detection:** treat `"status":"error"`, `request failed`, `Traceback`, `AttributeError`, or usage/help spew in stdout/stderr as a **failed** operation even when the shell exit code is `0`.
- **Don't brute-force payloads.** If a `controller-cli call` API payload fails, inspect the exact `--help`/schema first. After two failed attempts, switch to a documented command / UI / Git fallback or explain the blocker — don't guess nearby JSON field names.

## Useful global flags

- `--output json|pretty|compact|table|summary|full|minimal` — output mode (default `minimal`). `json` to parse/chain, `table` to scan, `full` for raw payloads.
- `--fields id,display_name` — pick list columns (paths, no `[]`; quote to avoid shell globbing).
- `--contains field=value` — keep list rows where a field contains a substring; repeat for AND filters.
- `--verbose` / `--quiet`.
- `CONTROLLER_CLI_AI_OUTPUT=1` (env) — compact JSON, high-signal defaults, structured errors. Good for programmatic use.

Flags can appear before or after the command. `--output/--fields/--contains` after the command act as command-local overrides.

## Command groups

`agents, skills, tools, rags, diacritics, tags, metrics, evals, instructions, storage, tasks, run, auth, secrets, assistant, mcp, interactions, issues, call, calls, routines, campaigns, dashboards, governance, alerts, voice-library, apps, tables, functions, a2a, swagger`

Run a group with no args (e.g. `agents`) to list subcommands, or `<group> --help`.

## Examples

```bash
BASE='https://cto-office.api.wonderful.ai'; HOST='cto-office.api.wonderful.ai'; TOKEN='<token>'
CLI=~/Documents/Git/wonderful/controller-cli

# List agents (table) / get one as JSON / filter a list
$CLI --base-url "$BASE" --host-header "$HOST" --token "$TOKEN" --output table agents list
$CLI --base-url "$BASE" --host-header "$HOST" --token "$TOKEN" --output json agents get <agent-id>
$CLI --base-url "$BASE" --host-header "$HOST" --token "$TOKEN" tools list --contains name=staffing

# Smoke-test an agent via evals (PREFERRED — deterministic, repeatable over backoffice run)
$CLI --base-url "$BASE" --host-header "$HOST" --token "$TOKEN" evals run --agent <id> --scenario-file f.json --wait
$CLI --base-url "$BASE" --host-header "$HOST" --token "$TOKEN" evals result --id <result-id>
```

Tip: export `BASE`, `HOST`, `TOKEN`, `CLI` once and reuse.

## Gotchas

- RAG namespace is **plural**: `rags`, not `rag`. `rags create` needs both `--skill <id>` and `--name <name>`; on a create timeout, run `rags list --skill <id>` or `rags get <id>` before retrying.
- `diacritics list` requires `--skill <id>`.
- Drafts need both base + draft ids: `agents draft diff --agent <base-id> --draft <draft-id>`.
- Prefer **evals** for smoke tests over `backoffice run`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `403 Forbidden` + `cloudflare` HTML | `--host-header` missing/wrong, or still defaulting to `localhost:5050`. Set it to the base URL's host. |
| `dial tcp [::1]:5050: connect: connection refused` | `--base-url` not set (defaulted to `http://localhost:5050`). Pass the real base URL. |
| `401` / auth error / `request failed (403)` with an auth message (not Cloudflare HTML) | Token expired/invalid (mode A) — ask for a fresh one; or wrong/missing `ADMIN_API_KEY` (mode B). |

## When to ask for clarification

- Missing IDs (agent/tool/skill), or missing base-url/token.
- Whether to use evals vs `backoffice run`.
- Desired output verbosity.
