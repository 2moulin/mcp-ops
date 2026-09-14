import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, basicAuth, jsonClient, type Fetcher } from '../http.js';
import { maskPhone } from '../format.js';

type Message = { sid: string; to: string; from: string; status: string; direction: string; date_sent: string | null; date_created: string; error_code: number | null; error_message: string | null; price?: string | null; price_unit?: string | null };

export function twilioProvider(opts: { accountSid: string; authToken: string; fetcher?: Fetcher }): Provider {
  if (!/^AC[0-9a-f]{32}$/i.test(opts.accountSid)) throw new Error('TWILIO_ACCOUNT_SID must look like AC + 32 hex characters.');
  const get = jsonClient(`https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}`, { authorization: basicAuth(opts.accountSid, opts.authToken) }, opts.fetcher);
  const line = (m: Message) => `${m.sid}  ${ago(m.date_sent ?? m.date_created).padStart(7)}  ${m.status.padEnd(11)}  ${m.direction.padEnd(14)}  ${maskPhone(m.from)} -> ${maskPhone(m.to)}${m.error_code ? `  ERROR ${m.error_code}: ${m.error_message ?? ''}` : ''}${m.price ? `  ${m.price} ${m.price_unit ?? ''}` : ''}`;

  return {
    name: 'twilio',
    register(server, guard: Guard) {
      server.registerTool('twilio_messages', {
        title: 'Twilio messages',
        description: 'Recent SMS/MMS with status (delivered, undelivered, failed, queued), direction, error code and cost. Phone numbers masked to the last 4 digits; bodies are not returned.',
        inputSchema: { status: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) },
      }, guard(async ({ status, limit }) => {
        const res = await get<{ messages: Message[] }>('/Messages.json', { PageSize: status ? 100 : limit });
        const ms = (res.messages ?? []).filter((m) => !status || m.status === status).slice(0, limit);
        return ms.map(line).join('\n') || 'No messages.';
      }));
    },

    async status() {
      const res = await get<{ messages: Message[] }>('/Messages.json', { PageSize: 100 });
      const ms = res.messages ?? [];
      const failed = ms.filter((m) => ['failed', 'undelivered'].includes(m.status)).length;
      return `twilio: ${ms.length}${ms.length === 100 ? '+' : ''} recent messages, ${failed} failed/undelivered${ms[0] ? `, last ${ago(ms[0].date_sent ?? ms[0].date_created)}` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const res = await get<{ messages: Message[] }>('/Messages.json', { PageSize: Math.min(limit, 100), DateSent: '>=' + since.toISOString().slice(0, 10) });
      return (res.messages ?? []).filter((m) => new Date(m.date_sent ?? m.date_created) >= since).map((m) => ({ at: new Date(m.date_sent ?? m.date_created), source: 'twilio', kind: `sms ${m.status}`, text: `${maskPhone(m.from)} -> ${maskPhone(m.to)}${m.error_code ? ` ERROR ${m.error_code}` : ''}` }));
    },
  };
}
