import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: { fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.jude-data/**', '**/.jude/**', '**/*.tfvars'] } }
});
