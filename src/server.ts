import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StripeReader } from './stripe.js';
import { getAccount, listAccounts } from './tools/accounts.js';
import { getBalance, listCharges, listPayouts, listTransfers } from './tools/money.js';
import { getEvent, listEvents, listWebhookEndpoints } from './tools/webhooks.js';
import { diagnoseAccount, diagnoseTransfer } from './tools/diagnose.js';

const accountId = z.string().regex(/^acct_[A-Za-z0-9]+$/, 'a connected account id, like acct_1ABC...');
const limit = z.number().int().min(1).max(100).default(20);

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function text(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }] };
}

/** Every tool goes through this so a Stripe error becomes a readable line instead of a crash. */
function guard<A>(fn: (args: A) => Promise<string>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return text(await fn(args));
    } catch (err) {
      const e = err as { type?: string; code?: string; message?: string };
      const detail = [e.type, e.code].filter(Boolean).join(' ');
      return { content: [{ type: 'text', text: `Stripe error${detail ? ` (${detail})` : ''}: ${e.message ?? String(err)}` }], isError: true };
    }
  };
}

export function createServer(stripe: StripeReader, mode: 'live' | 'test' | 'unknown'): McpServer {
  const server = new McpServer({ name: 'mcp-stripe-connect', version: '0.1.0' });
  const modeNote = mode === 'live' ? ' Live mode: real money, real customers; everything here is read-only.' : '';

  server.registerTool('stripe_list_accounts', {
    title: 'List connected accounts',
    description: 'List the connected accounts of this Stripe Connect platform with their status (charges, payouts, requirements due).' + modeNote,
    inputSchema: { limit },
  }, guard(({ limit }) => listAccounts(stripe, limit)));

  server.registerTool('stripe_get_account', {
    title: 'Get a connected account',
    description: 'Full status of one connected account: capabilities, requirements, external accounts (last4 only), dashboard type.',
    inputSchema: { account_id: accountId },
  }, guard(({ account_id }) => getAccount(stripe, account_id)));

  server.registerTool('stripe_diagnose_account', {
    title: 'Diagnose a connected account',
    description: 'Explain why a connected account cannot charge or get paid out: disabled reasons, past-due requirements, capabilities, missing bank account, TOS.',
    inputSchema: { account_id: accountId },
  }, guard(({ account_id }) => diagnoseAccount(stripe, account_id)));

  server.registerTool('stripe_balance', {
    title: 'Balance',
    description: 'Available and pending balance per currency, for the platform (no account_id) or for one connected account.',
    inputSchema: { account_id: accountId.optional() },
  }, guard(({ account_id }) => getBalance(stripe, account_id)));

  server.registerTool('stripe_list_transfers', {
    title: 'List transfers',
    description: 'Transfers from the platform to connected accounts: amount, currency, destination, funding charge, reversals.',
    inputSchema: {
      destination: accountId.optional().describe('Only transfers to this connected account'),
      since_days: z.number().int().min(1).max(365).optional().describe('Only transfers created in the last N days'),
      limit,
    },
  }, guard(({ destination, since_days, limit }) => listTransfers(stripe, { destination, sinceDays: since_days, limit })));

  server.registerTool('stripe_diagnose_transfer', {
    title: 'Diagnose a transfer',
    description: 'Given a transfer id (tr_...) or a charge id (ch_...), check what makes Connect transfers fail: settlement currency of the source charge vs the transfer currency, amount above the charge net, platform balance too low, destination with payouts disabled, refunds and disputes.',
    inputSchema: { id: z.string().describe('tr_... or ch_...') },
  }, guard(({ id }) => diagnoseTransfer(stripe, id)));

  server.registerTool('stripe_list_charges', {
    title: 'List charges',
    description: 'Recent charges on the platform, or on one connected account (direct charges) when account_id is given. Shows destination, application fee and attached transfer.',
    inputSchema: { account_id: accountId.optional(), limit },
  }, guard(({ account_id, limit }) => listCharges(stripe, { accountId: account_id, limit })));

  server.registerTool('stripe_list_payouts', {
    title: 'List payouts of a connected account',
    description: 'Payouts from a connected account to its bank, with status, arrival date and failure reason.',
    inputSchema: { account_id: accountId, limit },
  }, guard(({ account_id, limit }) => listPayouts(stripe, { accountId: account_id, limit })));

  server.registerTool('stripe_list_webhook_endpoints', {
    title: 'List webhook endpoints',
    description: 'Webhook endpoints of the platform with their status, API version and enabled events.',
    inputSchema: {},
  }, guard(() => listWebhookEndpoints(stripe)));

  server.registerTool('stripe_list_events', {
    title: 'List events',
    description: 'Recent Stripe events. Filter by type ("payment_intent.succeeded") or by prefix ("payment_intent."). only_undelivered=true lists events whose webhook delivery is still failing.',
    inputSchema: {
      type: z.string().optional(),
      only_undelivered: z.boolean().optional(),
      limit,
    },
  }, guard(({ type, only_undelivered, limit }) => listEvents(stripe, { type, onlyUndelivered: only_undelivered, limit })));

  server.registerTool('stripe_get_event', {
    title: 'Get an event',
    description: 'One event with its payload (clipped at 6000 characters), pending webhook count and the request that caused it.',
    inputSchema: { event_id: z.string().regex(/^evt_[A-Za-z0-9]+$/) },
  }, guard(({ event_id }) => getEvent(stripe, event_id)));

  return server;
}
