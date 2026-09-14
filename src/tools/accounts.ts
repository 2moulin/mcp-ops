import type Stripe from 'stripe';
import type { StripeReader } from '../stripe.js';
import { isoDate, maskEmail, rows, yesNo } from '../format.js';

export function summarizeAccount(a: Stripe.Account): string {
  const req = a.requirements;
  return rows([
    ['id', a.id],
    ['type', a.type ?? 'n/a'],
    ['email', maskEmail(a.email)],
    ['country', a.country],
    ['default currency', a.default_currency?.toUpperCase()],
    ['charges enabled', yesNo(a.charges_enabled)],
    ['payouts enabled', yesNo(a.payouts_enabled)],
    ['details submitted', yesNo(a.details_submitted)],
    ['requirements due now', req?.currently_due?.length ?? 0],
    ['requirements past due', req?.past_due?.length ?? 0],
    ['disabled reason', req?.disabled_reason ?? 'none'],
    ['created', isoDate(a.created)],
  ]);
}

export async function listAccounts(stripe: StripeReader, limit: number): Promise<string> {
  const res = await stripe.accounts.list({ limit });
  if (res.data.length === 0) return 'No connected accounts.';
  const lines = res.data.map((a) => {
    const flags = [a.charges_enabled ? 'charges' : '', a.payouts_enabled ? 'payouts' : ''].filter(Boolean).join('+') || 'disabled';
    const due = a.requirements?.currently_due?.length ?? 0;
    return `${a.id}  ${(a.type ?? '?').padEnd(8)}  ${(a.country ?? '??')}  ${(a.default_currency ?? '???').toUpperCase()}  ${flags.padEnd(15)}  due:${due}  ${maskEmail(a.email)}`;
  });
  return `${res.data.length} connected account(s)${res.has_more ? ' (more available, raise limit)' : ''}\n\n${lines.join('\n')}`;
}

export async function getAccount(stripe: StripeReader, accountId: string): Promise<string> {
  const a = await stripe.accounts.retrieve(accountId);
  const caps = Object.entries(a.capabilities ?? {}).map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  none';
  const ext = a.external_accounts?.data ?? [];
  const extLines = ext.map((e) => {
    if (e.object === 'bank_account') return `  bank ${e.bank_name ?? ''} ****${e.last4} (${e.currency.toUpperCase()}, ${e.status ?? 'n/a'})`;
    return `  card ${e.brand ?? ''} ****${e.last4}`;
  }).join('\n') || '  none';
  const req = a.requirements;
  return [
    summarizeAccount(a),
    '',
    `dashboard: ${a.controller?.stripe_dashboard?.type ?? (a.type === 'custom' ? 'none' : 'n/a')}`,
    `capabilities:\n${caps}`,
    `external accounts:\n${extLines}`,
    `requirements currently due: ${req?.currently_due?.join(', ') || 'none'}`,
    `requirements past due: ${req?.past_due?.join(', ') || 'none'}`,
    `requirements eventually due: ${req?.eventually_due?.join(', ') || 'none'}`,
    `requirements deadline: ${isoDate(req?.current_deadline)}`,
  ].join('\n');
}
