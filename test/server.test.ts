import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { stripeProvider } from '../src/providers/stripe/index.js';
import { fakeStripe } from './fake-stripe.js';

async function connect(seed: Parameters<typeof fakeStripe>[0]) {
  const stripe = fakeStripe(seed);
  const server = createServer([stripeProvider(stripe, 'test')]);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientT);
  return { client, stripe };
}

const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;

describe('server', () => {
  it('exposes the read-only tool set plus the cross-provider tools', async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'ops_status', 'ops_timeline',
      'stripe_balance', 'stripe_diagnose_account', 'stripe_diagnose_transfer', 'stripe_get_account', 'stripe_get_event',
      'stripe_list_accounts', 'stripe_list_charges', 'stripe_list_events', 'stripe_list_payouts', 'stripe_list_transfers',
      'stripe_list_webhook_endpoints',
    ]);
  });

  it('ops_status summarises the provider and ops_timeline orders its events', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { client } = await connect({
      balance: { available: [{ amount: 250000, currency: 'cad', source_types: {} }], pending: [] } as never,
      accounts: [{ id: 'acct_1', charges_enabled: true, payouts_enabled: false, requirements: { currently_due: ['x'] } } as never],
      events: [
        { id: 'evt_old', type: 'charge.succeeded', created: now - 7200, data: { object: { id: 'ch_old', amount: 100, currency: 'cad' } }, pending_webhooks: 0 } as never,
        { id: 'evt_new', type: 'transfer.created', created: now - 60, data: { object: { id: 'tr_new', amount: 5000, currency: 'cad' } }, pending_webhooks: 1 } as never,
      ],
    });
    const status = textOf(await client.callTool({ name: 'ops_status', arguments: {} }));
    expect(status).toContain('stripe (test): available 2500.00 CAD; 1 connected accounts, 1 blocked, 1 with requirements due');
    const tl = textOf(await client.callTool({ name: 'ops_timeline', arguments: { since_minutes: 60 } }));
    expect(tl).toContain('transfer.created');
    expect(tl).toContain('50.00 CAD');
    expect(tl).toContain('(webhook pending x1)');
  });

  it('lists accounts with masked emails', async () => {
    const { client } = await connect({ accounts: [{ id: 'acct_1', type: 'express', country: 'CA', default_currency: 'cad', email: 'someone@example.com', charges_enabled: true, payouts_enabled: false, requirements: { currently_due: ['a', 'b'] } } as never] });
    const out = textOf(await client.callTool({ name: 'stripe_list_accounts', arguments: {} }));
    expect(out).toContain('acct_1');
    expect(out).toContain('s***@example.com');
    expect(out).not.toContain('someone@');
    expect(out).toContain('due:2');
  });

  it('reads a connected account balance with the stripeAccount header', async () => {
    const { client, stripe } = await connect({ balances: { acct_1: { available: [{ amount: 12345, currency: 'cad', source_types: {} }], pending: [] } as never } });
    const out = textOf(await client.callTool({ name: 'stripe_balance', arguments: { account_id: 'acct_1' } }));
    expect(out).toContain('123.45 CAD');
    expect(stripe.calls).toContain('balance.retrieve:acct_1');
  });

  it('turns a Stripe error into a readable tool error', async () => {
    const { client } = await connect({});
    const res = await client.callTool({ name: 'stripe_get_account', arguments: { account_id: 'acct_missing' } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('resource_missing');
  });

  it('rejects an account id that is not acct_', async () => {
    const { client } = await connect({});
    const res = await client.callTool({ name: 'stripe_get_account', arguments: { account_id: 'cus_123' } });
    expect(res.isError).toBe(true);
  });

  it('filters events by prefix', async () => {
    const { client } = await connect({ events: [
      { id: 'evt_1', type: 'payment_intent.succeeded', created: 1, data: { object: { id: 'pi_1' } }, pending_webhooks: 0 } as never,
      { id: 'evt_2', type: 'account.updated', created: 2, data: { object: { id: 'acct_1' } }, pending_webhooks: 2 } as never,
    ] });
    const out = textOf(await client.callTool({ name: 'stripe_list_events', arguments: { type: 'payment_intent.' } }));
    expect(out).toContain('evt_1');
    expect(out).not.toContain('evt_2');
  });
});
