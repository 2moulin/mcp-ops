import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';

type Project = { id: string; name: string; region_id: string; pg_version: number; created_at: string; updated_at: string };
type Branch = { id: string; name: string; default?: boolean; primary?: boolean; current_state: string; logical_size?: number; created_at: string; updated_at: string; parent_id?: string };
type Endpoint = { id: string; branch_id: string; host: string; type: string; current_state: string; autoscaling_limit_min_cu?: number; autoscaling_limit_max_cu?: number; suspend_timeout_seconds?: number; last_active?: string };
type Operation = { id: string; action: string; status: string; branch_id?: string; endpoint_id?: string; created_at: string; updated_at: string; error?: string };

export function neonProvider(opts: { apiKey: string; projectId?: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://console.neon.tech/api/v2', { authorization: `Bearer ${opts.apiKey}` }, opts.fetcher);
  const mb = (b?: number) => (b == null ? 'n/a' : `${(b / 1024 / 1024).toFixed(0)} MB`);

  async function projectId(given?: string): Promise<string> {
    if (given || opts.projectId) return (given ?? opts.projectId)!;
    const res = await get<{ projects: Project[] }>('/projects', { limit: 10 });
    if (res.projects?.length === 1) return res.projects[0].id;
    throw new Error(`Set NEON_PROJECT_ID or pass project_id; found ${res.projects?.length ?? 0} projects: ${(res.projects ?? []).map((p) => `${p.id} (${p.name})`).join(', ')}`);
  }

  return {
    name: 'neon',
    register(server, guard: Guard) {
      server.registerTool('neon_projects', {
        title: 'Neon projects',
        description: 'Projects visible to this API key with region and Postgres version.',
        inputSchema: {},
      }, guard(async () => {
        const res = await get<{ projects: Project[] }>('/projects', { limit: 100 });
        return (res.projects ?? []).map((p) => `${p.id}  ${p.name.padEnd(28)}  ${p.region_id.padEnd(18)}  pg${p.pg_version}  updated ${ago(p.updated_at)}`).join('\n') || 'No projects.';
      }));

      server.registerTool('neon_branches', {
        title: 'Neon branches',
        description: 'Branches of a project with state, logical size and parent. Tells you which branch is production and how many preview branches exist.',
        inputSchema: { project_id: z.string().optional() },
      }, guard(async ({ project_id }) => {
        const pid = await projectId(project_id);
        const res = await get<{ branches: Branch[] }>(`/projects/${pid}/branches`);
        return (res.branches ?? []).map((b) => `${b.id}  ${b.name.padEnd(28)}  ${(b.default || b.primary ? 'DEFAULT' : '').padEnd(7)}  ${b.current_state.padEnd(6)}  ${mb(b.logical_size).padStart(9)}  updated ${ago(b.updated_at)}${b.parent_id ? `  parent ${b.parent_id}` : ''}`).join('\n') || 'No branches.';
      }));

      server.registerTool('neon_endpoints', {
        title: 'Neon compute endpoints',
        description: 'Compute endpoints with state (active or idle), autoscaling limits, suspend timeout and last activity. Explains cold starts.',
        inputSchema: { project_id: z.string().optional() },
      }, guard(async ({ project_id }) => {
        const pid = await projectId(project_id);
        const res = await get<{ endpoints: Endpoint[] }>(`/projects/${pid}/endpoints`);
        return (res.endpoints ?? []).map((e) => `${e.id}  ${e.type.padEnd(10)}  ${e.current_state.padEnd(6)}  ${e.autoscaling_limit_min_cu ?? '?'}-${e.autoscaling_limit_max_cu ?? '?'} CU  suspend after ${e.suspend_timeout_seconds ?? 'default'}s  last active ${e.last_active ? ago(e.last_active) : 'n/a'}  ${e.host}`).join('\n') || 'No endpoints.';
      }));

      server.registerTool('neon_operations', {
        title: 'Neon operations',
        description: 'Recent control-plane operations (branch creation, compute start and suspend, deletions) with status and errors.',
        inputSchema: { project_id: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) },
      }, guard(async ({ project_id, limit }) => {
        const pid = await projectId(project_id);
        const res = await get<{ operations: Operation[] }>(`/projects/${pid}/operations`, { limit });
        return (res.operations ?? []).map((o) => `${ago(o.created_at).padStart(7)}  ${o.status.padEnd(9)}  ${o.action.padEnd(24)}  ${o.branch_id ?? ''} ${o.endpoint_id ?? ''}${o.error ? `  ERROR: ${o.error}` : ''}`).join('\n') || 'No operations.';
      }));
    },

    async status() {
      const pid = await projectId();
      const [b, e] = await Promise.all([get<{ branches: Branch[] }>(`/projects/${pid}/branches`), get<{ endpoints: Endpoint[] }>(`/projects/${pid}/endpoints`)]);
      const main = (b.branches ?? []).find((x) => x.default || x.primary);
      const active = (e.endpoints ?? []).filter((x) => x.current_state === 'active').length;
      return `neon ${pid}: ${b.branches?.length ?? 0} branches (default ${main?.name ?? 'n/a'}, ${mb(main?.logical_size)}), ${active}/${e.endpoints?.length ?? 0} computes active`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const pid = await projectId();
      const res = await get<{ operations: Operation[] }>(`/projects/${pid}/operations`, { limit });
      return (res.operations ?? []).filter((o) => new Date(o.created_at) >= since).map((o) => ({
        at: new Date(o.created_at), source: 'neon', kind: `${o.action} ${o.status}`, text: `${o.branch_id ?? ''} ${o.endpoint_id ?? ''}${o.error ? ` ERROR: ${o.error}` : ''}`.trim(),
      }));
    },
  };
}
