// A single-host release starts two independent applications on loopback-connected ports.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { root, launchVoice } from './voice.mjs';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const webArgs = args.filter((arg) => arg !== '--dev');
const portIndex = webArgs.indexOf('--port');
const port = Number(portIndex < 0 ? process.env.PORT || (dev ? 5173 : 3000) : webArgs[portIndex + 1]);
const voicePort = Number(process.env.VOICE_PORT || port + 1);
const webDir = join(root, 'apps/web');
const remoteVoice = dev && process.env.JUDE_VOICE_REMOTE === 'true';
if (remoteVoice && !process.env.VOICE_ORIGIN) throw new Error('Remote voice requires VOICE_ORIGIN.');
const env = {
  ...process.env,
  PORT: String(port),
  VOICE_PORT: String(voicePort),
  VOICE_ORIGIN: process.env.VOICE_ORIGIN || 'http://127.0.0.1:' + voicePort,
  JUDE_MIGRATIONS_DIR: process.env.JUDE_MIGRATIONS_DIR || join(root, 'migrations'),
  JUDE_DEMO_ASSETS_DIR: process.env.JUDE_DEMO_ASSETS_DIR || join(webDir, 'static/demo/documents'),
  JUDE_FILES_DIR: process.env.JUDE_FILES_DIR || join(root, '.jude-data/files'),
};
if (dev && !env.DATABASE_URL && !env.JUDE_DB_PATH)
  env.JUDE_DB_PATH = join(root, '.jude-data/workspace.sqlite');

const require = createRequire(join(webDir, 'package.json'));
const webCommand = dev
  ? [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ...webArgs]
  : ['server.mjs'];
const children = [
  ...(remoteVoice ? [] : [launchVoice(env)]),
  spawn(process.execPath, webCommand, { cwd: webDir, env, stdio: 'inherit' }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 11000).unref();
}
for (const child of children) {
  child.once('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once('exit', (code) => stop(code ?? 1));
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
