import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';
import { maskEmail } from '../format.js';

type Order = { id: number; name: string; created_at: string; financial_status: string; fulfillment_status: string | null; total_price: string; currency: string; email?: string; cancelled_at?: string | null; line_items?: Array<{ title: string; quantity: number }> };

const API_VERSION = '2025-07';

export function shopifyProvider(opts: { shop: string; accessToken: string; fetcher?: Fetcher }): Provider {
  const shop = opts.shop.replace(/^https?:\/\//, '').replace(/\.myshopify\.com.*$/, '');
  const get = jsonClient(`https://${shop}.myshopify.com/admin/api/${API_VERSION}`, { 'x-shopify-access-token': opts.accessToken }, opts.fetcher);
  const line = (o: Order) => `${o.name.padEnd(8)}  ${ago(o.created_at).padStart(7)}  ${o.total_price.padStart(9)} ${o.currency}  ${o.financial_status.padEnd(18)}  ${(o.fulfillment_status ?? 'unfulfilled').padEnd(12)}${o.cancelled_at ? '  CANCELLED' : ''}  ${maskEmail(o.email)}  ${(o.line_items ?? []).slice(0, 2).map((l) => `${l.quantity}x ${l.title.slice(0, 30)}`).join(', ')}`;

  return {
    name: 'shopify',
    register(server, guard: Guard) {
      server.registerTool('shopify_orders', {
        title: 'Shopify orders',
        description: 'Recent orders with payment and fulfillment status, total and first items. Customer emails are masked. Filter with financial_status (paid, pending, refunded ...) or fulfillment_status (unfulfilled, shipped).',
        inputSchema: { financial_status: z.string().optional(), fulfillment_status: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) },
      }, guard(async ({ financial_status, fulfillment_status, limit }) => {
        const res = await get<{ orders: Order[] }>('/orders.json', { status: 'any', limit, financial_status, fulfillment_status, fields: 'id,name,created_at,financial_status,fulfillment_status,total_price,currency,email,cancelled_at,line_items' });
        return res.orders.length ? `${res.orders.length} order(s) on ${shop}\n\n${res.orders.map(line).join('\n')}` : 'No orders match.';
      }));

      server.registerTool('shopify_order', {
        title: 'One Shopify order',
        description: 'One order by name (#1001) or id, with items, discounts, shipping lines, fulfillment and refund status. Personal data is masked.',
        inputSchema: { order: z.string().describe('#1001, 1001, or the numeric id') },
      }, guard(async ({ order }) => {
        let o: Order & { shipping_lines?: Array<{ title: string; price: string }>; discount_codes?: Array<{ code: string; amount: string }>; refunds?: Array<{ created_at: string }>; fulfillments?: Array<{ status: string; tracking_company?: string; tracking_number?: string; created_at: string }> };
        if (/^\d{8,}$/.test(order)) o = (await get<{ order: typeof o }>(`/orders/${order}.json`)).order;
        else {
          const name = order.startsWith('#') ? order : `#${order}`;
          const res = await get<{ orders: (typeof o)[] }>('/orders.json', { status: 'any', name, limit: 1 });
          if (!res.orders?.length) return `No order ${name}.`;
          o = res.orders[0];
        }
        return [
          line(o), '',
          `items:\n${(o.line_items ?? []).map((l) => `  ${l.quantity}x ${l.title}`).join('\n')}`,
          o.discount_codes?.length ? `discounts: ${o.discount_codes.map((d) => `${d.code} (${d.amount})`).join(', ')}` : '',
          o.shipping_lines?.length ? `shipping: ${o.shipping_lines.map((s) => `${s.title} ${s.price}`).join(', ')}` : '',
          o.fulfillments?.length ? `fulfillments:\n${o.fulfillments.map((f) => `  ${f.status} ${ago(f.created_at)} ${f.tracking_company ?? ''} ${f.tracking_number ? '****' + f.tracking_number.slice(-4) : ''}`).join('\n')}` : 'fulfillments: none',
          o.refunds?.length ? `refunds: ${o.refunds.length} (last ${ago(o.refunds.at(-1)!.created_at)})` : '',
        ].filter(Boolean).join('\n');
      }));
    },

    async status() {
      const [unf, pend, all] = await Promise.all([
        get<{ count: number }>('/orders/count.json', { status: 'any', fulfillment_status: 'unfulfilled', financial_status: 'paid' }),
        get<{ count: number }>('/orders/count.json', { status: 'any', financial_status: 'pending' }),
        get<{ orders: Order[] }>('/orders.json', { status: 'any', limit: 1, fields: 'created_at' }),
      ]);
      return `shopify ${shop}: ${unf.count} paid orders waiting for fulfillment, ${pend.count} with payment pending${all.orders[0] ? `, last order ${ago(all.orders[0].created_at)}` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const res = await get<{ orders: Order[] }>('/orders.json', { status: 'any', limit: Math.min(limit, 100), created_at_min: since.toISOString(), fields: 'id,name,created_at,financial_status,fulfillment_status,total_price,currency' });
      return res.orders.map((o) => ({ at: new Date(o.created_at), source: 'shopify', kind: `order ${o.financial_status}`, text: `${o.name} ${o.total_price} ${o.currency} ${o.fulfillment_status ?? 'unfulfilled'}` }));
    },
  };
}
