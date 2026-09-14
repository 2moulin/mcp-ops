#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { createStripe, keyMode } from './stripe.js';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('mcp-stripe-connect: set STRIPE_SECRET_KEY (a restricted key with read access is enough).');
  process.exit(1);
}

const mode = keyMode(key);
if (mode === 'live' && process.env.STRIPE_MCP_ALLOW_LIVE !== '1') {
  console.error('mcp-stripe-connect: refusing a live key. Set STRIPE_MCP_ALLOW_LIVE=1 if you really want the agent reading live data.');
  process.exit(1);
}

const server = createServer(createStripe(key), mode);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`mcp-stripe-connect ready (${mode} mode, read-only)`);
