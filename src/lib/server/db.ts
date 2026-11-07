import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Pool } from 'pg';

type Scalar = string | number | null;
export interface Database {
  query<T>(sql: string, args?: Scalar[]): Promise<T[]>;
  forUpdate: string;
}
interface Driver {
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
}

async function migrations() {
  const folder = resolve(process.env.JUDE_MIGRATIONS_DIR || 'migrations');
  const files = (await readdir(folder)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  return Promise.all(
    files.map(async (file) => [file, await readFile(resolve(folder, file), 'utf8')] as const),
  );
}

function sqliteDriver(sqlite: DatabaseSync): Driver {
  let tail: Promise<unknown> = Promise.resolve();
  const db: Database = {
    forUpdate: '',
    async query<T>(sql: string, args: Scalar[] = []) {
      const values: SQLInputValue[] = [];
      const query = sql.replace(/\$(\d+)/g, (_, pos: string) => {
        values.push(args[Number(pos) - 1]);
        return '?';
      });
      return sqlite.prepare(query).all(...values) as T[];
    },
  };
  return {
    transaction<T>(work: (db: Database) => Promise<T>) {
      const run = tail.then(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const value = await work(db);
          sqlite.exec('COMMIT');
          return value;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

function postgresDriver(pool: Pool): Driver {
  return {
    async transaction<T>(work: (db: Database) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          forUpdate: ' FOR UPDATE',
          async query<T>(sql: string, args: Scalar[] = []) {
            return (await client.query(sql, args)).rows as T[];
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function initialize(): Promise<Driver> {
  let driver: Driver;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    driver = postgresDriver(new Pool({ connectionString: process.env.DATABASE_URL, max: 8 }));
  } else {
    if (process.env.NODE_ENV === 'production' && !process.env.JUDE_DB_PATH) {
      throw new Error('Configure DATABASE_URL or an explicit JUDE_DB_PATH for this installation.');
    }
    const { DatabaseSync } = await import('node:sqlite');
    const path = process.env.JUDE_DB_PATH || resolve('.jude-data/workspace.sqlite');
    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
    driver = sqliteDriver(sqlite);
  }
  const scripts = await migrations();
  await driver.transaction(async (db) => {
    if (db.forUpdate) await db.query('SELECT pg_advisory_xact_lock(1937446201)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
    const done = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
    for (const [name, sql] of scripts) {
      if (done.some((row) => row.name === name)) continue;
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await db.query(statement);
      await db.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
  });
  return driver;
}

let driverPromise: Promise<Driver> | undefined;
export async function transaction<T>(work: (db: Database) => Promise<T>) {
  const driver = await (driverPromise ??= initialize().catch((error) => {
    driverPromise = undefined;
    throw error;
  }));
  return driver.transaction(work);
}
