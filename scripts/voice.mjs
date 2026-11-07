// Resolve a project-local Python environment for pnpm and the combined launcher.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const voiceDir = join(root, 'apps/voice');

export function launchVoice(env, args = ['-m', 'jude_voice']) {
  const local = join(
    voiceDir,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  );
  const python = env.JUDE_VOICE_PYTHON || (existsSync(local) ? local : 'python3');
  const pythonPath = [voiceDir, env.PYTHONPATH].filter(Boolean).join(delimiter);
  return spawn(python, args, { cwd: root, env: { ...env, PYTHONPATH: pythonPath }, stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args =
    process.argv[2] === 'test' ? ['-m', 'unittest', 'discover', '-s', 'apps/voice/tests', '-v'] : undefined;
  const voice = launchVoice(process.env, args);
  voice.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  voice.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => voice.kill(signal));
}
