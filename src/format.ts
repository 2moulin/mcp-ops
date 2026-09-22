const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !currency) return 'n/a';
  const cur = currency.toLowerCase();
  const decimals = ZERO_DECIMAL.has(cur) ? 0 : THREE_DECIMAL.has(cur) ? 3 : 2;
  const major = amount / (decimals === 0 ? 1 : decimals === 3 ? 1000 : 100);
  return `${major.toFixed(decimals)} ${cur.toUpperCase()}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'n/a';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return 'n/a';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `${phone.startsWith('+') ? '+' : ''}***${digits.slice(-4)}`;
}

// Keys whose string value is personal data and must never leave verbatim.
const REDACT_KEY = /^(name|line1|line2|address_line1|address_line2|postal_code|address_zip|city|tax_id|id_number|ssn_last_4|ip_address|client_ip|address)$/i;

// Deep-copy an arbitrary API object with personal data masked in place, so a raw
// payload (e.g. a Stripe event) can be shown without leaking emails, phones or addresses.
export function redactPii(value: unknown, depth = 0): unknown {
  if (value == null || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => redactPii(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && /email/i.test(k)) out[k] = maskEmail(v);
      else if (typeof v === 'string' && /phone/i.test(k)) out[k] = maskPhone(v);
      else if (typeof v === 'string' && REDACT_KEY.test(k)) out[k] = '***';
      else out[k] = redactPii(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function isoDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return 'n/a';
  return new Date(unixSeconds * 1000).toISOString();
}

export function yesNo(v: boolean | null | undefined): string {
  return v ? 'yes' : 'no';
}

export function rows(pairs: Array<[string, string | number | boolean | null | undefined]>): string {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${k.padEnd(width)}  ${v ?? 'n/a'}`).join('\n');
}

export type Finding = { level: 'ok' | 'warn' | 'error'; text: string };

export function renderFindings(title: string, findings: Finding[]): string {
  const icon = { ok: 'OK   ', warn: 'WARN ', error: 'ERROR' } as const;
  const body = findings.map((f) => `${icon[f.level]} ${f.text}`).join('\n');
  const worst = findings.some((f) => f.level === 'error') ? 'problems found' : findings.some((f) => f.level === 'warn') ? 'warnings' : 'all clear';
  return `${title}\n${'-'.repeat(title.length)}\n${body}\n\nVerdict: ${worst}`;
}
