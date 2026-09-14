import { z } from 'zod';
import type { Guard, Provider } from '../provider.js';
import { ago, jsonClient, type Fetcher } from '../http.js';

type Zone = { id: string; name: string; status: string; paused: boolean; plan?: { name?: string }; name_servers?: string[]; modified_on?: string };
type Record = { id: string; type: string; name: string; content: string; proxied?: boolean; ttl: number; modified_on?: string };
type Setting = { id: string; value: unknown };

export function cloudflareProvider(opts: { token: string; zone?: string; fetcher?: Fetcher }): Provider {
  const get = jsonClient('https://api.cloudflare.com/client/v4', { authorization: `Bearer ${opts.token}` }, opts.fetcher);

  async function zones(): Promise<Zone[]> {
    const res = await get<{ result: Zone[] }>('/zones', { per_page: 50 });
    return res.result ?? [];
  }
  async function zoneId(given?: string): Promise<Zone> {
    const all = await zones();
    const want = given ?? opts.zone;
    const z = want ? all.find((x) => x.id === want || x.name === want) : all.length === 1 ? all[0] : undefined;
    if (!z) throw new Error(`Set CLOUDFLARE_ZONE or pass zone; known zones: ${all.map((x) => x.name).join(', ') || 'none'}`);
    return z;
  }

  return {
    name: 'cloudflare',
    register(server, guard: Guard) {
      server.registerTool('cloudflare_zones', {
        title: 'Cloudflare zones',
        description: 'Domains on this account with status, plan and assigned name servers.',
        inputSchema: {},
      }, guard(async () => (await zones()).map((z) => `${z.id}  ${z.name.padEnd(30)}  ${z.status.padEnd(8)}${z.paused ? '  PAUSED' : ''}  ${z.plan?.name ?? ''}  ns: ${(z.name_servers ?? []).join(', ')}`).join('\n') || 'No zones.'));

      server.registerTool('cloudflare_dns', {
        title: 'DNS records',
        description: 'DNS records of a zone: type, name, target, proxied or not, TTL. Use it to check where a domain points.',
        inputSchema: { zone: z.string().optional().describe('Zone name or id; defaults to CLOUDFLARE_ZONE'), type: z.string().optional().describe('A, AAAA, CNAME, MX, TXT ...') },
      }, guard(async ({ zone, type }) => {
        const z = await zoneId(zone);
        const res = await get<{ result: Record[] }>(`/zones/${z.id}/dns_records`, { per_page: 200, type });
        return `${z.name}: ${res.result.length} record(s)\n\n` + res.result.map((r) => `${r.type.padEnd(6)}  ${r.name.padEnd(40)}  ${r.content.slice(0, 60).padEnd(60)}  ${r.proxied ? 'proxied' : 'dns only'}  ttl ${r.ttl === 1 ? 'auto' : r.ttl}`).join('\n');
      }));

      server.registerTool('cloudflare_security', {
        title: 'Zone security settings',
        description: 'SSL mode, Always Use HTTPS, minimum TLS version, HSTS, security level, bot fight mode, and whether the zone is under attack mode.',
        inputSchema: { zone: z.string().optional() },
      }, guard(async ({ zone }) => {
        const z = await zoneId(zone);
        const ids = ['ssl', 'always_use_https', 'min_tls_version', 'security_header', 'security_level', 'automatic_https_rewrites', 'tls_1_3', 'opportunistic_encryption'];
        const settings = await Promise.all(ids.map((id) => get<{ result: Setting }>(`/zones/${z.id}/settings/${id}`).then((r) => r.result).catch((e: Error) => ({ id, value: `unavailable (${e.message.slice(0, 60)})` }))));
        const warn: string[] = [];
        const val = (id: string) => settings.find((s) => s.id === id)?.value;
        if (val('ssl') === 'flexible') warn.push('SSL is "flexible": traffic between Cloudflare and your origin is not encrypted. Use "full (strict)".');
        if (val('ssl') === 'off') warn.push('SSL is off.');
        if (val('always_use_https') === 'off') warn.push('Always Use HTTPS is off: http:// requests are not redirected.');
        if (typeof val('min_tls_version') === 'string' && ['1.0', '1.1'].includes(val('min_tls_version') as string)) warn.push(`Minimum TLS version is ${val('min_tls_version')}; 1.2 is the floor today.`);
        const hsts = (val('security_header') as { strict_transport_security?: { enabled?: boolean } } | undefined)?.strict_transport_security;
        if (hsts && !hsts.enabled) warn.push('HSTS is disabled.');
        return `${z.name}\n\n` + settings.map((s) => `${s.id.padEnd(26)}  ${typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}`).join('\n') + (warn.length ? `\n\nWARN\n${warn.map((w) => `  ${w}`).join('\n')}` : '\n\nNo obvious weakness in these settings.');
      }));
    },

    async status() {
      const all = await zones();
      const bad = all.filter((z) => z.status !== 'active' || z.paused);
      return `cloudflare: ${all.length} zone(s)${bad.length ? `, ${bad.length} not active/paused (${bad.map((z) => z.name).join(', ')})` : ', all active'}${all[0]?.modified_on ? `, last change ${ago(all.map((z) => z.modified_on!).sort().at(-1)!)}` : ''}`;
    },
  };
}
