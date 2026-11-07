import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig,searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  plugins: [sveltekit(),{
    name:'jude-voice',
    async configureServer(server){
      if(server.httpServer){
        const {attachVoice}=await server.ssrLoadModule('@jude/voice/transport');
        attachVoice(server.httpServer);
      }
    }
  }],
  ssr:{noExternal:[/^@jude\//],external:['@node-rs/argon2','openai','pg','ws','fflate','pdfjs-dist','@aws-sdk/client-sesv2','@aws-sdk/client-s3','@aws-sdk/s3-request-presigner']},
  server:{fs:{allow:[searchForWorkspaceRoot(process.cwd())],deny:['.env','.env.*','**/.git/**','**/.jude-data/**','**/*.sqlite*','**/*.tfvars','**/packages/core/src/server/**','**/apps/voice/src/**']}}
});
