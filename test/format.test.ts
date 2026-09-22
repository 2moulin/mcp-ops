import { describe, expect, it } from 'vitest';
import { money, redactPii } from '../src/format.js';

describe('money', () => {
  it('formats two-decimal currencies', () => {
    expect(money(13500, 'cad')).toBe('135.00 CAD');
    expect(money(99, 'usd')).toBe('0.99 USD');
  });

  it('formats zero-decimal currencies without dividing', () => {
    expect(money(5000, 'jpy')).toBe('5000 JPY');
  });

  it('formats three-decimal currencies as thousandths', () => {
    expect(money(5000, 'kwd')).toBe('5.000 KWD');
    expect(money(1234, 'bhd')).toBe('1.234 BHD');
  });

  it('returns n/a for missing amount or currency', () => {
    expect(money(null, 'cad')).toBe('n/a');
    expect(money(100, undefined)).toBe('n/a');
  });
});

describe('redactPii', () => {
  it('masks emails, phones and address fields anywhere in the tree', () => {
    const out = redactPii({
      id: 'evt_1',
      amount: 13500,
      billing_details: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+15145551234',
        address: { line1: '1 Main St', postal_code: 'H0H 0H0', city: 'Montreal', country: 'CA' },
      },
      receipt_email: 'jane@example.com',
    }) as Record<string, any>;

    expect(out.id).toBe('evt_1');
    expect(out.amount).toBe(13500);
    expect(out.billing_details.email).toBe('j***@example.com');
    expect(out.billing_details.phone).toBe('+***1234');
    expect(out.billing_details.name).toBe('***');
    expect(out.billing_details.address.line1).toBe('***');
    expect(out.billing_details.address.postal_code).toBe('***');
    expect(out.billing_details.address.country).toBe('CA');
    expect(out.receipt_email).toBe('j***@example.com');
  });

  it('leaves primitives and arrays of non-PII untouched', () => {
    expect(redactPii(42)).toBe(42);
    expect(redactPii(['a', 'b'])).toEqual(['a', 'b']);
  });
});
