import { describe, expect, it } from 'vitest';
import { diagnoseAccount, diagnoseTransfer } from '../src/tools/diagnose.js';
import { fakeStripe } from './fake-stripe.js';

const healthyAccount = {
  id: 'acct_ok', type: 'custom', country: 'CA', default_currency: 'cad', charges_enabled: true, payouts_enabled: true,
  requirements: { currently_due: [], past_due: [], eventually_due: [], disabled_reason: null, errors: [] },
  capabilities: { card_payments: 'active', transfers: 'active' },
  external_accounts: { object: 'list', data: [{ object: 'bank_account', id: 'ba_1', last4: '1234', currency: 'cad', status: 'new' }], has_more: false, url: '' },
  tos_acceptance: { date: 1700000000 },
} as never;

describe('diagnoseTransfer', () => {
  it('flags a transfer whose currency is not the charge settlement currency', async () => {
    // A USD-presented charge that settled in CAD, and a transfer wrongly made in USD.
    const stripe = fakeStripe({
      accounts: [healthyAccount],
      balanceTransactions: [{ id: 'txn_1', currency: 'cad', amount: 13500, fee: 700, net: 12800 }],
      charges: [{ id: 'ch_1', currency: 'usd', amount: 10000, status: 'succeeded', balance_transaction: 'txn_1' }],
      transfers: [{ id: 'tr_1', amount: 9680, currency: 'usd', destination: 'acct_ok', source_transaction: 'ch_1', amount_reversed: 0, reversed: false }],
    });
    const out = await diagnoseTransfer(stripe, 'tr_1');
    expect(out).toContain('ERROR Transfer is in USD but its source charge settled in CAD');
    expect(out).toContain('Verdict: problems found');
  });

  it('flags an amount above the charge net', async () => {
    const stripe = fakeStripe({
      accounts: [healthyAccount],
      balanceTransactions: [{ id: 'txn_1', currency: 'cad', amount: 10000, fee: 320, net: 9680 }],
      charges: [{ id: 'ch_1', currency: 'cad', amount: 10000, status: 'succeeded', balance_transaction: 'txn_1' }],
      transfers: [{ id: 'tr_1', amount: 10000, currency: 'cad', destination: 'acct_ok', source_transaction: 'ch_1', amount_reversed: 0, reversed: false }],
    });
    const out = await diagnoseTransfer(stripe, 'tr_1');
    expect(out).toContain('exceeds the charge\'s net 96.80 CAD');
    expect(out).toContain('OK    Currency matches');
  });

  it('checks the platform balance when there is no source transaction', async () => {
    const stripe = fakeStripe({
      accounts: [healthyAccount],
      balance: { available: [{ amount: 500, currency: 'cad', source_types: {} }], pending: [] } as never,
      transfers: [{ id: 'tr_1', amount: 2000, currency: 'cad', destination: 'acct_ok', source_transaction: null, amount_reversed: 0, reversed: false }],
    });
    const out = await diagnoseTransfer(stripe, 'tr_1');
    expect(out).toContain('WARN  No source_transaction');
    expect(out).toContain('ERROR Platform available balance in CAD is 5.00 CAD');
  });

  it('accepts a charge id and tells the caller the allowed currency and amount', async () => {
    const stripe = fakeStripe({
      balanceTransactions: [{ id: 'txn_1', currency: 'cad', amount: 13500, fee: 700, net: 12800 }],
      charges: [{ id: 'ch_1', currency: 'usd', amount: 10000, status: 'succeeded', balance_transaction: 'txn_1', transfer: null }],
    });
    const out = await diagnoseTransfer(stripe, 'ch_1');
    expect(out).toContain('must be in CAD');
    expect(out).toContain('at most 128.00 CAD');
    expect(out).toContain('Do not use charge.currency');
  });

  it('reports a destination that cannot receive payouts', async () => {
    const stripe = fakeStripe({
      accounts: [{ ...(healthyAccount as object), id: 'acct_bad', payouts_enabled: false, requirements: { currently_due: ['external_account'], past_due: [], eventually_due: [], disabled_reason: 'requirements.past_due', errors: [] } } as never],
      balanceTransactions: [{ id: 'txn_1', currency: 'cad', amount: 10000, fee: 320, net: 9680 }],
      charges: [{ id: 'ch_1', currency: 'cad', amount: 10000, status: 'succeeded', balance_transaction: 'txn_1' }],
      transfers: [{ id: 'tr_1', amount: 9000, currency: 'cad', destination: 'acct_bad', source_transaction: 'ch_1', amount_reversed: 0, reversed: false }],
    });
    const out = await diagnoseTransfer(stripe, 'tr_1');
    expect(out).toContain('ERROR Destination acct_bad has payouts disabled (requirements.past_due)');
    expect(out).toContain('1 requirement(s) currently due: external_account');
  });
});

describe('diagnoseAccount', () => {
  it('is all clear for a healthy account', async () => {
    const stripe = fakeStripe({ accounts: [healthyAccount] });
    const out = await diagnoseAccount(stripe, 'acct_ok');
    expect(out).toContain('Verdict: all clear');
    expect(out).toContain('No Stripe dashboard (custom account)');
  });

  it('lists what blocks a broken account', async () => {
    const stripe = fakeStripe({ accounts: [{
      id: 'acct_x', type: 'custom', country: 'CA', default_currency: 'cad', charges_enabled: false, payouts_enabled: false,
      requirements: { currently_due: ['individual.dob.day'], past_due: ['external_account'], eventually_due: [], disabled_reason: 'requirements.past_due', errors: [{ requirement: 'individual.id_number', reason: 'The ID number is invalid', code: 'invalid_value_other' }] },
      capabilities: { card_payments: 'inactive', transfers: 'pending' },
      external_accounts: { object: 'list', data: [], has_more: false, url: '' },
    } as never] });
    const out = await diagnoseAccount(stripe, 'acct_x');
    expect(out).toContain('ERROR Charges DISABLED');
    expect(out).toContain('ERROR Past due: external_account');
    expect(out).toContain('WARN  Currently due: individual.dob.day');
    expect(out).toContain('ERROR Capability card_payments is inactive');
    expect(out).toContain('WARN  Capability transfers is pending');
    expect(out).toContain('ERROR No external account');
    expect(out).toContain('individual.id_number: The ID number is invalid');
    expect(out).toContain('Terms of service not accepted');
  });
});
