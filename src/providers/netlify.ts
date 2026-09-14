import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, clip, jsonClient, type Fetcher } from '../http.js';

type Site = { id: string; name: string; url: string; ssl_url?: string; updated_at: string; published_deploy?: { state: string; created_at: string; branch?: string; title?: string } };
type Deploy = { id: string; state: string; created_at: string; branch?: string; title?: string; error_message?: string | null; deploy_time?: number; context?: string };

export function netlifyProvider(opts: { token: string; site?: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.netlify.com/api/v1', { authorization: `Bearer ${opts.token}` }, opts.fetcher);

  async function siteId(given?: string): Promise<Site> {
    const sites = await get<Site[]>('/sites', { per_page: 100 });
    const want = given ?? opts.site;
    const s = want ? sites.find((x) => x.id === want || x.name === want) : sites.length === 1 ? sites[0] : undefined;
    if (!s) throw new Error(`Set NETLIFY_SITE or pass site; known sites: ${sites.map((x) => x.name).join(', ') || 'none'}`);
    return s;
  }
  const line = (d: Deploy) => `${d.id}  ${ago(d.created_at).padStart(7)}  ${d.state.toUpperCase().padEnd(9)}  ${(d.context ?? '').padEnd(18)}  [${d.branch ?? '?'}]  ${(d.title ?? '').split('\n')[0].slice(0, 60)}${d.error_message ? `  ERROR: ${d.error_message}` : ''}`;

  return {
    name: 'netlify',
    register(server, guard: Guard) {
      server.registerTool('netlify_sites', {
        title: 'Netlify sites',
        description: 'Sites with their URL and the state of the published deploy.',
        inputSchema: {},
      }, guard(async () => (await get<Site[]>('/sites', { per_page: 100 })).map((s) => `${s.id}  ${s.name.padEnd(28)}  ${s.ssl_url ?? s.url}  published ${s.published_deploy ? `${s.published_deploy.state} ${ago(s.published_deploy.created_at)} [${s.published_deploy.branch ?? '?'}]` : 'never'}`).join('\n') || 'No sites.'));

      server.registerTool('netlify_deploys', {
        title: 'Netlify deploys',
        description: 'Recent deploys of a site with state (ready, error, building), context, branch and error message.',
        inputSchema: { site: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) },
      }, guard(async ({ site, limit }) => {
        const s = await siteId(site);
        const ds = await get<Deploy[]>(`/sites/${s.id}/deploys`, { per_page: limit });
        return `${s.name}: ${ds.length} deploy(s)\n\n${ds.map(line).join('\n')}`;
      }));

      server.registerTool('netlify_deploy_log', {
        title: 'Netlify deploy log',
        description: 'Build log lines of one deploy (clipped). Use it on an error deploy.',
        inputSchema: { deploy_id: z.string() },
      }, guard(async ({ deploy_id }) => {
        const d = await get<Deploy & { log_access_attributes?: { url?: string } }>(`/deploys/${deploy_id}`);
        const summary = `${d.id}  ${d.state}  ${ago(d.created_at)}  [${d.branch ?? '?'}]  ${d.title ?? ''}${d.error_message ? `\nERROR: ${d.error_message}` : ''}`;
        return clip(summary, 4000);
      }));
    },

    async status() {
      const sites = await get<Site[]>('/sites', { per_page: 100 });
      const errors = sites.filter((s) => s.published_deploy?.state === 'error');
      return `netlify: ${sites.length} site(s)${errors.length ? `, ${errors.length} with a failed published deploy` : ''}${sites[0]?.published_deploy ? `, last publish ${ago(sites.map((s) => s.published_deploy?.created_at ?? '').sort().at(-1)!)}` : ''}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const s = await siteId().catch(() => null);
      if (!s) return [];
      const ds = await get<Deploy[]>(`/sites/${s.id}/deploys`, { per_page: limit });
      return ds.filter((d) => new Date(d.created_at) >= since).map((d) => ({ at: new Date(d.created_at), source: 'netlify', kind: `deploy ${d.state}`, text: `${s.name} [${d.branch ?? '?'}] ${(d.title ?? '').split('\n')[0].slice(0, 70)}${d.error_message ? ` ERROR: ${d.error_message}` : ''}` }));
    },
  };
}
