import {build} from 'esbuild';
await build({
  entryPoints:['src/server.ts'],outfile:'dist/server.mjs',platform:'node',target:'node22',format:'esm',bundle:true,sourcemap:true,
  external:['@aws-sdk/*','@node-rs/argon2','openai','ws','pg','pdfjs-dist/*','fflate','@sveltejs/kit']
});
