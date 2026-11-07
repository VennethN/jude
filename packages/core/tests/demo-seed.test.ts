import { expect, test } from 'vitest';
import { seedOrganization } from '../src/server/cases';
import type { Database } from '../src/server/db';

test('seeding an example batches evidence writes and stays within SQLite parameter limits', async () => {
  const writes: number[] = [];
  const queries: string[] = [];
  const db: Database = {
    forUpdate: ' FOR UPDATE',
    async query(sql, args = []) {
      queries.push(sql);
      if (sql.startsWith('INSERT INTO case_entities')) writes.push(args.length);
      return [];
    },
  };
  await seedOrganization(db, 'example-org');
  const evidenceRows = writes.reduce((total, parameters) => total + parameters / 5, 0);
  expect(evidenceRows).toBeGreaterThan(0);
  expect(writes.length).toBeLessThanOrEqual(Math.ceil(evidenceRows / 50));
  expect(writes.every(parameters => parameters <= 999)).toBe(true);
  expect(queries.some(sql => sql.includes('semantic_'))).toBe(false);
});
