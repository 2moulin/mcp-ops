import type Stripe from 'stripe';
import type { StripeReader } from '../src/providers/stripe/client.js';

// In-memory Stripe, including the `expand` behaviour the diagnostics rely on.
export type Seed = {
  accounts?: Partial<Stripe.Account>[];
  charges?: Partial<Stripe.Charge>[];
  transfers?: Partial<Stripe.Transfer>[];
  balanceTransactions?: Partial<Stripe.BalanceTransaction>[];
  balance?: Partial<Stripe.Balance>;
  balances?: Record<string, Partial<Stripe.Balance>>;
  payouts?: Partial<Stripe.Payout>[];
  webhookEndpoints?: Partial<Stripe.WebhookEndpoint>[];
  events?: Partial<Stripe.Event>[];
};

const list = <T>(data: T[], limit = 10): Stripe.ApiList<T> => ({ object: 'list', data: data.slice(0, limit), has_more: data.length > limit, url: '' });

export function fakeStripe(seed: Seed): StripeReader & { calls: string[] } {
  const calls: string[] = [];
  const find = <T extends { id?: string }>(arr: T[] | undefined, id: string, what: string): T => {
    const hit = (arr ?? []).find((x) => x.id === id);
    if (!hit) throw Object.assign(new Error(`No such ${what}: ${id}`), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
    return hit;
  };
  const expandCharge = (c: Partial<Stripe.Charge>, expand: string[] = []) => {
    const out = { ...c } as Stripe.Charge;
    if (expand.includes('balance_transaction') && typeof c.balance_transaction === 'string') {
      out.balance_transaction = find(seed.balanceTransactions, c.balance_transaction, 'balance transaction') as Stripe.BalanceTransaction;
    }
    if (expand.includes('transfer') && typeof c.transfer === 'string') {
      out.transfer = find(seed.transfers, c.transfer, 'transfer') as Stripe.Transfer;
    }
    return out;
  };
  return {
    calls,
    accounts: {
      async list(p) { calls.push('accounts.list'); return list(seed.accounts as Stripe.Account[], p.limit); },
      async retrieve(id) { calls.push(`accounts.retrieve:${id}`); return find(seed.accounts, id, 'account') as Stripe.Account; },
    },
    balance: {
      async retrieve(_p, opts) {
        calls.push(`balance.retrieve:${opts?.stripeAccount ?? 'platform'}`);
        const b = opts?.stripeAccount ? seed.balances?.[opts.stripeAccount] : seed.balance;
        return { object: 'balance', available: [], pending: [], livemode: false, ...(b ?? {}) } as Stripe.Balance;
      },
    },
    transfers: {
      async list(p) {
        calls.push('transfers.list');
        let data = (seed.transfers ?? []) as Stripe.Transfer[];
        if (p.destination) data = data.filter((t) => t.destination === p.destination);
        return list(data, p.limit);
      },
      async retrieve(id, p) {
        calls.push(`transfers.retrieve:${id}`);
        const t = { ...find(seed.transfers, id, 'transfer') } as Stripe.Transfer;
        if (p?.expand?.includes('source_transaction') && typeof t.source_transaction === 'string') {
          t.source_transaction = expandCharge(find(seed.charges, t.source_transaction, 'charge'), ['balance_transaction']);
        }
        return t;
      },
    },
    charges: {
      async list(p, opts) { calls.push(`charges.list:${opts?.stripeAccount ?? 'platform'}`); return list((seed.charges ?? []).map((c) => c as Stripe.Charge), p.limit); },
      async retrieve(id, p) { calls.push(`charges.retrieve:${id}`); return expandCharge(find(seed.charges, id, 'charge'), p?.expand); },
    },
    payouts: {
      async list(p, opts) { calls.push(`payouts.list:${opts?.stripeAccount}`); return list((seed.payouts ?? []) as Stripe.Payout[], p.limit); },
    },
    webhookEndpoints: {
      async list() { calls.push('webhookEndpoints.list'); return list((seed.webhookEndpoints ?? []) as Stripe.WebhookEndpoint[], 100); },
    },
    events: {
      async list(p) {
        calls.push('events.list');
        let data = (seed.events ?? []) as Stripe.Event[];
        const gte = typeof p.created === 'object' && p.created && 'gte' in p.created ? p.created.gte : undefined;
        if (gte) data = data.filter((e) => e.created >= gte);
        if (typeof p.type === 'string') {
          const t = p.type;
          data = t.endsWith('*') ? data.filter((e) => e.type.startsWith(t.slice(0, -1))) : data.filter((e) => e.type === t);
        }
        return list(data, p.limit);
      },
      async retrieve(id) { calls.push(`events.retrieve:${id}`); return find(seed.events, id, 'event') as Stripe.Event; },
    },
  };
}
