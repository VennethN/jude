import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const baseURL = process.env.JUDE_TEST_URL || 'http://127.0.0.1:4191';
const dataDir = mkdtempSync(join(tmpdir(), 'jude-browser-'));
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  workers: 2,
  fullyParallel: true,
  use: {
    baseURL,
    channel: process.env.JUDE_CHROME_CHANNEL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: process.env.JUDE_TEST_URL
    ? undefined
    : {
        command: 'node scripts/start.mjs',
        url: baseURL + '/healthz',
        reuseExistingServer: false,
        timeout: 60000,
        env: {
          HOST: '127.0.0.1',
          PORT: '4191',
          ORIGIN: baseURL,
          JUDE_DB_PATH: join(dataDir, 'workspace.sqlite'),
          JUDE_FILES_DIR: join(dataDir, 'files'),
          OPENAI_API_KEY: '',
        },
      },
});
