# mcp-ops

**One read-only MCP server that gives your AI agent eyes on your whole production stack.**

Stripe Connect, Postgres, Neon, Vercel, Netlify, Render, Cloudflare, Resend, Postmark, Twilio, Sentry, Better Stack, Shopify, GitHub. Fourteen services behind one server, and two tools that look across all of them: `ops_status` (the whole stack in one screen) and `ops_timeline` (everything that happened, in order, across every service). Plus diagnostics that explain *why* a payout is blocked, a transfer failed, a build broke or a zone is misconfigured, instead of making you click through fourteen dashboards.

Everything is a read. No tool creates, updates or deletes anything, anywhere.

*Version française plus bas.*

## English

### Why

When something breaks in production you end up with a dozen tabs open: the deploy, the error, the payment, the database row, the email that never left, the commit that did it. An agent with `mcp-ops` gets all of that as tools, and the two cross-service tools do the correlating:

```
> ops_timeline since_minutes=90

2026-09-14 13:02:11  github   commit                      a1b2c3d4e fix: transfer funded in the settled currency (2moulin)
2026-09-14 13:03:40  github   ci success                  ci [main]
2026-09-14 13:04:52  vercel   deploy ready                production win [main] fix: transfer funded in the settled currency
2026-09-14 13:05:10  neon     start_compute finished      ep-cool-sun-123
2026-09-14 13:11:07  stripe   payment_intent.succeeded    pi_3Q... 135.00 CAD
2026-09-14 13:11:09  stripe   transfer.created            tr_1Q... 128.00 CAD on acct_1N... (webhook pending x1)
2026-09-14 13:11:15  resend   email delivered             Your order is confirmed -> j***@example.com
2026-09-14 13:12:30  sentry   issue error last seen       WIN-42 TypeError: cannot read 'currency' (x3, first 2m ago)
2026-09-14 13:14:02  uptime   incident started            WIN HTTP 502
```

### Tools

**Across every service**

| Tool | Answers |
| --- | --- |
| `ops_status` | One line per connected service. Start here. |
| `ops_timeline` | Deploys, commits, CI runs, payments, errors, emails, SMS, incidents, database operations, merged and sorted, for the last N minutes. "What changed before it broke." |

**Payments: Stripe Connect** (`STRIPE_SECRET_KEY`)

`stripe_list_accounts`, `stripe_get_account`, `stripe_diagnose_account` (why an account cannot charge or get paid), `stripe_balance`, `stripe_list_transfers`, `stripe_diagnose_transfer` (wrong settlement currency, amount above the charge net, platform balance too low, destination blocked, refund or dispute on the source charge), `stripe_list_charges`, `stripe_list_payouts`, `stripe_list_webhook_endpoints`, `stripe_list_events` (including only the ones whose delivery is failing), `stripe_get_event`.

**Database: Postgres** (`DATABASE_URL`; Neon, Supabase, RDS, anything) and **Neon control plane** (`NEON_API_KEY`)

`db_tables`, `db_describe`, `db_query` (one SELECT inside `BEGIN READ ONLY`, 15 s timeout), `db_activity`, `db_slow_queries`. `neon_projects`, `neon_branches`, `neon_endpoints` (active or idle, autoscaling, suspend timeout: explains cold starts), `neon_operations`.

**Hosting: Vercel** (`VERCEL_TOKEN`), **Netlify** (`NETLIFY_TOKEN`), **Render** (`RENDER_API_KEY`)

`vercel_deployments`, `vercel_deployment_logs`, `vercel_env_names` (names only, never values), `vercel_projects`. `netlify_sites`, `netlify_deploys`, `netlify_deploy_log`. `render_services`, `render_deploys`.

**Edge and DNS: Cloudflare** (`CLOUDFLARE_API_TOKEN`)

`cloudflare_zones`, `cloudflare_dns`, `cloudflare_security` (SSL mode, Always Use HTTPS, minimum TLS, HSTS, with warnings for the weak settings).

**Email and SMS: Resend** (`RESEND_API_KEY`), **Postmark** (`POSTMARK_SERVER_TOKEN`), **Twilio** (`TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`)

`resend_emails`, `resend_email`. `postmark_messages`, `postmark_bounces`. `twilio_messages` (status, error code, cost; numbers masked, bodies never returned).

**Errors and uptime: Sentry** (`SENTRY_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`), **Better Stack** (`BETTERSTACK_TOKEN`)

`sentry_issues`, `sentry_issue` (latest event, in-app frames, release, environment). `uptime_monitors`, `uptime_incidents`.

**Commerce: Shopify** (`SHOPIFY_SHOP` + `SHOPIFY_ACCESS_TOKEN`)

`shopify_orders` (payment and fulfillment status), `shopify_order` (one order with items, discounts, shipping, fulfillments, refunds).

**Code: GitHub** (`GITHUB_TOKEN` + `GITHUB_REPO`)

`github_commits`, `github_ci_runs`, `github_open_prs`.

Only the services whose variables are set are loaded. One is enough. A misconfigured service is skipped with a message on stderr; it never takes the server down.

### Install

```bash
claude mcp add ops \
  -e STRIPE_SECRET_KEY=rk_test_... \
  -e DATABASE_URL=postgres://... \
  -e VERCEL_TOKEN=... -e VERCEL_TEAM_ID=team_... -e VERCEL_PROJECT=prj_... \
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

All variables: `STRIPE_SECRET_KEY` (`STRIPE_MCP_ALLOW_LIVE=1` for live keys), `DATABASE_URL` (`PG_TLS_NO_VERIFY=1` for self-signed servers), `NEON_API_KEY` (`NEON_PROJECT_ID`), `VERCEL_TOKEN` (`VERCEL_TEAM_ID`, `VERCEL_PROJECT`), `NETLIFY_TOKEN` (`NETLIFY_SITE`), `RENDER_API_KEY`, `CLOUDFLARE_API_TOKEN` (`CLOUDFLARE_ZONE`), `RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`, `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`, `SENTRY_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` (`SENTRY_URL` for self-hosted), `BETTERSTACK_TOKEN`, `SHOPIFY_SHOP` + `SHOPIFY_ACCESS_TOKEN`, `GITHUB_TOKEN` + `GITHUB_REPO`.

### Security model

This server is built to be pointed at production, so the protections are in the code, not in the README:

* **Read-only by construction.** There is no tool that writes. Postgres queries run inside `BEGIN READ ONLY` with a `statement_timeout`, and anything that is not a single `SELECT` / `WITH` / `EXPLAIN` / `SHOW` is rejected before it leaves the process.
* **Live Stripe keys are refused** unless `STRIPE_MCP_ALLOW_LIVE=1`. Still read-only, but the agent would see real customers, so it is an explicit choice.
* **Personal data is masked** in every output: customer and recipient emails (`j***@example.com`), phone numbers (last 4 digits), bank accounts (last 4), tracking numbers (last 4). SMS bodies and email HTML are never returned.
* **Secrets never travel back to the agent.** Environment variable names only, never values. Error messages strip query strings, so an API that puts a token in the URL cannot leak it. Nothing is written to stdout except MCP frames; diagnostics go to stderr.
* **TLS is verified** for database connections by default; the opt-out is explicit.
* **Every HTTP call times out** (20 s) and **every tool output is capped** (24 000 characters), so a hung API or a chatty one cannot stall or flood the agent's context.
* **Untrusted content is labelled as such.** Commit messages, email subjects, error titles and order notes are user-generated. The server's MCP instructions tell the agent to treat everything it returns as data and never as instructions.
* **Least privilege is documented per service** below. Use the smallest token that works.

| Service | Token to create |
| --- | --- |
| Stripe | Restricted key, *Read* on Connect, Charges, Transfers, Payouts, Balance, Webhook Endpoints, Events |
| Postgres | A read-only role or a read replica (`sslmode=require`) |
| Neon | API key; project-scoped if your plan allows it |
| Vercel | Token scoped to the team; the server never reads variable values |
| Netlify, Render | Personal access token; both APIs are read for the tools used |
| Cloudflare | API token with Zone:Read and DNS:Read |
| Resend, Postmark | Read-only API key (Resend offers "sending access" vs "full access": pick neither if a read key exists; Postmark server token, read-only) |
| Twilio | A standard API key with read scope, or the auth token of a subaccount you use for reading |
| Sentry | Auth token with `project:read` and `event:read` |
| Better Stack | Team API token |
| Shopify | Custom app with `read_orders` only |
| GitHub | Fine-grained token with read on Contents, Actions, Pull requests |

### Ask it things

* "ops_status, then tell me what needs attention."
* "What happened in the last 2 hours across everything?"
* "The seller acct_1XYZ says they were never paid. Diagnose it."
* "Why is the site slow at 8 am?" (`neon_endpoints`: a compute that suspends after 5 minutes of idle is a cold start)
* "Is our Cloudflare zone actually encrypting to the origin?"
* "Show the bounced emails since the last deploy."
* "Which Sentry issues appeared after commit a1b2c3d?"
* "How many orders are stuck in `pending`, and when was the last one created?"

### Develop

```bash
npm install
npm test          # vitest: every service against a fake API, plus a real MCP client on the server
npm run typecheck
npm run dev       # stdio server with tsx
```

Adding a service is one file that implements `Provider` (`register` its tools, `status()`, optional `timeline()`), one `add(...)` line in `src/index.ts`, and a test with a fake fetch.

## Français

### Ce que ça fait

Un seul serveur MCP, en lecture seule, qui donne à ton agent (Claude Code, Claude Desktop, Cursor) une vue sur toute ta production: Stripe Connect, Postgres, Neon, Vercel, Netlify, Render, Cloudflare, Resend, Postmark, Twilio, Sentry, Better Stack, Shopify, GitHub. Deux outils regardent à travers tous les services: `ops_status` (tout l'état en un écran) et `ops_timeline` (tout ce qui s'est passé, dans l'ordre, tous services confondus). Plus des diagnostics qui expliquent *pourquoi* un vendeur n'est pas payé, pourquoi un virement échoue, pourquoi un build casse, pourquoi une zone Cloudflare est mal configurée.

### Sécurité

Aucun outil n'écrit quoi que ce soit. Les requêtes SQL roulent dans une transaction `READ ONLY` avec un délai maximal, et tout ce qui n'est pas un seul SELECT est refusé avant même de partir. Une clé Stripe live est refusée sauf opt-in explicite. Les courriels, numéros de téléphone, comptes bancaires et numéros de suivi sont masqués; les corps de SMS ne sont jamais retournés; les valeurs des variables d'environnement non plus. Les messages d'erreur ne contiennent jamais la query string (là où certains API mettent le jeton). TLS est vérifié par défaut. Chaque appel HTTP a un délai maximal et chaque sortie d'outil est plafonnée. Le serveur dit à l'agent que tout ce qui revient (messages de commit, sujets de courriels, titres d'erreurs) est de la donnée et jamais des instructions. Utilise toujours le plus petit jeton possible (tableau plus haut).

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
* « Pourquoi le site est lent à 8 h? » (`neon_endpoints`: un compute qui se suspend après 5 minutes d'inactivité, c'est un cold start)
* « Montre les courriels rebondis depuis le dernier déploiement. »

## License

MIT
