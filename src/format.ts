// Small formatting helpers shared by every tool. Everything the agent sees goes through here,
// so masking and money formatting stay consistent.

const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/** Stripe amounts are in the smallest unit. Turn 1234 + "cad" into "12.34 CAD". */
export function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !currency) return 'n/a';
  const cur = currency.toLowerCase();
  const major = ZERO_DECIMAL.has(cur) ? amount : amount / 100;
  return `${major.toFixed(ZERO_DECIMAL.has(cur) ? 0 : 2)} ${cur.toUpperCase()}`;
}

/** "david.demoulin@example.com" -> "d***@example.com". Enough to recognise, not enough to leak. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'n/a';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** "+1 418 555 1234" -> "+1 ***1234". */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return 'n/a';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `${phone.startsWith('+') ? '+' : ''}***${digits.slice(-4)}`;
}

export function isoDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return 'n/a';
  return new Date(unixSeconds * 1000).toISOString();
}

export function yesNo(v: boolean | null | undefined): string {
  return v ? 'yes' : 'no';
}

/** Render a list of key/value rows as aligned text. */
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
