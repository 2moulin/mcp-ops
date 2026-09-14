import type Stripe from 'stripe';
import type { StripeReader } from '../stripe.js';
import { isoDate, money } from '../format.js';

function acct(accountId?: string): Stripe.RequestOptions | undefined {
  return accountId ? { stripeAccount: accountId } : undefined;
}

export async function getBalance(stripe: StripeReader, accountId?: string): Promise<string> {
  const b = await stripe.balance.retrieve({}, acct(accountId));
  const who = accountId ? `connected account ${accountId}` : 'platform account';
  const fmt = (list: Stripe.Balance.Available[] | Stripe.Balance.Pending[]) =>
    list.map((x) => `  ${money(x.amount, x.currency)}`).join('\n') || '  0';
  const out = [`Balance of ${who}`, `available:\n${fmt(b.available)}`, `pending:\n${fmt(b.pending)}`];
  if (b.connect_reserved?.length) out.push(`connect reserved:\n${fmt(b.connect_reserved as Stripe.Balance.Available[])}`);
  if (b.instant_available?.length) out.push(`instant available:\n${fmt(b.instant_available as Stripe.Balance.Available[])}`);
  return out.join('\n');
}

export async function listTransfers(stripe: StripeReader, opts: { destination?: string; limit: number; sinceDays?: number }): Promise<string> {
  const params: Stripe.TransferListParams = { limit: opts.limit };
  if (opts.destination) params.destination = opts.destination;
  if (opts.sinceDays) params.created = { gte: Math.floor(Date.now() / 1000) - opts.sinceDays * 86400 };
  const res = await stripe.transfers.list(params);
  if (res.data.length === 0) return 'No transfers match.';
  const lines = res.data.map((t) => {
    const src = typeof t.source_transaction === 'string' ? t.source_transaction : t.source_transaction?.id ?? 'balance';
    const dest = typeof t.destination === 'string' ? t.destination : t.destination?.id ?? 'n/a';
    const rev = t.amount_reversed ? `  reversed:${money(t.amount_reversed, t.currency)}` : '';
    return `${t.id}  ${isoDate(t.created).slice(0, 10)}  ${money(t.amount, t.currency).padStart(14)}  -> ${dest}  from:${src}${rev}`;
  });
  return `${res.data.length} transfer(s)${res.has_more ? ' (more available)' : ''}\n\n${lines.join('\n')}`;
}

export async function listCharges(stripe: StripeReader, opts: { accountId?: string; limit: number }): Promise<string> {
  const res = await stripe.charges.list({ limit: opts.limit }, acct(opts.accountId));
  if (res.data.length === 0) return 'No charges.';
  const lines = res.data.map((c) => {
    const dest = typeof c.transfer_data?.destination === 'string' ? c.transfer_data.destination : c.transfer_data?.destination?.id;
    const bits = [
      c.id,
      isoDate(c.created).slice(0, 10),
      money(c.amount, c.currency).padStart(14),
      c.status,
      c.refunded ? 'refunded' : '',
      c.disputed ? 'DISPUTED' : '',
      dest ? `dest:${dest}` : '',
      c.application_fee_amount != null ? `fee:${money(c.application_fee_amount, c.currency)}` : '',
      c.transfer ? `transfer:${typeof c.transfer === 'string' ? c.transfer : c.transfer.id}` : '',
    ].filter(Boolean);
    return bits.join('  ');
  });
  return `${res.data.length} charge(s) on ${opts.accountId ?? 'platform'}${res.has_more ? ' (more available)' : ''}\n\n${lines.join('\n')}`;
}

export async function listPayouts(stripe: StripeReader, opts: { accountId: string; limit: number }): Promise<string> {
  const res = await stripe.payouts.list({ limit: opts.limit }, acct(opts.accountId));
  if (res.data.length === 0) return `No payouts on ${opts.accountId}.`;
  const lines = res.data.map((p) => {
    const fail = p.failure_code ? `  FAILED ${p.failure_code}: ${p.failure_message ?? ''}` : '';
    return `${p.id}  arrives:${isoDate(p.arrival_date).slice(0, 10)}  ${money(p.amount, p.currency).padStart(14)}  ${p.status}  ${p.method}${fail}`;
  });
  return `${res.data.length} payout(s) on ${opts.accountId}${res.has_more ? ' (more available)' : ''}\n\n${lines.join('\n')}`;
}
