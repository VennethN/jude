import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { voiceProxy } from './scripts/voice-proxy.js';

export default defineConfig({
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
    proxy: {
      '/api/live/': voiceProxy(process.env),
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
});
