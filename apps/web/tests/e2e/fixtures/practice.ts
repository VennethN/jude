import { test as base } from '@playwright/test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const test = base.extend<{}, { practiceServer: { origin: string; database: string } }>({
  practiceServer: [async ({}, use) => {
    const folder = await mkdtemp(join(tmpdir(), 'jude-practice-'));
    const database = join(folder, 'practice.sqlite');
    const child = fork(fileURLToPath(new URL('./practice-server.mjs', import.meta.url)), [], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { ...process.env, DATABASE_URL: '', JUDE_DB_PATH: database, JUDE_FILES_DIR: join(folder, 'files'),
        OPENAI_API_KEY: '', JUDE_S3_BUCKET: '', JUDE_PASAL_TOKEN: '' },
    });
    const exit = once(child, 'exit');
    try {
      const origin = await Promise.race([
        once(child, 'message').then(([url]) => String(url)),
        exit.then(() => { throw new Error('The isolated practice server exited before opening.'); }),
      ]);
      await use({ origin, database });
    } finally {
      child.kill();
      await exit;
      await rm(folder, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],
  baseURL: async ({ practiceServer }, use) => { await use(practiceServer.origin); },
});
