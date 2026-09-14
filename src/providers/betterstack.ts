import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';

type Monitor = { id: string; attributes: { url: string; pronounceable_name?: string; status: string; last_checked_at?: string; monitor_type?: string; check_frequency?: number; paused?: boolean } };
type Incident = { id: string; attributes: { name: string; cause?: string; started_at: string; resolved_at?: string | null; acknowledged_at?: string | null; url?: string; http_code?: number } };

export function betterstackProvider(opts: { token: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://uptime.betterstack.com/api/v2', { authorization: `Bearer ${opts.token}` }, opts.fetcher);
  const monitors = async () => (await get<{ data: Monitor[] }>('/monitors', { per_page: 100 })).data ?? [];
  const incidents = async (per_page: number) => (await get<{ data: Incident[] }>('/incidents', { per_page })).data ?? [];

  return {
    name: 'uptime',
    register(server, guard: Guard) {
      server.registerTool('uptime_monitors', {
        title: 'Uptime monitors',
        description: 'Better Stack monitors with status (up, down, paused, pending), check frequency and last check.',
        inputSchema: {},
      }, guard(async () => (await monitors()).map((m) => `${m.id.padEnd(10)}  ${m.attributes.status.toUpperCase().padEnd(8)}  ${(m.attributes.pronounceable_name ?? '').padEnd(28)}  ${m.attributes.url}  every ${m.attributes.check_frequency ?? '?'}s  checked ${m.attributes.last_checked_at ? ago(m.attributes.last_checked_at) : 'n/a'}`).join('\n') || 'No monitors.'));

      server.registerTool('uptime_incidents', {
        title: 'Uptime incidents',
        description: 'Recent incidents with cause, start, resolution and HTTP code.',
        inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      }, guard(async ({ limit }) => (await incidents(limit)).map((i) => `${i.id.padEnd(10)}  started ${ago(i.attributes.started_at).padStart(7)}  ${i.attributes.resolved_at ? `resolved ${ago(i.attributes.resolved_at)}` : 'ONGOING'}  ${i.attributes.name}  ${i.attributes.cause ?? ''}${i.attributes.http_code ? ` (HTTP ${i.attributes.http_code})` : ''}`).join('\n') || 'No incidents.'));
    },

    async status() {
      const ms = await monitors();
      const down = ms.filter((m) => m.attributes.status === 'down');
      return `uptime: ${ms.length} monitor(s), ${down.length} DOWN${down.length ? ` (${down.map((m) => m.attributes.pronounceable_name || m.attributes.url).join(', ')})` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const list = await incidents(Math.min(limit, 100));
      const items: TimelineItem[] = [];
      for (const i of list) {
        if (new Date(i.attributes.started_at) >= since) items.push({ at: new Date(i.attributes.started_at), source: 'uptime', kind: 'incident started', text: `${i.attributes.name} ${i.attributes.cause ?? ''}` });
        if (i.attributes.resolved_at && new Date(i.attributes.resolved_at) >= since) items.push({ at: new Date(i.attributes.resolved_at), source: 'uptime', kind: 'incident resolved', text: i.attributes.name });
      }
      return items;
    },
  };
}
