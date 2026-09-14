import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type TimelineItem = { at: Date; source: string; kind: string; text: string };

// Read-only by contract: no provider may register a tool that writes.
export interface Provider {
  name: string;
  register(server: McpServer, guard: Guard): void;
  status(): Promise<string>;
  timeline?(since: Date, limit: number): Promise<TimelineItem[]>;
}

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
export type Guard = <A>(fn: (args: A) => Promise<string>) => (args: A) => Promise<ToolResult>;
