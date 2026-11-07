import { randomUUID } from 'node:crypto';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { Hearing, Statement } from '@jude/core/domain';
import { authorizeCase, changeIn, orgLock, readWorkspace } from '@jude/core/server/cases';
import { transaction } from '@jude/core/server/db';
import { checkQuota, meter } from '@jude/core/server/billing';
import { ApiError } from '@jude/core/server/validation';
import { fileTranscript, addVoice, audioKey } from '../audio';
import { putOriginal, removeOriginal } from '@jude/core/server/providers/storage';

export const POST: RequestHandler = async ({request,params,locals})=>{
 if(!locals.session)error(401);const org=locals.session.organization.id,id=params.caseId!;
 try{
  await authorizeCase(locals.session,id,'write');const initial=await readWorkspace(org,id);if(initial.caseRecord.archived)error(409);
  if(!process.env.OPENAI_API_KEY)return json({error:{code:'provider_unavailable',message:'Transcription is unavailable.'}},{status:503});
  if(locals.session.user.guest||initial.caseRecord.label==='synthetic')error(403);
  const f=await request.formData(),file=f.get('file'),title=String(f.get('title')??'').trim(),date=String(f.get('date')??'');
  if(!(file instanceof File)||!file.size||file.size>25*1024*1024||!title||title.length>200||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/[.](mp3|wav|webm|m4a|mp4|mpeg|mpga)$/i.test(file.name))error(422);
  await transaction(db=>checkQuota(db,org,'hours',1/3600));
  const segments=await fileTranscript(file,String(f.get('lang')??'id'));if(!segments.length)error(422);
  const duration=Math.max(...segments.map(s=>s.end));if(duration>1800)error(413);
  const hid=randomUUID(),key=audioKey(org,id,hid);
  await putOriginal(key,new Uint8Array(await file.arrayBuffer()),file.type||'application/octet-stream');
  const lines:Statement[]=[];
  try{
   const hearing=await transaction(async db=>{await orgLock(db,org);await checkQuota(db,org,'hours',duration/3600);await checkQuota(db,org,'storage',file.size/1e9);
     const created=await changeIn(db,org,id,w=>{const h:Hearing={id:hid,caseId:id,number:1+Math.max(0,...w.hearings.map(h=>h.number)),mode:'recorded',date,title:{id:title,en:title},duration,audio:'/api/live/'+id+'/'+hid+'/audio'};w.hearings.push(h);
       for(const s of segments){const line:Statement={id:randomUUID(),hearingId:hid,speakerId:addVoice(w,hid,s.speaker),text:s.text,t:s.t,phase:'queued'};w.statements.push(line);lines.push(line)}return h});
     await db.query('INSERT INTO attachments(case_id,entity_id,kind,object_key,file_name,mime,byte_length) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,hid,'audio',key,file.name,file.type||'application/octet-stream',file.size]);await meter(db,org,'hours',duration);return created});
   
   return json(hearing,{status:201});
  }catch(e){await removeOriginal(key);throw e}
 }catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message}},{status:e.status});if(typeof e==='object'&&e&&'status'in e&&typeof e.status==='number'&&e.status>=400&&e.status<500)throw e;return json({error:{code:'provider_unavailable',message:'The recording could not be transcribed.'}},{status:503})}
};
