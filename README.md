# mcp-ops

**One read-only MCP server that gives your AI agent eyes on your whole production stack.**

Stripe Connect, Postgres, Vercel, Resend, Sentry, GitHub, behind one server, with two tools that look across all of them: `ops_status` (the whole stack in one screen) and `ops_timeline` (everything that happened, in order, across every service). Plus diagnostics that explain *why* a payout is blocked or a transfer failed, instead of making you click through six dashboards.

Everything is a read. No tool creates, updates or deletes anything, anywhere. Database queries run inside a `READ ONLY` transaction, writes are rejected before they leave the process, Stripe live keys are refused unless you opt in, recipients' emails are masked, and environment variable values are never returned.

*Version française plus bas.*

## English

### Why

When something breaks in production you end up with six tabs open: Vercel for the deploy, Sentry for the error, Stripe for the payment, Neon for the row, Resend for the email that never left, GitHub for the commit that did it. An agent with `mcp-ops` gets all of that as tools, and the two cross-service tools do the correlating for you:

```
> ops_timeline since_minutes=90

2026-09-14 13:02:11  github  commit                        a1b2c3d4e fix: transfer funded in the settled currency (2moulin)
2026-09-14 13:03:40  github  ci success                    ci [main]
2026-09-14 13:04:52  vercel  deploy ready                  production win [main] fix: transfer funded in the settled currency
2026-09-14 13:11:07  stripe  payment_intent.succeeded      pi_3Q... 135.00 CAD
2026-09-14 13:11:09  stripe  transfer.created              tr_1Q... 128.00 CAD on acct_1N... (webhook pending x1)
2026-09-14 13:11:15  resend  email delivered               Your order is confirmed -> j***@example.com
2026-09-14 13:12:30  sentry  issue error last seen         WIN-42 TypeError: cannot read 'currency' (x3, first 2m ago)
```

### Tools

**Across every service**

| Tool | Answers |
| --- | --- |
| `ops_status` | One line per connected service: balances, blocked accounts, failing webhooks, last deploy, open errors, bounced emails, database size and connections. Start here. |
| `ops_timeline` | Deploys, commits, CI runs, Stripe events, Sentry issues and emails, merged and sorted, for the last N minutes. "What changed before it broke." |

**Stripe Connect** (`STRIPE_SECRET_KEY`)

| Tool | Answers |
| --- | --- |
| `stripe_list_accounts` | Connected accounts and whether they can charge, get paid, and what is due |
| `stripe_get_account` | Everything about one account: capabilities, requirements, bank accounts (last 4), dashboard type |
| `stripe_diagnose_account` | Why this account cannot charge or get paid out, as a checklist |
| `stripe_balance` | Available and pending, for the platform or one connected account |
| `stripe_list_transfers` | Transfers to connected accounts with the charge that funded each one and reversals |
| `stripe_diagnose_transfer` | Why a transfer failed or will fail: wrong settlement currency, amount above the charge net, platform balance too low, destination with payouts disabled, refund or dispute on the source charge |
| `stripe_list_charges`, `stripe_list_payouts` | Charges on the platform or an account; payouts to a seller's bank with failure reasons |
| `stripe_list_webhook_endpoints`, `stripe_list_events`, `stripe_get_event` | Endpoints, recent events (filter by type or prefix, or only the ones whose delivery is failing), one event's payload |

**Postgres** (`DATABASE_URL`, works with Neon, Supabase, RDS, anything)

| Tool | Answers |
| --- | --- |
| `db_tables` | Tables with estimated rows and size |
| `db_describe` | Columns, indexes, constraints of a table |
| `db_query` | One SELECT / WITH / EXPLAIN, inside `BEGIN READ ONLY`, 15 s timeout, rows capped |
| `db_activity` | Connections by state, queries running longer than 5 s |
| `db_slow_queries` | Top queries by total time (`pg_stat_statements`) |

**Vercel** (`VERCEL_TOKEN`, optional `VERCEL_TEAM_ID`, `VERCEL_PROJECT`)

`vercel_deployments`, `vercel_deployment_logs` (why a build failed), `vercel_env_names` (names and targets only, never values), `vercel_projects`.

**Resend** (`RESEND_API_KEY`)

`resend_emails` (with last event: delivered, bounced, complained, delayed), `resend_email` (one email, text body, recipients masked).

**Sentry** (`SENTRY_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_URL` for self-hosted)

`sentry_issues` (Sentry search syntax), `sentry_issue` (latest event, in-app frames, release, environment, url).

**GitHub** (`GITHUB_TOKEN`, `GITHUB_REPO` as `owner/name`)

`github_commits`, `github_ci_runs`, `github_open_prs`.

Only the providers whose variables are set are loaded. One is enough.

### Install

```bash
claude mcp add ops \
  -e STRIPE_SECRET_KEY=rk_test_... \
  -e DATABASE_URL=postgres://... \
  -e VERCEL_TOKEN=... -e VERCEL_TEAM_ID=team_... -e VERCEL_PROJECT=prj_... \
  -e RESEND_API_KEY=re_... \
  -e SENTRY_TOKEN=... -e SENTRY_ORG=my-org -e SENTRY_PROJECT=my-project \
  -e GITHUB_TOKEN=ghp_... -e GITHUB_REPO=owner/name \
  -- npx -y mcp-ops
```

Claude Desktop, Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "ops": {
      "command": "npx",
      "args": ["-y", "mcp-ops"],
      "env": {
        "STRIPE_SECRET_KEY": "rk_test_...",
        "DATABASE_URL": "postgres://...",
        "VERCEL_TOKEN": "...",
        "GITHUB_TOKEN": "ghp_...",
        "GITHUB_REPO": "owner/name"
      }
    }
  }
}
```

### Use the least key that works

* **Stripe**: a *restricted key* with Read on Connect, Charges, Transfers, Payouts, Balance, Webhook Endpoints, Events. Live keys are refused unless `STRIPE_MCP_ALLOW_LIVE=1`.
* **Postgres**: a read-only role, or a Neon read replica. The server adds `BEGIN READ ONLY` and rejects non-SELECT statements anyway, but belt and braces.
* **Vercel**: a token scoped to the team. Values of environment variables are never read.
* **GitHub**: a fine-grained token with read on Contents, Actions, Pull requests.
* **Sentry**: an auth token with `project:read` and `event:read`.

### Ask it things

* "ops_status, then tell me what needs attention."
* "What happened in the last 2 hours across everything?"
* "The seller acct_1XYZ says they were never paid. Diagnose it."
* "Show the bounced emails since the last deploy."
* "Which Sentry issues appeared after commit a1b2c3d?"
* "How many orders are stuck in `pending` in the database, and when was the last one created?"

### Develop

```bash
npm install
npm test          # vitest, every provider against fakes, plus a real MCP client on the server
npm run typecheck
npm run dev       # stdio server with tsx
```

Adding a provider is one file that implements `Provider` (`register` its tools, `status()`, optional `timeline()`), and one line in `src/index.ts`.

## Français

### Ce que ça fait

Un seul serveur MCP, en lecture seule, qui donne à ton agent (Claude Code, Claude Desktop, Cursor) une vue sur toute ta production: Stripe Connect, Postgres, Vercel, Resend, Sentry, GitHub. Deux outils regardent à travers tous les services: `ops_status` (tout l'état en un écran) et `ops_timeline` (tout ce qui s'est passé, dans l'ordre, tous services confondus). Plus des diagnostics qui expliquent *pourquoi* un vendeur n'est pas payé ou pourquoi un virement échoue.

Aucun outil n'écrit quoi que ce soit. Les requêtes SQL roulent dans une transaction `READ ONLY` et tout ce qui n'est pas un SELECT est refusé avant même de partir. Une clé Stripe live est refusée sauf si tu mets `STRIPE_MCP_ALLOW_LIVE=1`. Les courriels des destinataires sont masqués et les valeurs des variables d'environnement ne sont jamais retournées.

### Installation

Seuls les services dont les variables sont présentes sont chargés. Un seul suffit.

```bash
claude mcp add ops -e STRIPE_SECRET_KEY=rk_test_... -e DATABASE_URL=postgres://... -e GITHUB_TOKEN=ghp_... -e GITHUB_REPO=owner/name -- npx -y mcp-ops
```

Le bloc JSON plus haut fonctionne tel quel pour Claude Desktop et Cursor.

### Exemples

* « ops_status, puis dis-moi ce qui demande de l'attention. »
* « Qu'est-ce qui s'est passé dans les 2 dernières heures, tous services confondus? »
* « Le vendeur acct_1XYZ dit qu'il n'a jamais été payé. Diagnostique. »
* « Montre les courriels rebondis depuis le dernier déploiement. »

## License

MIT
