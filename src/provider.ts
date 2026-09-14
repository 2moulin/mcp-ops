import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** One entry on the cross-provider timeline. */
export type TimelineItem = { at: Date; source: string; kind: string; text: string };

/**
 * A provider is one service the agent can look at. It registers its own tools, contributes a
 * one-paragraph status for `ops_status`, and (optionally) events for `ops_timeline`.
 * Every provider is read-only by contract: no tool may create, update or delete anything.
 */
export interface Provider {
  name: string;
  register(server: McpServer, guard: Guard): void;
  status(): Promise<string>;
  timeline?(since: Date, limit: number): Promise<TimelineItem[]>;
}

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
export type Guard = <A>(fn: (args: A) => Promise<string>) => (args: A) => Promise<ToolResult>;
