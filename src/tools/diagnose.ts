import type Stripe from 'stripe';
import type { StripeReader } from '../stripe.js';
import { money, renderFindings, type Finding } from '../format.js';

/**
 * Why did (or will) this transfer fail? The checks below are the ones that bite real Connect
 * platforms: wrong settlement currency, amount above the charge's net, a destination that cannot
 * receive payouts, an unfunded platform balance.
 */
export async function diagnoseTransfer(stripe: StripeReader, idOrChargeId: string): Promise<string> {
  const f: Finding[] = [];
  let transfer: Stripe.Transfer | null = null;
  let charge: Stripe.Charge | null = null;

  if (idOrChargeId.startsWith('tr_')) {
    transfer = await stripe.transfers.retrieve(idOrChargeId, { expand: ['source_transaction'] });
    const src = transfer.source_transaction;
    if (src && typeof src !== 'string') charge = src as Stripe.Charge;
    else if (typeof src === 'string' && src.startsWith('ch_')) charge = await stripe.charges.retrieve(src, { expand: ['balance_transaction'] });
  } else if (idOrChargeId.startsWith('ch_') || idOrChargeId.startsWith('py_')) {
    charge = await stripe.charges.retrieve(idOrChargeId, { expand: ['balance_transaction', 'transfer'] });
    if (charge.transfer && typeof charge.transfer !== 'string') transfer = charge.transfer;
    else if (typeof charge.transfer === 'string') transfer = await stripe.transfers.retrieve(charge.transfer, { expand: ['source_transaction'] });
  } else {
    return 'Give a transfer id (tr_...) or a charge id (ch_... / py_...).';
  }

  // Make sure the charge carries its balance transaction, which is where the settlement currency lives.
  if (charge && (!charge.balance_transaction || typeof charge.balance_transaction === 'string')) {
    charge = await stripe.charges.retrieve(charge.id, { expand: ['balance_transaction'] });
  }
  const bt = charge?.balance_transaction && typeof charge.balance_transaction !== 'string' ? charge.balance_transaction : null;

  if (!transfer) {
    f.push({ level: 'warn', text: `Charge ${charge?.id} has no transfer attached yet.` });
    if (charge && bt) {
      f.push({ level: 'ok', text: `A transfer funded from this charge must be in ${bt.currency.toUpperCase()} (its settlement currency) and at most ${money(bt.net, bt.currency)} (net after Stripe fees).` });
      if (charge.currency !== bt.currency) {
        f.push({ level: 'warn', text: `Charge was presented in ${charge.currency.toUpperCase()} but settled in ${bt.currency.toUpperCase()}. Do not use charge.currency for the transfer; use balance_transaction.currency.` });
      }
    }
    return renderFindings(`Transfer diagnosis for ${charge?.id}`, f);
  }

  const dest = typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id;
  f.push({ level: 'ok', text: `Transfer ${transfer.id}: ${money(transfer.amount, transfer.currency)} to ${dest ?? 'n/a'}${transfer.transfer_group ? ` (group ${transfer.transfer_group})` : ''}.` });

  if (transfer.amount_reversed) {
    f.push({ level: transfer.reversed ? 'warn' : 'ok', text: `${money(transfer.amount_reversed, transfer.currency)} of it has been reversed${transfer.reversed ? ' (fully reversed)' : ''}.` });
  }

  // Funding source checks.
  if (charge && bt) {
    if (transfer.currency !== bt.currency) {
      f.push({ level: 'error', text: `Transfer is in ${transfer.currency.toUpperCase()} but its source charge settled in ${bt.currency.toUpperCase()}. A transfer funded from a charge must use the charge's settlement currency (balance_transaction.currency).` });
    } else {
      f.push({ level: 'ok', text: `Currency matches the source charge's settlement currency (${bt.currency.toUpperCase()}).` });
    }
    if (transfer.amount > bt.net) {
      f.push({ level: 'error', text: `Transfer amount ${money(transfer.amount, transfer.currency)} exceeds the charge's net ${money(bt.net, bt.currency)} (gross ${money(bt.amount, bt.currency)} minus fees ${money(bt.fee, bt.currency)}).` });
    } else {
      f.push({ level: 'ok', text: `Amount is within the charge's net (${money(bt.net, bt.currency)}).` });
    }
    if (charge.status !== 'succeeded') f.push({ level: 'error', text: `Source charge status is "${charge.status}".` });
    if (charge.refunded) f.push({ level: 'warn', text: 'Source charge is fully refunded; the transfer should be reversed.' });
    else if (charge.amount_refunded) f.push({ level: 'warn', text: `Source charge is partially refunded (${money(charge.amount_refunded, charge.currency)}); check that the transfer was reversed proportionally.` });
    if (charge.disputed) f.push({ level: 'warn', text: 'Source charge is disputed; funds may be pulled back.' });
  } else {
    f.push({ level: 'warn', text: 'No source_transaction: this transfer is funded from the platform available balance, not from a specific charge.' });
    try {
      const bal = await stripe.balance.retrieve();
      const avail = bal.available.find((x) => x.currency === transfer!.currency);
      if (!avail || avail.amount < transfer.amount) {
        f.push({ level: 'error', text: `Platform available balance in ${transfer.currency.toUpperCase()} is ${money(avail?.amount ?? 0, transfer.currency)}, below the transfer amount. Stripe rejects this with "insufficient funds".` });
      } else {
        f.push({ level: 'ok', text: `Platform available balance covers it (${money(avail.amount, transfer.currency)}).` });
      }
    } catch (err) {
      f.push({ level: 'warn', text: `Could not read platform balance: ${(err as Error).message}` });
    }
  }

  // Destination checks.
  if (dest) {
    try {
      const a = await stripe.accounts.retrieve(dest);
      if (!a.payouts_enabled) f.push({ level: 'error', text: `Destination ${dest} has payouts disabled${a.requirements?.disabled_reason ? ` (${a.requirements.disabled_reason})` : ''}. Money lands in its balance but cannot be paid out.` });
      else f.push({ level: 'ok', text: `Destination ${dest} can receive payouts.` });
      if (a.default_currency && a.default_currency !== transfer.currency) {
        f.push({ level: 'warn', text: `Destination default currency is ${a.default_currency.toUpperCase()} but the transfer is in ${transfer.currency.toUpperCase()}. It needs an external account in ${transfer.currency.toUpperCase()}, otherwise Stripe converts at payout with a conversion fee.` });
      }
      const due = a.requirements?.currently_due?.length ?? 0;
      if (due) f.push({ level: 'warn', text: `Destination has ${due} requirement(s) currently due: ${a.requirements?.currently_due?.join(', ')}.` });
    } catch (err) {
      f.push({ level: 'warn', text: `Could not read destination account: ${(err as Error).message}` });
    }
  }

  return renderFindings(`Transfer diagnosis for ${transfer.id}`, f);
}

/** Why can't this connected account charge or get paid? */
export async function diagnoseAccount(stripe: StripeReader, accountId: string): Promise<string> {
  const a = await stripe.accounts.retrieve(accountId);
  const f: Finding[] = [];
  const req = a.requirements;

  f.push({ level: a.charges_enabled ? 'ok' : 'error', text: `Charges ${a.charges_enabled ? 'enabled' : 'DISABLED'}.` });
  f.push({ level: a.payouts_enabled ? 'ok' : 'error', text: `Payouts ${a.payouts_enabled ? 'enabled' : 'DISABLED'}.` });
  if (req?.disabled_reason) f.push({ level: 'error', text: `Disabled reason: ${req.disabled_reason}.` });
  if (req?.past_due?.length) f.push({ level: 'error', text: `Past due: ${req.past_due.join(', ')}.` });
  if (req?.currently_due?.length) f.push({ level: 'warn', text: `Currently due: ${req.currently_due.join(', ')}${req.current_deadline ? ` (deadline ${new Date(req.current_deadline * 1000).toISOString().slice(0, 10)})` : ''}.` });
  if (req?.eventually_due?.length) f.push({ level: 'ok', text: `Eventually due (no deadline yet): ${req.eventually_due.join(', ')}.` });
  if (req?.errors?.length) f.push({ level: 'error', text: `Verification errors: ${req.errors.map((e) => `${e.requirement}: ${e.reason}`).join('; ')}.` });

  for (const [name, status] of Object.entries(a.capabilities ?? {})) {
    if (status !== 'active') f.push({ level: status === 'pending' ? 'warn' : 'error', text: `Capability ${name} is ${status}.` });
  }

  const ext = a.external_accounts?.data ?? [];
  if (ext.length === 0) f.push({ level: 'error', text: 'No external account (bank or card). Payouts are impossible until one is added.' });
  else {
    const currencies = [...new Set(ext.map((e) => (e.currency ?? '???').toUpperCase()))];
    f.push({ level: 'ok', text: `${ext.length} external account(s) in ${currencies.join(', ')}.` });
    if (a.default_currency && !currencies.includes(a.default_currency.toUpperCase())) {
      f.push({ level: 'warn', text: `No external account in the default currency ${a.default_currency.toUpperCase()}.` });
    }
  }

  const dash = a.controller?.stripe_dashboard?.type ?? (a.type === 'custom' ? 'none' : a.type === 'express' ? 'express' : 'full');
  if (dash === 'none') f.push({ level: 'ok', text: 'No Stripe dashboard (custom account): login links do not work, your platform must render everything.' });
  else f.push({ level: 'ok', text: `Dashboard type: ${dash}.` });

  if (a.type === 'custom' && !a.tos_acceptance?.date) f.push({ level: 'warn', text: 'Terms of service not accepted yet (tos_acceptance.date is empty).' });

  const sched = a.settings?.payouts?.schedule;
  if (sched) f.push({ level: 'ok', text: `Payout schedule: ${sched.interval}${sched.delay_days != null ? `, ${sched.delay_days} day delay` : ''}${sched.weekly_anchor ? `, ${sched.weekly_anchor}` : ''}${sched.monthly_anchor ? `, day ${sched.monthly_anchor}` : ''}.` });

  return renderFindings(`Account diagnosis for ${accountId}`, f);
}
