# mcp-stripe-connect

**Let your AI agent read and diagnose a Stripe Connect platform. Read-only.**

An MCP server for Claude Code, Claude Desktop, Cursor and any other MCP client. It answers the questions you keep asking the Stripe dashboard when you run a marketplace: which connected accounts are blocked and why, where a transfer went, why a transfer failed, what the balance is on each side, which webhooks are not being delivered.

*Version française plus bas.*

## English

### What it does

| Tool | Answers |
| --- | --- |
| `stripe_list_accounts` | Which connected accounts exist, can they charge, can they get paid, what is due |
| `stripe_get_account` | Everything about one account: capabilities, requirements, bank accounts (last 4 only), dashboard type |
| `stripe_diagnose_account` | Why this account cannot charge or get paid out, as a checklist |
| `stripe_balance` | Available and pending balance of the platform, or of one connected account |
| `stripe_list_transfers` | Transfers to connected accounts, with the charge that funded each one and reversals |
| `stripe_diagnose_transfer` | Why a transfer failed or will fail: wrong settlement currency, amount above the charge net, platform balance too low, destination with payouts disabled, refund or dispute on the source charge |
| `stripe_list_charges` | Recent charges on the platform or on one connected account |
| `stripe_list_payouts` | Payouts from a connected account to its bank, with failure reasons |
| `stripe_list_webhook_endpoints` | Endpoints, status, API version, enabled events |
| `stripe_list_events` | Recent events, filter by type or prefix, or only the ones whose delivery is failing |
| `stripe_get_event` | One event with its payload and the request that caused it |

Every tool is a read. There is no tool that creates, updates or deletes anything, and the server refuses a live key unless you explicitly allow it.

### Install

```bash
npm install -g mcp-stripe-connect
```

Or run it with `npx` without installing (see below).

### Give it a key

Create a **restricted key** in the Stripe dashboard (Developers > API keys > Create restricted key) with *Read* on Connect, Charges, Transfers, Payouts, Balance, Webhook Endpoints and Events. Start with a test key.

### Add it to Claude Code

```bash
claude mcp add stripe-connect -e STRIPE_SECRET_KEY=rk_test_... -- npx -y mcp-stripe-connect
```

### Add it to Claude Desktop or Cursor

```json
{
  "mcpServers": {
    "stripe-connect": {
      "command": "npx",
      "args": ["-y", "mcp-stripe-connect"],
      "env": { "STRIPE_SECRET_KEY": "rk_test_..." }
    }
  }
}
```

### Live mode

Live keys are refused by default. If you want the agent reading real data, set `STRIPE_MCP_ALLOW_LIVE=1` as well. It is still read-only, but the agent will see real customers, so decide on purpose.

### Ask it things

* "Which connected accounts have requirements past due?"
* "Diagnose transfer tr_1ABC, the seller says they were never paid."
* "Why can't acct_1XYZ receive payouts?"
* "Show me the events from the last hour whose webhook delivery is failing."
* "What is the CAD balance of the platform versus acct_1XYZ?"

### Why the transfer diagnosis exists

The failure that costs the most time on a Connect platform is a transfer funded from a charge in the wrong currency. A charge presented in USD can settle in CAD; the transfer must then be in CAD, and at most the charge's net after fees. Stripe's error message does not say that. `stripe_diagnose_transfer` reads the charge's balance transaction and tells you exactly which of the usual suspects is wrong.

### Develop

```bash
npm install
npm test          # vitest, against an in-memory fake Stripe
npm run typecheck
npm run dev       # runs the server on stdio with tsx
```

## Français

### Ce que ça fait

Un serveur MCP en lecture seule pour ta plateforme Stripe Connect. Ton agent (Claude Code, Claude Desktop, Cursor) peut lister les comptes connectés et leur état, lire les soldes des deux côtés, suivre les virements et les paiements aux vendeurs, inspecter les webhooks et les événements, et surtout **diagnostiquer** pourquoi un compte ne peut pas être payé ou pourquoi un virement échoue (devise de règlement de la charge, montant au-dessus du net, solde de plateforme insuffisant, compte de destination bloqué).

Aucun outil n'écrit quoi que ce soit. Une clé live est refusée sauf si tu mets `STRIPE_MCP_ALLOW_LIVE=1`.

### Installation

Crée une **clé restreinte** dans le dashboard Stripe avec les droits *Lecture* sur Connect, Charges, Transfers, Payouts, Balance, Webhook Endpoints et Events. Commence avec une clé de test.

```bash
claude mcp add stripe-connect -e STRIPE_SECRET_KEY=rk_test_... -- npx -y mcp-stripe-connect
```

Pour Claude Desktop ou Cursor, le bloc JSON plus haut fonctionne tel quel.

### Exemples de questions

* « Quels comptes connectés ont des exigences en retard? »
* « Diagnostique le virement tr_1ABC, le vendeur dit qu'il n'a jamais été payé. »
* « Pourquoi acct_1XYZ ne peut pas recevoir de paiements? »
* « Montre-moi les événements de la dernière heure dont la livraison webhook échoue. »

## License

MIT
