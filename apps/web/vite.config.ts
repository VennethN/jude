import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { voiceProxy } from './scripts/voice-proxy.js';

const repo = new URL('../../', import.meta.url);
const rootEnv = new URL('.env', repo);
const webEnv = new URL('.env', import.meta.url);

export default defineConfig(({ command }) => {
  const localVoice = 'http://127.0.0.1:' + (process.env.VOICE_PORT || '3001');
  let origin = process.env.VOICE_ORIGIN;
  // An explicitly configured local service must not fall back to the hosted gateway.
  if (command === 'serve' && !origin) {
    for (const file of [webEnv, rootEnv]) {
      if (existsSync(file)) origin ||= parseEnv(readFileSync(file, 'utf8')).VOICE_ORIGIN;
    }
  }
  const voiceTarget = new URL(origin || localVoice);
  if (command === 'serve') process.env.VOICE_ORIGIN = voiceTarget.origin;
  return {
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [sveltekit()],
    ssr: {
      noExternal: [/^@jude\//],
      external: [
        '@node-rs/argon2',
        'openai',
        'pg',
        'fflate',
        'pdfjs-dist',
        '@aws-sdk/client-sesv2',
        '@aws-sdk/client-s3',
        '@aws-sdk/s3-request-presigner',
      ],
    },
    server: {
      port: Number(process.env.PORT || 5173),
      strictPort: true,
      proxy: {
        '/api/live/': voiceProxy({
          ...process.env,
          VOICE_ORIGIN: origin || localVoice,
          JUDE_VOICE_REMOTE: voiceTarget.protocol === 'https:' ? 'true' : process.env.JUDE_VOICE_REMOTE,
        }),
      },
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
        deny: [
          '.env',
          '.env.*',
          '**/.git/**',
          '**/.local-access/**',
          '**/.aws/**',
          '**/.jude-data/**',
          '**/*.sqlite*',
          '**/*.tfvars',
          '**/packages/core/src/server/**',
          '**/apps/voice/**',
        ],
      },
    },
  };
});
