import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import type { Provider } from '../src/provider.js';
import type { Fetcher } from '../src/http.js';
import { assertReadOnly, postgresProvider, type DbReader } from '../src/providers/postgres.js';
import { vercelProvider } from '../src/providers/vercel.js';
import { resendProvider } from '../src/providers/resend.js';
import { sentryProvider } from '../src/providers/sentry.js';
import { githubProvider } from '../src/providers/github.js';

/** A fetch that answers from a route table: first matching substring wins. */
function fakeFetch(routes: Record<string, unknown>): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as Fetcher & { urls: string[] };
  f.urls = urls;
  return f;
}

async function connect(providers: Provider[]) {
  const server = createServer(providers);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(c);
  return client;
}
const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;
const min = (m: number) => new Date(Date.now() - m * 60000).toISOString();

describe('postgres', () => {
  it('assertReadOnly blocks writes, multi-statements and DDL', () => {
    expect(() => assertReadOnly('SELECT 1')).not.toThrow();
    expect(() => assertReadOnly('  with x as (select 1) select * from x')).not.toThrow();
    expect(() => assertReadOnly('EXPLAIN SELECT 1')).not.toThrow();
    expect(() => assertReadOnly('DELETE FROM users')).toThrow(/Only SELECT/);
    expect(() => assertReadOnly('SELECT 1; DROP TABLE users')).toThrow(/One statement/);
    expect(() => assertReadOnly("SELECT * FROM t WHERE 1=1 -- ; drop table t")).not.toThrow();
    expect(() => assertReadOnly('select pg_terminate_backend(1) from (values(1)) v')).not.toThrow(); // functions are the database's job to refuse in READ ONLY
    expect(() => assertReadOnly('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d')).toThrow(/write or DDL/);
  });

  it('db_query runs through the reader and renders a table', async () => {
    const seen: string[] = [];
    const db: DbReader = { async query(sql) { seen.push(sql); return { rows: [{ id: 1, name: 'a' }, { id: 2, name: null }], rowCount: 2 }; } };
    const client = await connect([postgresProvider(db)]);
    const out = textOf(await client.callTool({ name: 'db_query', arguments: { sql: 'select id, name from users' } }));
    expect(out).toContain('2 row(s)');
    expect(out).toContain('NULL');
    expect(seen).toEqual(['select id, name from users']);
    const bad = await client.callTool({ name: 'db_query', arguments: { sql: 'update users set name = 1' } });
    expect(bad.isError).toBe(true);
    expect(seen).toHaveLength(1);
  });
});

describe('vercel', () => {
  it('lists deployments and builds a timeline', async () => {
    const now = Date.now();
    const fetcher = fakeFetch({ '/v6/deployments': { deployments: [
      { uid: 'dpl_1', name: 'win', url: 'win.vercel.app', readyState: 'READY', created: now - 60000, target: 'production', meta: { githubCommitRef: 'main', githubCommitMessage: 'fix: thing' } },
      { uid: 'dpl_2', name: 'win', url: 'x', readyState: 'ERROR', created: now - 3600000, target: null, errorMessage: 'Build failed' },
    ] } });
    const client = await connect([vercelProvider({ token: 't', teamId: 'team_1', project: 'prj_1', fetcher })]);
    const out = textOf(await client.callTool({ name: 'vercel_deployments', arguments: {} }));
    expect(out).toContain('dpl_1');
    expect(out).toContain('READY');
    expect(out).toContain('ERROR: Build failed');
    expect(fetcher.urls[0]).toContain('teamId=team_1');
    expect(fetcher.urls[0]).toContain('projectId=prj_1');
    const status = textOf(await client.callTool({ name: 'ops_status', arguments: {} }));
    expect(status).toContain('last production deploy READY');
    expect(status).toContain('1 failed');
    const tl = textOf(await client.callTool({ name: 'ops_timeline', arguments: { since_minutes: 30 } }));
    expect(tl).toContain('deploy ready');
    expect(tl).not.toContain('dpl_2');
  });
});

describe('resend', () => {
  it('masks recipients and flags bounces', async () => {
    const fetcher = fakeFetch({ '/emails': { data: [
      { id: 'em_1', to: ['someone@example.com'], from: 'hi@win.ai', subject: 'Welcome', created_at: min(5), last_event: 'delivered' },
      { id: 'em_2', to: 'bad@example.com', from: 'hi@win.ai', subject: 'Receipt', created_at: min(50), last_event: 'bounced' },
    ] } });
    const client = await connect([resendProvider({ apiKey: 'k', fetcher })]);
    const out = textOf(await client.callTool({ name: 'resend_emails', arguments: { status: 'bounced' } }));
    expect(out).toContain('em_2');
    expect(out).toContain('b***@example.com');
    expect(out).not.toContain('em_1');
    const status = textOf(await client.callTool({ name: 'ops_status', arguments: {} }));
    expect(status).toContain('1 bounced/complained/delayed');
  });
});

describe('sentry', () => {
  it('lists issues and summarises the last 24 h', async () => {
    const fetcher = fakeFetch({ '/issues/': [
      { id: '1', shortId: 'WIN-1', title: 'TypeError: x is undefined', level: 'error', count: '42', userCount: 7, firstSeen: min(600), lastSeen: min(3), status: 'unresolved', culprit: 'app/page.tsx' },
      { id: '2', shortId: 'WIN-2', title: 'Old thing', level: 'warning', count: '3', userCount: 1, firstSeen: min(9000), lastSeen: min(5000), status: 'unresolved' },
    ] });
    const client = await connect([sentryProvider({ token: 't', org: 'o', project: 'p', fetcher })]);
    const out = textOf(await client.callTool({ name: 'sentry_issues', arguments: {} }));
    expect(out).toContain('WIN-1');
    expect(out).toContain('x42');
    expect(fetcher.urls[0]).toContain('/api/0/projects/o/p/issues/');
    const status = textOf(await client.callTool({ name: 'ops_status', arguments: {} }));
    expect(status).toContain('2 unresolved issues, 1 seen in the last 24 h affecting 7 users');
  });
});

describe('github', () => {
  it('reads commits and CI runs', async () => {
    const fetcher = fakeFetch({
      '/commits': [{ sha: 'abcdef1234567', commit: { message: 'feat: ship it\n\nbody', author: { name: 'David', date: min(10) } }, author: { login: '2moulin' } }],
      '/actions/runs': { workflow_runs: [{ id: 9, name: 'ci', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: min(9), updated_at: min(8), html_url: '', head_commit: { message: 'feat: ship it' } }] },
      '/pulls': [],
    });
    const client = await connect([githubProvider({ token: 't', repo: '2moulin/win', fetcher })]);
    const out = textOf(await client.callTool({ name: 'github_commits', arguments: {} }));
    expect(out).toContain('abcdef123');
    expect(out).toContain('feat: ship it');
    expect(out).not.toContain('body');
    const status = textOf(await client.callTool({ name: 'ops_status', arguments: {} }));
    expect(status).toContain('last CI success');
    const tl = textOf(await client.callTool({ name: 'ops_timeline', arguments: { since_minutes: 30 } }));
    expect(tl).toContain('commit');
    expect(tl).toContain('ci success');
  });
});

describe('ops_status', () => {
  it('keeps going when one provider is down', async () => {
    const broken: Provider = { name: 'broken', register() {}, async status() { throw new Error('boom'); } };
    const fetcher = fakeFetch({ '/pulls': [], '/commits': [], '/actions/runs': { workflow_runs: [] } });
    const client = await connect([broken, githubProvider({ token: 't', repo: 'a/b', fetcher })]);
    const status = textOf(await client.callTool({ name: 'ops_status', arguments: {} }));
    expect(status).toContain('broken: unavailable (boom)');
    expect(status).toContain('github a/b');
  });
});
