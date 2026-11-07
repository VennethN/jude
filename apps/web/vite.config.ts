import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

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
      '/api/live/': {
        target: process.env.VOICE_ORIGIN || 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: false,
      },
    },
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
      deny: [
        '.env',
        '.env.*',
        '**/.git/**',
        '**/.jude-data/**',
        '**/*.sqlite*',
        '**/*.tfvars',
        '**/packages/core/src/server/**',
        '**/apps/voice/**',
      ],
    },
  },
});
