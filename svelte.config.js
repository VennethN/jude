import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csrf: { trustedOrigins: [] },
    csp: { directives: { 'frame-ancestors': ['self'], 'object-src': ['none'], 'base-uri': ['self'] } }
  }
};
