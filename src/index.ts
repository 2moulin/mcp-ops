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

const env = process.env;
const providers: Provider[] = [];
const skipped: string[] = [];

if (env.STRIPE_SECRET_KEY) {
  const mode = keyMode(env.STRIPE_SECRET_KEY);
  if (mode === 'live' && env.STRIPE_MCP_ALLOW_LIVE !== '1') {
    console.error('mcp-ops: STRIPE_SECRET_KEY is a live key; set STRIPE_MCP_ALLOW_LIVE=1 to let the agent read live Stripe data. Skipping Stripe.');
    skipped.push('stripe (live key not allowed)');
  } else {
    providers.push(stripeProvider(createStripe(env.STRIPE_SECRET_KEY), mode));
  }
}
if (env.DATABASE_URL) providers.push(postgresProvider(createPgReader(env.DATABASE_URL)));
if (env.VERCEL_TOKEN) providers.push(vercelProvider({ token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID, project: env.VERCEL_PROJECT }));
if (env.RESEND_API_KEY) providers.push(resendProvider({ apiKey: env.RESEND_API_KEY }));
if (env.SENTRY_TOKEN) {
  if (env.SENTRY_ORG && env.SENTRY_PROJECT) providers.push(sentryProvider({ token: env.SENTRY_TOKEN, org: env.SENTRY_ORG, project: env.SENTRY_PROJECT, baseUrl: env.SENTRY_URL }));
  else skipped.push('sentry (needs SENTRY_ORG and SENTRY_PROJECT)');
}
if (env.GITHUB_TOKEN) {
  if (env.GITHUB_REPO) providers.push(githubProvider({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }));
  else skipped.push('github (needs GITHUB_REPO as owner/name)');
}

if (providers.length === 0) {
  console.error([
    'mcp-ops: no provider configured. Set at least one of:',
    '  STRIPE_SECRET_KEY            Stripe (restricted read key; live keys need STRIPE_MCP_ALLOW_LIVE=1)',
    '  DATABASE_URL                 Postgres (queries run in a READ ONLY transaction)',
    '  VERCEL_TOKEN [+ VERCEL_TEAM_ID, VERCEL_PROJECT]',
    '  RESEND_API_KEY',
    '  SENTRY_TOKEN + SENTRY_ORG + SENTRY_PROJECT [+ SENTRY_URL]',
    '  GITHUB_TOKEN + GITHUB_REPO   (owner/name)',
    ...(skipped.length ? ['', `Skipped: ${skipped.join(', ')}`] : []),
  ].join('\n'));
  process.exit(1);
}

const server = createServer(providers);
await server.connect(new StdioServerTransport());
console.error(`mcp-ops ready, read-only: ${providers.map((p) => p.name).join(', ')}${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`);
