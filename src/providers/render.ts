import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';

type Service = { id: string; name: string; type: string; suspended: string; updatedAt: string; serviceDetails?: { url?: string; region?: string; plan?: string } };
type Deploy = { id: string; status: string; createdAt: string; finishedAt?: string | null; commit?: { id?: string; message?: string } };

export function renderProvider(opts: { apiKey: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.render.com/v1', { authorization: `Bearer ${opts.apiKey}` }, opts.fetcher);
  const services = async () => (await get<Array<{ service: Service }>>('/services', { limit: 100 })).map((x) => x.service);
  const deploys = async (id: string, limit: number) => (await get<Array<{ deploy: Deploy }>>(`/services/${id}/deploys`, { limit })).map((x) => x.deploy);

  return {
    name: 'render',
    register(server, guard: Guard) {
      server.registerTool('render_services', {
        title: 'Render services',
        description: 'Web services, workers, cron jobs and databases with type, plan, region, URL and whether they are suspended.',
        inputSchema: {},
      }, guard(async () => (await services()).map((s) => `${s.id}  ${s.name.padEnd(26)}  ${s.type.padEnd(14)}  ${(s.serviceDetails?.plan ?? '').padEnd(10)}  ${s.serviceDetails?.region ?? ''}  ${s.suspended === 'suspended' ? 'SUSPENDED' : 'running'}  ${s.serviceDetails?.url ?? ''}`).join('\n') || 'No services.'));

      server.registerTool('render_deploys', {
        title: 'Render deploys',
        description: 'Recent deploys of one service with status (live, build_failed, update_failed, canceled) and commit message.',
        inputSchema: { service_id: z.string(), limit: z.number().int().min(1).max(50).default(15) },
      }, guard(async ({ service_id, limit }) => (await deploys(service_id, limit)).map((d) => `${d.id}  ${ago(d.createdAt).padStart(7)}  ${d.status.padEnd(14)}  ${d.commit?.id?.slice(0, 9) ?? ''}  ${(d.commit?.message ?? '').split('\n')[0].slice(0, 70)}`).join('\n') || 'No deploys.'));
    },

    async status() {
      const all = await services();
      const suspended = all.filter((s) => s.suspended === 'suspended').length;
      return `render: ${all.length} service(s), ${suspended} suspended`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const all = (await services()).filter((s) => s.type !== 'postgres').slice(0, 5);
      const lists = await Promise.all(all.map(async (s) => (await deploys(s.id, Math.min(limit, 20))).map((d) => ({ s, d }))));
      return lists.flat().filter(({ d }) => new Date(d.createdAt) >= since).map(({ s, d }) => ({ at: new Date(d.createdAt), source: 'render', kind: `deploy ${d.status}`, text: `${s.name} ${d.commit?.id?.slice(0, 9) ?? ''} ${(d.commit?.message ?? '').split('\n')[0].slice(0, 70)}` }));
    },
  };
}
