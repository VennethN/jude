// Package the existing adapter-node build for Amplify Hosting's SSR contract.
// No voice server, WebSocket listener, worker, or credential values are added.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

const root = process.cwd();
const app = join(root, 'apps/web');
const output = join(root, '.amplify-hosting');
if (!existsSync(join(app, 'build/handler.js'))) throw new Error('Build apps/web with adapter-node before packaging.');
const staging = mkdtempSync(join(tmpdir(), 'jude-amplify-'));
const deployed = join(staging, 'web');

function copyRuntimeDependencies(source, destination) {
  // The SvelteKit build bundles @jude workspaces and UI libraries. Keep only
  // its external server dependencies and their actual pnpm dependency graph.
  const runtime = ['@aws-sdk/client-s3', '@aws-sdk/client-sesv2', '@aws-sdk/s3-request-presigner',
    '@node-rs/argon2', 'fflate', 'openai', 'pg', 'pdfjs-dist', '@sveltejs/kit'];
  const store = realpathSync(join(source, '.pnpm'));
  const needed = new Set();
  function visit(link) {
    const actual = realpathSync(link);
    if (!actual.startsWith(store + sep)) throw new Error('Dependency points outside the portable pnpm store.');
    const id = relative(store, actual).split(sep)[0];
    if (needed.has(id)) return;
    needed.add(id);
    const dependencies = join(store, id, 'node_modules');
    for (const name of readdirSync(dependencies)) {
      const candidate = join(dependencies, name);
      if (lstatSync(candidate).isSymbolicLink()) visit(candidate);
      else if (name.startsWith('@')) {
        for (const child of readdirSync(candidate)) {
          const scoped = join(candidate, child);
          if (lstatSync(scoped).isSymbolicLink()) visit(scoped);
        }
      }
    }
  }
  for (const name of runtime) visit(join(source, name));
  mkdirSync(join(destination, '.pnpm'), { recursive: true });
  for (const id of needed) cpSync(join(store, id), join(destination, '.pnpm', id), {
    recursive: true, dereference: false, verbatimSymlinks: true,
  });
  for (const name of runtime) {
    mkdirSync(dirname(join(destination, name)), { recursive: true });
    cpSync(join(source, name), join(destination, name), { recursive: true, dereference: false, verbatimSymlinks: true });
  }
}

try {
  execFileSync('pnpm', ['--filter', '@jude/web', '--prod', 'deploy', '--legacy', deployed], { cwd: root, stdio: 'inherit' });
  rmSync(output, { recursive: true, force: true });
  const compute = join(output, 'compute/default');
  mkdirSync(compute, { recursive: true });
  copyRuntimeDependencies(join(deployed, 'node_modules'), join(compute, 'node_modules'));
  writeFileSync(join(compute, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
  cpSync(join(app, 'build'), join(compute, 'build'), { recursive: true });
  cpSync(join(app, 'server.mjs'), join(compute, 'app-server.mjs'));
  cpSync(join(app, 'build/client'), join(output, 'static'), { recursive: true });
  if (existsSync(join(app, 'build/prerendered'))) cpSync(join(app, 'build/prerendered'), join(output, 'static'), { recursive: true });
  cpSync(join(root, 'migrations'), join(compute, 'migrations'), { recursive: true });
  cpSync(join(app, 'static/demo/documents'), join(compute, 'demo'), { recursive: true });
  // Legacy path helpers use the marker to locate their packaged workspace.
  writeFileSync(join(compute, 'pnpm-workspace.yaml'), 'packages: []\n');
  const origin = process.env.JUDE_WEB_ORIGIN || '';
  if (origin && !/^https:\/\/[a-z0-9.-]+$/.test(origin)) throw new Error('JUDE_WEB_ORIGIN must be an HTTPS origin.');
  const entrypoint = `import { fileURLToPath } from 'node:url';
process.env.NODE_ENV = 'production';
process.env.HOST = '0.0.0.0';
process.env.PORT = '3000';
process.env.PROTOCOL_HEADER = 'x-forwarded-proto';
process.env.HOST_HEADER = 'x-forwarded-host';
process.env.ADDRESS_HEADER = 'x-forwarded-for';
process.env.XFF_DEPTH = '1';
process.env.BODY_SIZE_LIMIT ??= '64M';
process.env.JUDE_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));
process.env.JUDE_DEMO_ASSETS_DIR = fileURLToPath(new URL('./demo', import.meta.url));
${origin ? `process.env.ORIGIN ??= ${JSON.stringify(origin)};` : ''}
await import('./app-server.mjs');
`;
  writeFileSync(join(compute, 'server.mjs'), entrypoint);
  const appPackage = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  const manifest = {
    version: 1,
    routes: [
      { path: '/_app/immutable/*', target: { kind: 'Static', cacheControl: 'public, max-age=31536000, immutable' } },
      ...['/fonts/*', '/public/*', '/demo/documents/*', '/jude.svg', '/voice-capture.js'].map(path => ({ path, target: { kind: 'Static' } })),
      { path: '/*', target: { kind: 'Compute', src: 'default' } },
    ],
    computeResources: [{ name: 'default', runtime: 'nodejs24.x', entrypoint: 'server.mjs' }],
    framework: { name: 'sveltekit', version: appPackage.dependencies['@sveltejs/kit'].replace(/^[^0-9]+/, '') },
  };
  writeFileSync(join(output, 'deploy-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  function inspect(folder) {
    let bytes = 0;
    for (const entry of readdirSync(folder)) {
      const path = join(folder, entry), stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const destination = realpathSync(path);
        if (destination !== compute && !destination.startsWith(compute + sep)) throw new Error(`Nonportable dependency link: ${relative(compute, path)}`);
      } else if (stat.isDirectory()) bytes += inspect(path);
      else bytes += stat.size;
    }
    return bytes;
  }
  const bytes = inspect(compute);
  if (bytes > 220_000_000) throw new Error(`Compute bundle exceeds Amplify's 220 MB limit (${bytes} bytes).`);
  console.log(`Amplify SSR artifact: ${relative(root, output)}; compute ${(bytes / 1_000_000).toFixed(1)} MB.`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
