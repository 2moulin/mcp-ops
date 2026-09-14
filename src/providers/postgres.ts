import { z } from 'zod';
import pg from 'pg';
import type { Guard, Provider, TimelineItem } from '../provider.js';
import { clip } from '../http.js';

export interface DbReader {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const READ_ONLY_START = /^\s*(select|with|explain|show|table|values)\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|lock|refresh|reindex|cluster|set\s+role|reset|discard)\b/i;

export function assertReadOnly(sql: string): void {
  const s = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!s) throw new Error('Empty statement.');
  if (s.split(';').filter((p) => p.trim()).length > 1) throw new Error('One statement at a time.');
  if (!READ_ONLY_START.test(s)) throw new Error('Only SELECT / WITH / EXPLAIN / SHOW statements are allowed.');
  if (FORBIDDEN.test(s)) throw new Error('Statement contains a write or DDL keyword; this server is read-only.');
}

export function createPgReader(connectionString: string, statementTimeoutMs = 15000, opts: { insecureTls?: boolean } = {}): DbReader {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const pool = new pg.Pool({ connectionString, max: 2, ssl: local ? undefined : { rejectUnauthorized: !opts.insecureTls } });
  return {
    async query(sql, params = []) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.floor(statementTimeoutMs)}`);
        const res = await client.query(sql, params);
        await client.query('ROLLBACK');
        return { rows: res.rows, rowCount: res.rowCount };
      } catch (err) {
        await client.query('ROLLBACK').catch((e: unknown) => console.error('mcp-ops: rollback failed', e));
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

function table(rows: Record<string, unknown>[], max = 50): string {
  if (rows.length === 0) return '(no rows)';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const widths = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.slice(0, max).map((r) => cell(r[c]).length))));
  const line = (vals: string[]) => vals.map((v, i) => v.slice(0, widths[i]).padEnd(widths[i])).join('  ');
  const out = [line(cols), line(widths.map((w) => '-'.repeat(w))), ...rows.slice(0, max).map((r) => line(cols.map((c) => cell(r[c]))))];
  if (rows.length > max) out.push(`... ${rows.length - max} more row(s)`);
  return out.join('\n');
}

export function postgresProvider(db: DbReader, label = 'postgres'): Provider {
  return {
    name: 'postgres',
    register(server, guard: Guard) {
      server.registerTool('db_tables', {
        title: 'List tables',
        description: 'Tables of the database with estimated row counts and on-disk size, biggest first.',
        inputSchema: { schema: z.string().default('public') },
      }, guard(async ({ schema }) => {
        const { rows } = await db.query(
          `SELECT c.relname AS table, GREATEST(c.reltuples, 0)::bigint AS est_rows, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relkind IN ('r','p') ORDER BY pg_total_relation_size(c.oid) DESC`, [schema]);
        return `${rows.length} table(s) in ${schema}\n\n${table(rows, 200)}`;
      }));

      server.registerTool('db_describe', {
        title: 'Describe a table',
        description: 'Columns, types, defaults, nullability, indexes and foreign keys of one table.',
        inputSchema: { table: z.string(), schema: z.string().default('public') },
      }, guard(async ({ table: t, schema }) => {
        const cols = await db.query(
          `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, t]);
        if (cols.rows.length === 0) return `No table ${schema}.${t}.`;
        const idx = await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`, [schema, t]);
        const fks = await db.query(
          `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass AND contype IN ('f','p','u')`, [schema, t]);
        return [`${schema}.${t}`, '', table(cols.rows, 200), '', 'indexes:', ...(idx.rows.map((r) => `  ${r.indexdef}`)), '', 'constraints:', ...(fks.rows.map((r) => `  ${r.conname}: ${r.def}`))].join('\n');
      }));

      server.registerTool('db_query', {
        title: 'Run a read-only query',
        description: 'Run one SELECT (or WITH / EXPLAIN) inside a READ ONLY transaction with a 15 s timeout. Writes are rejected before they reach the database. Rows are capped by `limit`.',
        inputSchema: { sql: z.string(), limit: z.number().int().min(1).max(500).default(50) },
      }, guard(async ({ sql, limit }) => {
        assertReadOnly(sql);
        const { rows } = await db.query(sql);
        return clip(`${rows.length} row(s)\n\n${table(rows, limit)}`, 12000);
      }));

      server.registerTool('db_activity', {
        title: 'Current activity',
        description: 'What the database is doing right now: connections by state, long-running queries, locks waiting.',
        inputSchema: {},
      }, guard(async () => {
        const states = await db.query(`SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY n DESC`);
        const long = await db.query(
          `SELECT pid, now() - query_start AS running_for, state, wait_event_type, left(query, 120) AS query
             FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND query_start < now() - interval '5 seconds'
            ORDER BY query_start LIMIT 20`);
        return ['connections by state:', table(states.rows), '', 'running longer than 5 s:', table(long.rows)].join('\n');
      }));

      server.registerTool('db_slow_queries', {
        title: 'Slowest queries',
        description: 'Top queries by total time from pg_stat_statements (needs the extension enabled).',
        inputSchema: { limit: z.number().int().min(1).max(50).default(15) },
      }, guard(async ({ limit }) => {
        try {
          const { rows } = await db.query(
            `SELECT calls, round(total_exec_time::numeric, 0) AS total_ms, round(mean_exec_time::numeric, 1) AS mean_ms, rows, left(query, 110) AS query
               FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT $1`, [limit]);
          return table(rows, limit);
        } catch (err) {
          if (/pg_stat_statements/.test((err as Error).message)) return 'pg_stat_statements is not enabled on this database (CREATE EXTENSION pg_stat_statements as a superuser).';
          throw err;
        }
      }));
    },

    async status() {
      const [{ rows: size }, { rows: conns }] = await Promise.all([
        db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, current_database() AS db, version() AS v`),
        db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE state = 'active')::int AS active FROM pg_stat_activity WHERE datname = current_database()`),
      ]);
      const v = String(size[0]?.v ?? '').split(' ').slice(0, 2).join(' ');
      return `${label}: ${size[0]?.db} ${size[0]?.size}, ${conns[0]?.n} connection(s) (${conns[0]?.active} active), ${v}`;
    },

    async timeline(): Promise<TimelineItem[]> {
      return [];
    },
  };
}
