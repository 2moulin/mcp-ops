import type Stripe from 'stripe';
import type { StripeReader } from './client.js';
import { isoDate, redactPii } from '../../format.js';

export async function listWebhookEndpoints(stripe: StripeReader): Promise<string> {
  const res = await stripe.webhookEndpoints.list({ limit: 100 });
  if (res.data.length === 0) return 'No webhook endpoints configured.';
  const lines = res.data.map((w) => {
    const events = w.enabled_events.includes('*') ? 'all events' : `${w.enabled_events.length} event type(s)`;
    const connect = w.metadata?.connect === 'true' || (w as unknown as { connect?: boolean }).connect ? 'connect' : 'account';
    return [`${w.id}  ${w.status}  ${connect}  ${w.url}`, `  api: ${w.api_version ?? 'default'}  ${events}`, `  ${w.enabled_events.slice(0, 12).join(', ')}${w.enabled_events.length > 12 ? ', ...' : ''}`].join('\n');
  });
  return `${res.data.length} webhook endpoint(s)\n\n${lines.join('\n\n')}`;
}

export async function listEvents(stripe: StripeReader, opts: { type?: string; limit: number; onlyUndelivered?: boolean }): Promise<string> {
  const params: Stripe.EventListParams = { limit: opts.limit };
  if (opts.type) {
    if (opts.type.endsWith('.') || opts.type.endsWith('*')) params.type = opts.type.replace(/\*$/, '') + '*';
    else params.type = opts.type;
  }
  if (opts.onlyUndelivered) params.delivery_success = false;
  const res = await stripe.events.list(params);
  if (res.data.length === 0) return 'No events match.';
  const lines = res.data.map((e) => {
    const obj = e.data?.object as { id?: string } | undefined;
    const acct = e.account ? `  acct:${e.account}` : '';
    const pending = e.pending_webhooks ? `  pending_webhooks:${e.pending_webhooks}` : '';
    return `${e.id}  ${isoDate(e.created)}  ${e.type}  obj:${obj?.id ?? 'n/a'}${acct}${pending}`;
  });
  return `${res.data.length} event(s)${res.has_more ? ' (more available)' : ''}\n\n${lines.join('\n')}`;
}

export async function getEvent(stripe: StripeReader, eventId: string): Promise<string> {
  const e = await stripe.events.retrieve(eventId);
  const payload = JSON.stringify(redactPii(e.data.object), null, 2);
  const clipped = payload.length > 6000 ? payload.slice(0, 6000) + '\n... (clipped)' : payload;
  return [
    `${e.id}  ${e.type}  ${isoDate(e.created)}`,
    `livemode: ${e.livemode}  pending_webhooks: ${e.pending_webhooks}  account: ${e.account ?? 'platform'}`,
    `request: ${e.request?.id ?? 'n/a'}  idempotency_key: ${e.request?.idempotency_key ?? 'n/a'}`,
    '',
    clipped,
  ].join('\n');
}
