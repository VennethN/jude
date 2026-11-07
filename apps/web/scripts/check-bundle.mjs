// Count the minified JavaScript the SvelteKit client imports before opening a route.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const client = fileURLToPath(new URL('../.svelte-kit/output/client/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(client, '.vite/manifest.json'), 'utf8'));
const entries = Object.keys(manifest).filter((key) => manifest[key].file.startsWith('_app/immutable/entry/'));
if (!entries.length) throw new Error('Build the web client before checking its entry bundle.');
const files = new Set();
function include(key) {
  const module = manifest[key];
  if (files.has(module.file)) return;
  files.add(module.file);
  for (const dependency of module.imports || []) include(dependency);
}
for (const entry of entries) include(entry);
const bytes = [...files].reduce((size, file) => size + statSync(join(client, file)).size, 0);
console.log('Initial JavaScript:', (bytes / 1000).toFixed(1), 'kB of 500 kB');
if (bytes > 500_000) process.exitCode = 1;
