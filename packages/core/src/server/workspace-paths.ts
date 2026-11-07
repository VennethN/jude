import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Both services share migrations and private files when launched from a package directory. */
export function repositoryRoot(start = process.cwd()) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (current === parent) throw new Error('Cannot locate the Jude workspace root.');
    current = parent;
  }
}

export const migrationsDirectory = () =>
  process.env.JUDE_MIGRATIONS_DIR || join(repositoryRoot(), 'migrations');
export const demoAssetsDirectory = () =>
  process.env.JUDE_DEMO_ASSETS_DIR || join(repositoryRoot(), 'apps/web/static/demo/documents');
export const databasePath = () =>
  process.env.JUDE_DB_PATH || join(repositoryRoot(), '.jude-data/workspace.sqlite');
export const originalsDirectory = () =>
  process.env.JUDE_FILES_DIR || join(repositoryRoot(), '.jude-data/files');
