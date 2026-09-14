import { z } from 'zod';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';

type Commit = { sha: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null };
type Run = { id: number; name: string; head_branch: string; status: string; conclusion: string | null; created_at: string; updated_at: string; html_url: string; head_commit?: { message?: string } };
type Pull = { number: number; title: string; user?: { login?: string }; draft?: boolean; created_at: string; updated_at: string; head: { ref: string }; html_url: string };

export function githubProvider(opts: { token: string; repo: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.github.com', { authorization: `Bearer ${opts.token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'mcp-ops' }, opts.fetcher);
  const repo = `/repos/${opts.repo}`;
  const first = (m: string) => m.split('\n')[0].slice(0, 80);

  return {
    name: 'github',
    register(server, guard: Guard) {
      server.registerTool('github_commits', {
        title: 'Recent commits',
        description: `Recent commits on ${opts.repo} (default branch, or the branch given).`,
        inputSchema: { branch: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) },
      }, guard(async ({ branch, limit }) => {
        const commits = await get<Commit[]>(`${repo}/commits`, { sha: branch, per_page: limit });
        return commits.map((c) => `${c.sha.slice(0, 9)}  ${ago(c.commit.author?.date ?? Date.now()).padStart(7)}  ${(c.author?.login ?? c.commit.author?.name ?? '?').padEnd(14)}  ${first(c.commit.message)}`).join('\n') || 'No commits.';
      }));

      server.registerTool('github_ci_runs', {
        title: 'CI runs',
        description: 'Recent GitHub Actions runs with status and conclusion. Use it to see whether the last push is green.',
        inputSchema: { branch: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) },
      }, guard(async ({ branch, limit }) => {
        const res = await get<{ workflow_runs: Run[] }>(`${repo}/actions/runs`, { branch, per_page: limit });
        return (res.workflow_runs ?? []).map((r) => `${String(r.id).padEnd(12)}  ${ago(r.created_at).padStart(7)}  ${(r.conclusion ?? r.status).padEnd(10)}  ${r.name.padEnd(16)}  [${r.head_branch}]  ${first(r.head_commit?.message ?? '')}`).join('\n') || 'No runs.';
      }));

      server.registerTool('github_open_prs', {
        title: 'Open pull requests',
        description: 'Open pull requests with author, branch and age.',
        inputSchema: { limit: z.number().int().min(1).max(100).default(30) },
      }, guard(async ({ limit }) => {
        const prs = await get<Pull[]>(`${repo}/pulls`, { state: 'open', per_page: limit });
        return prs.map((p) => `#${String(p.number).padEnd(6)}  ${ago(p.updated_at).padStart(7)}  ${(p.user?.login ?? '?').padEnd(14)}  ${p.draft ? '[draft] ' : ''}${p.title.slice(0, 70)}  (${p.head.ref})`).join('\n') || 'No open pull requests.';
      }));
    },

    async status() {
      const [commits, runs] = await Promise.all([get<Commit[]>(`${repo}/commits`, { per_page: 1 }), get<{ workflow_runs: Run[] }>(`${repo}/actions/runs`, { per_page: 5 })]);
      const c = commits[0];
      const r = runs.workflow_runs?.[0];
      return `github ${opts.repo}: last commit ${c ? `${ago(c.commit.author?.date ?? Date.now())} "${first(c.commit.message)}"` : 'none'}; last CI ${r ? `${r.conclusion ?? r.status} ${ago(r.created_at)}` : 'none'}`;
    },

    async timeline(since, limit): Promise<TimelineItem[]> {
      const [commits, runs] = await Promise.all([
        get<Commit[]>(`${repo}/commits`, { since: since.toISOString(), per_page: limit }),
        get<{ workflow_runs: Run[] }>(`${repo}/actions/runs`, { created: `>=${since.toISOString().slice(0, 19)}Z`, per_page: limit }),
      ]);
      return [
        ...commits.map((c) => ({ at: new Date(c.commit.author?.date ?? 0), source: 'github', kind: 'commit', text: `${c.sha.slice(0, 9)} ${first(c.commit.message)} (${c.author?.login ?? c.commit.author?.name ?? '?'})` })),
        ...(runs.workflow_runs ?? []).map((r) => ({ at: new Date(r.updated_at), source: 'github', kind: `ci ${r.conclusion ?? r.status}`, text: `${r.name} [${r.head_branch}]` })),
      ];
    },
  };
}
