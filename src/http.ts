export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const HTTP_TIMEOUT_MS = 20000;

export class HttpError extends Error {
  constructor(public status: number, body: string, url: string) {
    // Some APIs put the token in the query string; the agent sees this message.
    super(`HTTP ${status} from ${url.replace(/\?.*$/, '')}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

export function jsonClient(baseUrl: string, headers: Record<string, string>, fetcher: Fetcher = fetch) {
  return async <T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> => {
    const url = new URL(path.startsWith('http') ? path : baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const res = await fetcher(url.toString(), { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, url.toString());
    return (text ? JSON.parse(text) : null) as T;
  };
}

export function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export function ago(d: Date | number | string, now = Date.now()): string {
  const t = typeof d === 'number' ? (d > 1e12 ? d : d * 1000) : new Date(d).getTime();
  if (Number.isNaN(t)) return 'n/a';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function clip(s: string, max = 4000): string {
  return s.length > max ? s.slice(0, max) + '\n... (clipped)' : s;
}
