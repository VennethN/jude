import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll } from 'vitest';

export function useIsolatedDatabase(name: 'guest' | 'guest_hearing') {
  const schema = 'jude_' + name + '_' + randomUUID().replaceAll('-', '');
  let pg: Client | undefined;
  beforeAll(async () => {
    const dsn = process.env.JUDE_TEST_DATABASE_URL;
    if (dsn) {
      pg = new Client({ connectionString: dsn });
      await pg.connect();
      await pg.query('CREATE SCHEMA "' + schema + '"');
      const url = new URL(dsn);
      url.searchParams.set('options', '-c search_path=' + schema);
      process.env.DATABASE_URL = url.href;
    } else {
      delete process.env.DATABASE_URL;
      process.env.JUDE_DB_PATH = ':memory:';
    }
  });
  afterAll(async () => {
    if (pg) {
      await pg.query('DROP SCHEMA "' + schema + '" CASCADE');
      await pg.end();
    }
  });
}
