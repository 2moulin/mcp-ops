import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, clip, jsonClient, type Fetcher } from '../http.js';
import { maskEmail } from '../format.js';

type Email = { id: string; to: string[] | string; from: string; subject: string; created_at: string; last_event?: string; html?: string; text?: string; bcc?: string[] | null; cc?: string[] | null; reply_to?: string[] | null };

export function resendProvider(opts: { apiKey: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.resend.com', { authorization: `Bearer ${opts.apiKey}` }, opts.fetcher);
  const toList = (to: Email['to']) => (Array.isArray(to) ? to : [to]).map(maskEmail).join(', ');
  const line = (e: Email) => `${e.id}  ${ago(e.created_at).padStart(7)}  ${(e.last_event ?? 'sent').padEnd(10)}  ${toList(e.to).padEnd(28)}  ${e.subject}`;

  async function list(limit: number): Promise<Email[]> {
    const res = await get<{ data: Email[] }>('/emails', { limit });
    return res.data ?? [];
  }

  return {
    name: 'resend',
    register(server, guard: Guard) {
      server.registerTool('resend_emails', {
        title: 'Recent emails',
        description: 'Transactional emails sent through Resend with their last event (delivered, bounced, complained, delivery_delayed, opened). Recipients are masked.',
        inputSchema: { limit: z.number().int().min(1).max(100).default(25), status: z.string().optional().describe('Only this last_event, e.g. bounced') },
      }, guard(async ({ limit, status }) => {
        let emails = await list(limit);
        if (status) emails = emails.filter((e) => e.last_event === status);
        return emails.length ? `${emails.length} email(s)\n\n${emails.map(line).join('\n')}` : 'No emails match.';
      }));

      server.registerTool('resend_email', {
        title: 'One email',
        description: 'Details of one sent email: recipients (masked), subject, last event, and the text body (clipped). HTML is not returned.',
        inputSchema: { email_id: z.string() },
      }, guard(async ({ email_id }) => {
        const e = await get<Email>(`/emails/${email_id}`);
        return clip([
          `${e.id}  ${e.created_at}  last_event: ${e.last_event ?? 'sent'}`,
          `from: ${e.from}`, `to: ${toList(e.to)}`, `subject: ${e.subject}`, '',
          e.text ?? (e.html ? e.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '(no body returned)'),
        ].join('\n'), 5000);
      }));
    },

    async status() {
      const emails = await list(100);
      const bad = emails.filter((e) => ['bounced', 'complained', 'delivery_delayed'].includes(e.last_event ?? ''));
      const last = emails[0];
      return `resend: ${emails.length}${emails.length === 100 ? '+' : ''} recent emails, ${bad.length} bounced/complained/delayed${last ? `, last sent ${ago(last.created_at)}` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const emails = await list(Math.min(100, limit));
      return emails.filter((e) => new Date(e.created_at) >= since).map((e) => ({
        at: new Date(e.created_at), source: 'resend', kind: `email ${e.last_event ?? 'sent'}`, text: `${e.subject} -> ${toList(e.to)}`,
      }));
    },
  };
}
