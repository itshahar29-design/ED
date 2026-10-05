import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { env } from '../config/env.js';
import { DDL_SCHEMA } from './sql-schema.js';

const { Pool } = pg;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number | null;
}

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (client: DbClient) => Promise<T>, schoolId?: number | null): Promise<T>;
  close(): Promise<void>;
}

class PgPoolClient implements DbClient {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tx<T>(fn: (client: DbClient) => Promise<T>, schoolId?: number | null): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (schoolId !== undefined && schoolId !== null) {
        await client.query(`SET LOCAL ROLE edumemory_app;`);
        await client.query('SET LOCAL app.school_id = $1', [schoolId.toString()]);
      }
      const wrappedClient: DbClient = {
        query: async <R = any>(sql: string, params?: any[]) => {
          const res = await client.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        },
        tx: async (subFn) => subFn(wrappedClient),
        close: async () => {},
      };
      const result = await fn(wrappedClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PGliteDbClient implements DbClient {
  private pglite: PGlite;

  constructor(pgliteInstance?: PGlite) {
    this.pglite = pgliteInstance || new PGlite();
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pglite.query<T>(sql, params);
    return { rows: res.rows, rowCount: res.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.pglite.exec(sql);
  }

  async tx<T>(fn: (client: DbClient) => Promise<T>, schoolId?: number | null): Promise<T> {
    return this.pglite.transaction(async (txInstance) => {
      if (schoolId !== undefined && schoolId !== null) {
        await txInstance.exec(`SET LOCAL ROLE edumemory_app; SET LOCAL app.school_id = '${schoolId}';`);
      }
      const wrappedClient: DbClient = {
        query: async <R = any>(sql: string, params?: any[]) => {
          const res = await txInstance.query<R>(sql, params);
          return { rows: res.rows, rowCount: res.rows.length };
        },
        exec: async (sql: string) => {
          await txInstance.exec(sql);
        },
        tx: async (subFn) => subFn(wrappedClient),
        close: async () => {},
      };
      return await fn(wrappedClient);
    });
  }

  async close(): Promise<void> {
    await this.pglite.close();
  }
}

let globalDb: DbClient | null = null;

export async function getDb(options?: { usePglite?: boolean }): Promise<DbClient> {
  if (globalDb) return globalDb;

  const shouldUsePglite = options?.usePglite ?? env.USE_PGLITE;

  if (shouldUsePglite || env.NODE_ENV === 'test') {
    const client = new PGliteDbClient();
    await client.exec(DDL_SCHEMA);
    globalDb = client;
    return globalDb;
  }

  try {
    const client = new PgPoolClient(env.DATABASE_URL);
    await client.exec(DDL_SCHEMA);
    globalDb = client;
    return globalDb;
  } catch (err) {
    console.warn('Real Postgres connection failed, falling back to embedded PGlite for local development/testing:', err);
    const client = new PGliteDbClient();
    await client.exec(DDL_SCHEMA);
    globalDb = client;
    return globalDb;
  }
}

export async function createTestDb(): Promise<DbClient> {
  const pglite = new PGlite();
  const client = new PGliteDbClient(pglite);
  await client.exec(DDL_SCHEMA);
  return client;
}
