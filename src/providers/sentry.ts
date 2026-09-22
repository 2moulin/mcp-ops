import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, clip, jsonClient, type Fetcher } from '../http.js';
import { maskEmail } from '../format.js';

type Issue = { id: string; shortId: string; title: string; culprit?: string; level?: string; count: string; userCount: number; firstSeen: string; lastSeen: string; status: string; permalink?: string };

export function sentryProvider(opts: { token: string; org: string; project: string; baseUrl?: string; fetcher?: Fetcher }): Provider {
  const base = (opts.baseUrl ?? 'https://sentry.io').replace(/\/$/, '');
  const get = jsonClient(base, { authorization: `Bearer ${opts.token}` }, opts.fetcher);
  const line = (i: Issue) => `${i.shortId.padEnd(12)}  ${(i.level ?? '').padEnd(7)}  x${String(i.count).padEnd(6)}  ${String(i.userCount).padStart(4)} users  last ${ago(i.lastSeen).padStart(7)}  ${i.title.slice(0, 80)}${i.culprit ? `  (${i.culprit.slice(0, 50)})` : ''}`;

  async function issues(query: string, limit: number): Promise<Issue[]> {
    const res = await get<Issue[]>(`/api/0/projects/${opts.org}/${opts.project}/issues/`, { query, sort: 'date', limit });
    return Array.isArray(res) ? res : [];
  }

  return {
    name: 'sentry',
    register(server, guard: Guard) {
      server.registerTool('sentry_issues', {
        title: 'Sentry issues',
        description: 'Unresolved issues sorted by last seen, with event count, affected users and culprit. `query` uses Sentry search syntax (default "is:unresolved").',
        inputSchema: { query: z.string().default('is:unresolved'), limit: z.number().int().min(1).max(100).default(20) },
      }, guard(async ({ query, limit }) => {
        const list = await issues(query, limit);
        return list.length ? `${list.length} issue(s)\n\n${list.map(line).join('\n')}` : 'No issues match.';
      }));

      server.registerTool('sentry_issue', {
        title: 'One Sentry issue',
        description: 'An issue with its latest event: message, stack frames from your own code, tags (release, environment, url, user id).',
        inputSchema: { issue_id: z.string().describe('Numeric issue id') },
      }, guard(async ({ issue_id }) => {
        const [issue, ev] = await Promise.all([
          get<Issue>(`/api/0/issues/${issue_id}/`),
          get<{ message?: string; title?: string; tags?: Array<{ key: string; value: string }>; entries?: Array<{ type: string; data?: { values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: Array<{ filename?: string; function?: string; lineNo?: number; inApp?: boolean }> } }> } }> }>(`/api/0/issues/${issue_id}/events/latest/`),
        ]);
        const frames = (ev.entries ?? []).flatMap((e) => e.data?.values ?? []).flatMap((v) => (v.stacktrace?.frames ?? []).filter((f) => f.inApp).slice(-8).map((f) => `  ${f.filename}:${f.lineNo} in ${f.function ?? '?'}`));
        const exc = (ev.entries ?? []).flatMap((e) => e.data?.values ?? []).map((v) => `${v.type}: ${v.value}`);
        const tags = (ev.tags ?? []).filter((t) => ['release', 'environment', 'url', 'user', 'browser', 'transaction', 'handled'].includes(t.key)).map((t) => {
          // A `user` tag is often an email; a `url` can carry PII or tokens in its query string.
          const value = t.key === 'user' && t.value.includes('@') ? maskEmail(t.value) : t.key === 'url' ? t.value.replace(/\?.*$/, '') : t.value;
          return `${t.key}=${value}`;
        });
        return clip([
          `${issue.shortId}  ${issue.status}  ${issue.level ?? ''}  x${issue.count}  ${issue.userCount} users  first ${ago(issue.firstSeen)}  last ${ago(issue.lastSeen)}`,
          issue.title, issue.permalink ?? '', '', ...exc, ...(frames.length ? ['in-app frames:', ...frames] : []), '', tags.join('  '),
        ].join('\n'), 6000);
      }));
    },

    async status() {
      const list = await issues('is:unresolved', 100);
      const day = Date.now() - 86400000;
      const fresh = list.filter((i) => new Date(i.lastSeen).getTime() > day);
      const users = fresh.reduce((n, i) => n + (i.userCount || 0), 0);
      return `sentry: ${list.length}${list.length === 100 ? '+' : ''} unresolved issues, ${fresh.length} seen in the last 24 h affecting ${users} users${fresh[0] ? `; latest: ${fresh[0].title.slice(0, 60)}` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const list = await issues('is:unresolved', limit);
      return list.filter((i) => new Date(i.lastSeen) >= since).map((i) => ({
        at: new Date(i.lastSeen), source: 'sentry', kind: `issue ${i.level ?? ''} last seen`, text: `${i.shortId} ${i.title.slice(0, 70)} (x${i.count}, first ${ago(i.firstSeen)})`,
      }));
    },
  };
}
