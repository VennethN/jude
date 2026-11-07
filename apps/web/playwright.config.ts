import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const external = process.env.JUDE_TEST_URL;
const basePort = Number(process.env.JUDE_TEST_PORT ?? 4191);
const caseFiles = [
  '**/board-opening.spec.ts',
  '**/case-*.spec.ts',
  '**/connections*.spec.ts',
  '**/{evidence,findings,reader-index,record-navigation,search-inspector}.spec.ts',
];
const navigationFiles = ['**/workspace-*.spec.ts'];
const groups = [
  { name: 'case-file', testMatch: caseFiles },
  { name: 'navigation', testMatch: navigationFiles },
  { name: 'workspace', testIgnore: [...caseFiles, ...navigationFiles] },
];

// Each group has its own guest quota and database, as an ordinary installation would.
const local = external ? [] : groups.map((project, index) => {
  const port = basePort + index * 2;
  return {
    project,
    port,
    baseURL: 'http://127.0.0.1:' + port,
    dataDir: mkdtempSync(join(tmpdir(), 'jude-browser-' + project.name + '-')),
  };
});

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  timeout: 45000,
  workers: 2,
  fullyParallel: true,
  use: {
    channel: process.env.JUDE_CHROME_CHANNEL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: external
    ? [{ use: { baseURL: external } }]
    : local.map(({ project, baseURL }) => ({ ...project, use: { baseURL } })),
  webServer: local.map(({ port, baseURL, dataDir }) => ({
    command: 'node scripts/start.mjs',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: baseURL + '/healthz',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      HOST: '127.0.0.1',
      PORT: String(port),
      VOICE_PORT: String(port + 1),
      VOICE_ORIGIN: 'http://127.0.0.1:' + (port + 1),
      ORIGIN: baseURL,
      DATABASE_URL: '',
      JUDE_DB_PATH: join(dataDir, 'workspace.sqlite'),
      JUDE_FILES_DIR: join(dataDir, 'files'),
      JUDE_S3_BUCKET: '',
      OPENAI_API_KEY: '',
    },
  })),
});
