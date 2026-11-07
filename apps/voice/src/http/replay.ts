import { json, error } from '@sveltejs/kit';
import { authorizeCase, mutateWorkspace } from '@jude/core/server/cases';
import { advanceExample } from '../replay';
import { ApiError } from '@jude/core/server/validation';
import type {RequestHandler} from '@sveltejs/kit';

export const POST:RequestHandler=async({locals,params,request,url})=>{
  if(!locals.session)error(401);
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)error(403);
  const body=await request.json();
  if(!Number.isInteger(body?.cursor)||body.cursor<0)error(422);
  try{await authorizeCase(locals.session,params.caseId!,'write');return json(await mutateWorkspace(locals.session.organization.id,params.caseId!,w=>advanceExample(w,params.hearingId!,body.cursor)))}
  catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message}},{status:e.status});throw e}
};
