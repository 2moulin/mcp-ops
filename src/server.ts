import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Guard, Provider, TimelineItem, ToolResult } from './provider.js';

/** Every tool goes through this so a provider error becomes a readable line instead of a crash. */
const guard: Guard = (fn) => async (args) => {
  try {
    return { content: [{ type: 'text', text: await fn(args) }] } satisfies ToolResult;
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string };
    const detail = [e.type, e.code].filter(Boolean).join(' ');
    return { content: [{ type: 'text', text: `Error${detail ? ` (${detail})` : ''}: ${e.message ?? String(err)}` }], isError: true };
  }
};

export function createServer(providers: Provider[]): McpServer {
  const server = new McpServer({ name: 'mcp-ops', version: '0.2.0' });
  const names = providers.map((p) => p.name);

  for (const p of providers) p.register(server, guard);

  server.registerTool('ops_status', {
    title: 'Status of the whole stack',
    description: `One line per connected service (${names.join(', ')}): balances, blocked accounts, failing webhooks, last deploy, open errors, bounced emails, database size and connections. Start here.`,
    inputSchema: {},
  }, guard(async () => {
    const lines = await Promise.all(providers.map(async (p) => {
      try { return await p.status(); } catch (err) { return `${p.name}: unavailable (${(err as Error).message.slice(0, 160)})`; }
    }));
    return lines.join('\n');
  }));

  server.registerTool('ops_timeline', {
    title: 'What happened, across every service',
    description: 'One chronological list mixing deploys, commits, CI runs, Stripe events, Sentry issues and emails for the last N minutes. The fastest way to answer "what changed before things broke".',
    inputSchema: {
      since_minutes: z.number().int().min(1).max(60 * 24 * 14).default(120),
      sources: z.array(z.string()).optional().describe(`Restrict to some of: ${names.join(', ')}`),
      limit: z.number().int().min(5).max(300).default(80),
    },
  }, guard(async ({ since_minutes, sources, limit }) => {
    const since = new Date(Date.now() - since_minutes * 60000);
    const picked = providers.filter((p) => p.timeline && (!sources || sources.includes(p.name)));
    const results = await Promise.all(picked.map(async (p) => {
      try { return await p.timeline!(since, limit); } catch (err) { return [{ at: new Date(), source: p.name, kind: 'unavailable', text: (err as Error).message.slice(0, 160) }] as TimelineItem[]; }
    }));
    const items = results.flat().sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-limit);
    if (items.length === 0) return `Nothing from ${picked.map((p) => p.name).join(', ')} in the last ${since_minutes} minutes.`;
    const w = Math.max(...items.map((i) => i.source.length));
    return `${items.length} event(s) since ${since.toISOString()}\n\n` + items.map((i) => `${i.at.toISOString().slice(0, 19).replace('T', ' ')}  ${i.source.padEnd(w)}  ${i.kind.padEnd(28)}  ${i.text}`).join('\n');
  }));

  return server;
}
