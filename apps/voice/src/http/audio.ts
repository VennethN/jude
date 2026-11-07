import { error, redirect } from '@sveltejs/kit';
import { authorizeCase, readWorkspace } from '@jude/core/server/cases';
import { audioKey } from '../audio';
import { getOriginal, originalURL } from '@jude/core/server/providers/storage';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler=async({locals,params,request})=>{
 if(!locals.session)error(401);const org=locals.session.organization.id;
 await authorizeCase(locals.session,params.caseId!,'read');const w=await readWorkspace(org,params.caseId!);if(!w.hearings.find(h=>h.id===params.hearingId!)?.audio)error(404);
 const key=audioKey(org,params.caseId!,params.hearingId!),url=await originalURL(key);if(url)redirect(303,url);
 const audio=await getOriginal(key);const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range')??'');
 const headers:Record<string,string>={'Cache-Control':'private, no-store','Accept-Ranges':'bytes','Content-Type':'application/octet-stream'};
 if(!range)return new Response(new Uint8Array(audio),{headers});
 const from=Number(range[1]),to=Math.min(audio.length-1,Number(range[2]||audio.length-1));
 if(from>to||from>=audio.length)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+audio.length}});
 return new Response(new Uint8Array(audio.slice(from,to+1)),{status:206,headers:{...headers,'Content-Range':'bytes '+from+'-'+to+'/'+audio.length}});
};
