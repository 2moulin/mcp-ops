import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, clip, jsonClient, type Fetcher } from '../http.js';

type Deployment = {
  uid: string; name: string; url: string; state?: string; readyState?: string; created: number; ready?: number;
  target?: string | null; source?: string; creator?: { username?: string; email?: string };
  meta?: Record<string, string>; inspectorUrl?: string; errorMessage?: string | null;
};

export function vercelProvider(opts: { token: string; teamId?: string; project?: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.vercel.com', { authorization: `Bearer ${opts.token}` }, opts.fetcher);
  const scope = () => (opts.teamId ? { teamId: opts.teamId } : {});

  async function deployments(limit: number, state?: string, project?: string): Promise<Deployment[]> {
    const res = await get<{ deployments: Deployment[] }>('/v6/deployments', { ...scope(), limit, state, projectId: project ?? opts.project });
    return res.deployments ?? [];
  }
  const line = (d: Deployment) => {
    const st = (d.readyState ?? d.state ?? '?').toUpperCase();
    const commit = d.meta?.githubCommitMessage ? ` "${d.meta.githubCommitMessage.split('\n')[0].slice(0, 60)}"` : '';
    const ref = d.meta?.githubCommitRef ? ` [${d.meta.githubCommitRef}]` : '';
    return `${d.uid}  ${ago(d.created).padStart(7)}  ${st.padEnd(8)}  ${(d.target ?? 'preview').padEnd(10)}  ${d.name}${ref}${commit}${d.errorMessage ? `  ERROR: ${d.errorMessage}` : ''}`;
  };

  return {
    name: 'vercel',
    register(server, guard: Guard) {
      server.registerTool('vercel_deployments', {
        title: 'List deployments',
        description: 'Recent Vercel deployments with state (READY, ERROR, BUILDING, CANCELED), target, branch and commit message.',
        inputSchema: {
          state: z.enum(['BUILDING', 'ERROR', 'INITIALIZING', 'QUEUED', 'READY', 'CANCELED']).optional(),
          project: z.string().optional().describe('Project id or name; defaults to VERCEL_PROJECT'),
          limit: z.number().int().min(1).max(100).default(20),
        },
      }, guard(async ({ state, project, limit }) => {
        const ds = await deployments(limit, state, project);
        return ds.length ? `${ds.length} deployment(s)\n\n${ds.map(line).join('\n')}` : 'No deployments match.';
      }));

      server.registerTool('vercel_deployment_logs', {
        title: 'Build logs of a deployment',
        description: 'Build and runtime events of one deployment (the last lines, clipped). Use it on an ERROR deployment to see why it failed.',
        inputSchema: { deployment_id: z.string(), limit: z.number().int().min(10).max(500).default(150) },
      }, guard(async ({ deployment_id, limit }) => {
        const events = await get<Array<{ type: string; created: number; text?: string; payload?: { text?: string } }>>(`/v3/deployments/${deployment_id}/events`, { ...scope(), limit, direction: 'backward' });
        const lines = (Array.isArray(events) ? events : []).map((e) => `${new Date(e.created).toISOString().slice(11, 19)}  ${e.type.padEnd(8)}  ${e.text ?? e.payload?.text ?? ''}`);
        return clip(lines.join('\n') || 'No events.', 10000);
      }));

      server.registerTool('vercel_env_names', {
        title: 'Environment variable names',
        description: 'Names and targets of the environment variables of a project. Values are never returned.',
        inputSchema: { project: z.string().optional() },
      }, guard(async ({ project }) => {
        const p = project ?? opts.project;
        if (!p) return 'Give a project id or name, or set VERCEL_PROJECT.';
        const res = await get<{ envs: Array<{ key: string; target?: string[]; type?: string; updatedAt?: number }> }>(`/v9/projects/${encodeURIComponent(p)}/env`, scope());
        const rows = (res.envs ?? []).sort((a, b) => a.key.localeCompare(b.key)).map((e) => `${e.key.padEnd(40)}  ${(e.target ?? []).join(',').padEnd(30)}  ${e.type ?? ''}${e.updatedAt ? `  updated ${ago(e.updatedAt)}` : ''}`);
        return `${rows.length} variable(s) on ${p}\n\n${rows.join('\n')}`;
      }));

      server.registerTool('vercel_projects', {
        title: 'List projects',
        description: 'Projects visible to this token, with their production domain and framework.',
        inputSchema: {},
      }, guard(async () => {
        const res = await get<{ projects: Array<{ id: string; name: string; framework?: string; updatedAt?: number; targets?: { production?: { alias?: string[] } } }> }>('/v9/projects', { ...scope(), limit: 100 });
        return (res.projects ?? []).map((p) => `${p.id}  ${p.name.padEnd(30)}  ${(p.framework ?? '').padEnd(10)}  ${p.targets?.production?.alias?.[0] ?? ''}  updated ${p.updatedAt ? ago(p.updatedAt) : 'n/a'}`).join('\n') || 'No projects.';
      }));
    },

    async status() {
      const ds = await deployments(20);
      const prod = ds.find((d) => d.target === 'production');
      const errors = ds.filter((d) => (d.readyState ?? d.state) === 'ERROR').length;
      const building = ds.filter((d) => ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(d.readyState ?? d.state ?? '')).length;
      return `vercel: last production deploy ${prod ? `${(prod.readyState ?? prod.state)} ${ago(prod.created)} (${prod.meta?.githubCommitRef ?? 'n/a'})` : 'none in last 20'}; ${errors} failed and ${building} in progress among the last ${ds.length}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const ds = await deployments(limit);
      return ds.filter((d) => d.created >= since.getTime()).map((d) => ({
        at: new Date(d.created), source: 'vercel', kind: `deploy ${(d.readyState ?? d.state ?? '').toLowerCase()}`,
        text: `${d.target ?? 'preview'} ${d.name} ${d.meta?.githubCommitRef ? `[${d.meta.githubCommitRef}] ` : ''}${d.meta?.githubCommitMessage?.split('\n')[0].slice(0, 70) ?? ''}${d.errorMessage ? ` ERROR: ${d.errorMessage}` : ''}`,
      }));
    },
  };
}
