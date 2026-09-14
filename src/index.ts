#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import type { Provider } from './provider.js';
import { createStripe, keyMode } from './providers/stripe/client.js';
import { stripeProvider } from './providers/stripe/index.js';
import { createPgReader, postgresProvider } from './providers/postgres.js';
import { vercelProvider } from './providers/vercel.js';
import { resendProvider } from './providers/resend.js';
import { sentryProvider } from './providers/sentry.js';
import { githubProvider } from './providers/github.js';
import { neonProvider } from './providers/neon.js';
import { cloudflareProvider } from './providers/cloudflare.js';
import { netlifyProvider } from './providers/netlify.js';
import { renderProvider } from './providers/render.js';
import { shopifyProvider } from './providers/shopify.js';
import { postmarkProvider } from './providers/postmark.js';
import { twilioProvider } from './providers/twilio.js';
import { betterstackProvider } from './providers/betterstack.js';

const env = process.env;
const providers: Provider[] = [];
const skipped: string[] = [];

function add(name: string, needs: string[], make: () => Provider): void {
  const missing = needs.filter((k) => !env[k]);
  if (missing.length === needs.length) return; // not configured at all
  if (missing.length) { skipped.push(`${name} (missing ${missing.join(', ')})`); return; }
  try { providers.push(make()); } catch (err) { skipped.push(`${name} (${(err as Error).message})`); }
}

add('stripe', ['STRIPE_SECRET_KEY'], () => {
  const mode = keyMode(env.STRIPE_SECRET_KEY!);
  if (mode === 'live' && env.STRIPE_MCP_ALLOW_LIVE !== '1') throw new Error('live key; set STRIPE_MCP_ALLOW_LIVE=1 to allow read access to live data');
  return stripeProvider(createStripe(env.STRIPE_SECRET_KEY!), mode);
});
add('postgres', ['DATABASE_URL'], () => postgresProvider(createPgReader(env.DATABASE_URL!, 15000, { insecureTls: env.PG_TLS_NO_VERIFY === '1' })));
add('neon', ['NEON_API_KEY'], () => neonProvider({ apiKey: env.NEON_API_KEY!, projectId: env.NEON_PROJECT_ID }));
add('vercel', ['VERCEL_TOKEN'], () => vercelProvider({ token: env.VERCEL_TOKEN!, teamId: env.VERCEL_TEAM_ID, project: env.VERCEL_PROJECT }));
add('netlify', ['NETLIFY_TOKEN'], () => netlifyProvider({ token: env.NETLIFY_TOKEN!, site: env.NETLIFY_SITE }));
add('render', ['RENDER_API_KEY'], () => renderProvider({ apiKey: env.RENDER_API_KEY! }));
add('cloudflare', ['CLOUDFLARE_API_TOKEN'], () => cloudflareProvider({ token: env.CLOUDFLARE_API_TOKEN!, zone: env.CLOUDFLARE_ZONE }));
add('resend', ['RESEND_API_KEY'], () => resendProvider({ apiKey: env.RESEND_API_KEY! }));
add('postmark', ['POSTMARK_SERVER_TOKEN'], () => postmarkProvider({ serverToken: env.POSTMARK_SERVER_TOKEN! }));
add('twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], () => twilioProvider({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN! }));
add('sentry', ['SENTRY_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'], () => sentryProvider({ token: env.SENTRY_TOKEN!, org: env.SENTRY_ORG!, project: env.SENTRY_PROJECT!, baseUrl: env.SENTRY_URL }));
add('uptime', ['BETTERSTACK_TOKEN'], () => betterstackProvider({ token: env.BETTERSTACK_TOKEN! }));
add('shopify', ['SHOPIFY_SHOP', 'SHOPIFY_ACCESS_TOKEN'], () => shopifyProvider({ shop: env.SHOPIFY_SHOP!, accessToken: env.SHOPIFY_ACCESS_TOKEN! }));
add('github', ['GITHUB_TOKEN', 'GITHUB_REPO'], () => githubProvider({ token: env.GITHUB_TOKEN!, repo: env.GITHUB_REPO! }));

if (providers.length === 0) {
  console.error([
    'mcp-ops: no provider configured. Set the variables of at least one service:',
    '  STRIPE_SECRET_KEY [STRIPE_MCP_ALLOW_LIVE=1]        Stripe Connect (restricted read key)',
    '  DATABASE_URL [PG_TLS_NO_VERIFY=1]                  Postgres, read-only transaction',
    '  NEON_API_KEY [NEON_PROJECT_ID]                     Neon control plane',
    '  VERCEL_TOKEN [VERCEL_TEAM_ID, VERCEL_PROJECT]      Vercel',
    '  NETLIFY_TOKEN [NETLIFY_SITE]                       Netlify',
    '  RENDER_API_KEY                                     Render',
    '  CLOUDFLARE_API_TOKEN [CLOUDFLARE_ZONE]             Cloudflare',
    '  RESEND_API_KEY                                     Resend',
    '  POSTMARK_SERVER_TOKEN                              Postmark',
    '  TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN             Twilio',
    '  SENTRY_TOKEN + SENTRY_ORG + SENTRY_PROJECT [SENTRY_URL]',
    '  BETTERSTACK_TOKEN                                  Better Stack Uptime',
    '  SHOPIFY_SHOP + SHOPIFY_ACCESS_TOKEN                Shopify',
    '  GITHUB_TOKEN + GITHUB_REPO (owner/name)            GitHub',
    ...(skipped.length ? ['', `Skipped: ${skipped.join('; ')}`] : []),
  ].join('\n'));
  process.exit(1);
}

const server = createServer(providers);
await server.connect(new StdioServerTransport());
console.error(`mcp-ops ready, read-only: ${providers.map((p) => p.name).join(', ')}${skipped.length ? `; skipped: ${skipped.join('; ')}` : ''}`);
