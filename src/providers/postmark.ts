import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';
import { maskEmail } from '../format.js';

type Message = { MessageID: string; To: Array<{ Email: string }>; Subject: string; Status: string; ReceivedAt: string; MessageStream?: string };
type Bounce = { ID: number; Type: string; Email: string; Subject: string; BouncedAt: string; Description?: string; Inactive?: boolean };

export function postmarkProvider(opts: { serverToken: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.postmarkapp.com', { 'x-postmark-server-token': opts.serverToken }, opts.fetcher);

  return {
    name: 'postmark',
    register(server, guard: Guard) {
      server.registerTool('postmark_messages', {
        title: 'Postmark outbound messages',
        description: 'Recent outbound emails with status (Sent, Queued, Processed). Recipients masked.',
        inputSchema: { limit: z.number().int().min(1).max(100).default(25), status: z.enum(['queued', 'sent', 'processed']).optional() },
      }, guard(async ({ limit, status }) => {
        const res = await get<{ Messages: Message[] }>('/messages/outbound', { count: limit, offset: 0, status });
        return (res.Messages ?? []).map((m) => `${m.MessageID}  ${ago(m.ReceivedAt).padStart(7)}  ${m.Status.padEnd(9)}  ${m.To.map((t) => maskEmail(t.Email)).join(', ').padEnd(28)}  ${m.Subject}`).join('\n') || 'No messages.';
      }));

      server.registerTool('postmark_bounces', {
        title: 'Postmark bounces',
        description: 'Recent bounces with type (HardBounce, SoftBounce, SpamComplaint, Transient ...) and whether the address was deactivated.',
        inputSchema: { limit: z.number().int().min(1).max(100).default(25) },
      }, guard(async ({ limit }) => {
        const res = await get<{ Bounces: Bounce[] }>('/bounces', { count: limit, offset: 0 });
        return (res.Bounces ?? []).map((b) => `${String(b.ID).padEnd(12)}  ${ago(b.BouncedAt).padStart(7)}  ${b.Type.padEnd(14)}  ${maskEmail(b.Email).padEnd(28)}${b.Inactive ? '  INACTIVE' : ''}  ${b.Subject}`).join('\n') || 'No bounces.';
      }));
    },

    async status() {
      const [stats, msgs] = await Promise.all([get<{ InactiveMails: number; Bounces: Array<{ Name: string; Count: number }> }>('/deliverystats'), get<{ Messages: Message[] }>('/messages/outbound', { count: 1, offset: 0 })]);
      const total = (stats.Bounces ?? []).find((b) => b.Name === 'All')?.Count ?? (stats.Bounces ?? []).reduce((n, b) => n + b.Count, 0);
      return `postmark: ${total} bounce(s) on record, ${stats.InactiveMails} inactive address(es)${msgs.Messages?.[0] ? `, last sent ${ago(msgs.Messages[0].ReceivedAt)}` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const res = await get<{ Bounces: Bounce[] }>('/bounces', { count: Math.min(limit, 100), offset: 0 });
      return (res.Bounces ?? []).filter((b) => new Date(b.BouncedAt) >= since).map((b) => ({ at: new Date(b.BouncedAt), source: 'postmark', kind: `bounce ${b.Type}`, text: `${maskEmail(b.Email)} ${b.Subject}` }));
    },
  };
}
