<div align="center">

# mcp-ops

**Give your AI agent read-only eyes on your whole production stack.**

[![license: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
&nbsp;![node](https://img.shields.io/badge/node-%E2%89%A520-3C873A?logo=node.js&logoColor=white)
&nbsp;![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
&nbsp;![Model Context Protocol](https://img.shields.io/badge/MCP-server-6E56CF)
&nbsp;![read-only by construction](https://img.shields.io/badge/read--only-by%20construction-brightgreen)
&nbsp;![services](https://img.shields.io/badge/services-14-0A7EA4)
&nbsp;![tests](https://img.shields.io/badge/tests-38%20passing-3C873A)

Stripe · Postgres · Neon · Vercel · Netlify · Render · Cloudflare · Resend · Postmark · Twilio · Sentry · Better Stack · Shopify · GitHub

One MCP server. Every service behind two tools that see across all of them. Nothing it can touch is ever written.

</div>

---

Stop opening a dozen tabs when prod breaks. Ask once:

```
> what happened in the last 90 minutes?

13:02  github   commit          fix: transfer funded in the settled currency
13:04  vercel   deploy ready    production win-beta [main]
13:11  stripe   payment         pi_3Q… 135.00 CAD
13:11  stripe   transfer.created tr_1Q… 128.00 CAD → acct_1N… (webhook pending)
13:11  resend   email delivered Your order is confirmed → j***@example.com
13:12  sentry   issue error     WIN-42 cannot read 'currency' (x3, first 2m ago)
13:14  uptime   incident        WIN HTTP 502
```

## Two tools that look everywhere

| | |
|---|---|
| **`ops_status`** | The whole stack in one screen. Start here. |
| **`ops_timeline`** | Deploys, commits, payments, errors, emails, incidents — merged and sorted. "What changed before it broke." |

Plus per-service tools, and diagnostics that explain *why*: a blocked payout, a failed transfer, a broken build, a weak TLS setting.

## Install

```bash
claude mcp add ops \
  -e STRIPE_SECRET_KEY=rk_test_... \
  -e DATABASE_URL=postgres://... \
  -e GITHUB_TOKEN=ghp_... -e GITHUB_REPO=owner/name \
  -- npx -y mcp-ops
```

<details>
<summary>Claude Desktop / Cursor (JSON)</summary>

```json
{
  "mcpServers": {
    "ops": {
      "command": "npx",
      "args": ["-y", "mcp-ops"],
      "env": {
        "STRIPE_SECRET_KEY": "rk_test_...",
        "DATABASE_URL": "postgres://...",
        "GITHUB_TOKEN": "ghp_...",
        "GITHUB_REPO": "owner/name"
      }
    }
  }
}
```
</details>

Set only the services you use — one is enough. A misconfigured service is skipped, never the server.

## Services & keys

| Service | Variables | Key |
|---|---|---|
| Stripe Connect | `STRIPE_SECRET_KEY` | restricted, read scopes |
| Postgres | `DATABASE_URL` | read-only role or replica |
| Neon | `NEON_API_KEY` `[NEON_PROJECT_ID]` | API key |
| Vercel | `VERCEL_TOKEN` `[VERCEL_TEAM_ID]` `[VERCEL_PROJECT]` | team-scoped |
| Netlify | `NETLIFY_TOKEN` `[NETLIFY_SITE]` | personal token |
| Render | `RENDER_API_KEY` | API key |
| Cloudflare | `CLOUDFLARE_API_TOKEN` `[CLOUDFLARE_ZONE]` | Zone:Read, DNS:Read |
| Resend | `RESEND_API_KEY` | read key |
| Postmark | `POSTMARK_SERVER_TOKEN` | server token |
| Twilio | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | read scope |
| Sentry | `SENTRY_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` `[SENTRY_URL]` | `project:read`, `event:read` |
| Better Stack | `BETTERSTACK_TOKEN` | team token |
| Shopify | `SHOPIFY_SHOP` + `SHOPIFY_ACCESS_TOKEN` | `read_orders` |
| GitHub | `GITHUB_TOKEN` + `GITHUB_REPO` | read Contents, Actions, PRs |

## Read-only by construction

- **No tool writes.** Postgres runs inside `BEGIN READ ONLY` with a timeout; anything but a single `SELECT`/`WITH`/`EXPLAIN` is rejected before it leaves the process.
- **Live Stripe keys refused** unless `STRIPE_MCP_ALLOW_LIVE=1`.
- **PII masked** everywhere: emails, phones, bank & tracking numbers to last 4. SMS bodies and env values never returned.
- **Secrets stay put.** Error messages strip query strings. TLS verified by default. Every call times out, every output is capped.
- Returned content (commit messages, subjects, order notes) is labelled untrusted so the agent treats it as data, not instructions.

## Ask it

- *"ops_status, then tell me what needs attention."*
- *"acct_1XYZ says they were never paid — diagnose it."*
- *"Is our Cloudflare zone actually encrypting to origin?"*
- *"Which Sentry issues appeared after commit a1b2c3d?"*
- *"How many orders are stuck in pending, and since when?"*

## Develop

```bash
npm install
npm test        # every service vs a fake API + a real MCP client
npm run dev     # stdio server
```

A new service is one file (`Provider`: `register`, `status`, optional `timeline`) and one line in `src/index.ts`.

## License

MIT © [David Demoulin](https://github.com/2moulin)
