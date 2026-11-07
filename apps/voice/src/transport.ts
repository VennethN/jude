import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { sessionFromToken } from '@jude/core/server/auth';
import { authorizeCase, changeIn, readWorkspace } from '@jude/core/server/cases';
import { transaction } from '@jude/core/server/db';
import { meter } from '@jude/core/server/billing';
import { putOriginal } from '@jude/core/server/providers/storage';
import { addVoice } from './audio';
import { runAnalysisWorker } from '@jude/core/server/jobs';

const validId=/^[a-zA-Z0-9_-]{1,90}$/;
type Turn={ id:string; t:number; pcm:string; keep:boolean };
const send=(ws:WebSocket,value:unknown)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value))};

function decodeTurn(data:Buffer):Turn {
 const o=JSON.parse(data.toString());
 if(!validId.test(o.id)||typeof o.pcm!=='string'||!Number.isFinite(o.t)||o.t<0||o.t>604800||o.pcm.length>2_000_000||o.pcm.length<64||typeof o.keep!=='boolean')throw new Error('Invalid audio turn');
 const b=Buffer.from(o.pcm,'base64');if(b.length%2||b.toString('base64')!==o.pcm)throw new Error('Invalid samples');
 return {id:o.id,t:o.t,pcm:o.pcm,keep:o.keep};
}
export function attachVoice(server:Server){
 const sockets=new WebSocketServer({noServer:true,maxPayload:2_100_000,perMessageDeflate:false});
 const stopWorker=runAnalysisWorker();
 async function upgrade(req:IncomingMessage,socket:Duplex,head:Buffer,caseId:string,hearingId:string){
  const expected=process.env.ORIGIN||'http://'+req.headers.host;
  if(req.headers.origin!==expected||!process.env.OPENAI_API_KEY)throw new Error('Unavailable');
  const token=/(?:^|;\s*)jude_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1];
  const session=await sessionFromToken(token);if(!session||session.user.guest)throw new Error('Unauthorized');
  await authorizeCase(session,caseId,'write');
  const org=session.organization.id,w=await readWorkspace(org,caseId);
  const hearing=w.hearings.find(h=>h.id===hearingId);
  if(w.caseRecord.label==='synthetic'||hearing?.mode!=='live'||hearing.closed||hearing.recordingPermission?.by!==session.user.id)throw new Error('Recording permission required');
  const lease=randomUUID(),now=Date.now();
  const locked=await transaction(db=>db.query('INSERT INTO voice_leases(case_id,hearing_id,holder,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(case_id,hearing_id) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at WHERE voice_leases.expires_at<$5 RETURNING holder',[caseId,hearingId,lease,now+30000,now]));
  if(!locked.length)throw new Error('Another recorder is connected');
  sockets.handleUpgrade(req,socket,head,ws=>{
   const upstream=new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription',{headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},maxPayload:16*1024*1024});
   let active:Turn|undefined,ready=false,busy=false,stopped=false,deadline:ReturnType<typeof setTimeout>|undefined;
   function close(){if(stopped)return;stopped=true;clearInterval(timer);clearTimeout(deadline);if(upstream.readyState!==WebSocket.CLOSED)upstream.close();void transaction(db=>db.query('DELETE FROM voice_leases WHERE holder=$1',[lease])).catch(()=>{});if(ws.readyState===WebSocket.OPEN)ws.close()}
   const timer=setInterval(()=>{void (async()=>{const current=await sessionFromToken(token);if(!current)throw new Error();await authorizeCase(current,caseId,'write');
    const state=await readWorkspace(org,caseId);if(state.hearings.find(h=>h.id===hearingId)?.mode!=='live')throw new Error();
    const rows=await transaction(db=>db.query('UPDATE voice_leases SET expires_at=$1 WHERE holder=$2 RETURNING holder',[Date.now()+30000,lease]));if(!rows.length)throw new Error();
   })().catch(close)},12000);
   upstream.on('open',()=>{send(upstream,{type:'session.update',session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL||'gpt-live-transcribe',languages:['id','en']},turn_detection:null}}}})});
   ws.on('error',close);ws.on('close',close);upstream.on('error',()=>{send(ws,{type:'error',code:'provider_unavailable'});close()});upstream.on('close',close);
   const ack=(id:string)=>{clearTimeout(deadline);active=undefined;busy=false;send(ws,{type:'ack',id})};
   upstream.on('message',async raw=>{
    try{const e=JSON.parse(raw.toString());
     if(e.type==='session.updated'){ready=true;send(ws,{type:'ready'});return}
     if(e.type==='error'||e.type==='conversation.item.input_audio_transcription.failed'){send(ws,{type:'error',code:'transcription_failed'});close();return}
     if(!active)return;
     if(e.type==='conversation.item.input_audio_transcription.delta'){send(ws,{type:'partial',text:e.delta});return}
     if(e.type!=='conversation.item.input_audio_transcription.completed')return;
     const turn=active, bytes=Buffer.from(turn.pcm,'base64'),sid='mic-'+hearingId+'-'+turn.id;
     if(typeof e.transcript!=='string')throw new Error();
     const objectKey=turn.keep?[org,caseId,hearingId,turn.id+'.pcm'].join('/'):null;
     if(objectKey)await putOriginal(objectKey,bytes,'application/octet-stream');
     await transaction(async db=>{await changeIn(db,org,caseId,record=>{
      const h=record.hearings.find(h=>h.id===hearingId);
      if(h?.mode!=='live'||h.recordingPermission?.by!==session.user.id)throw new Error();
      if(e.transcript.trim()&&!record.statements.some(s=>s.id===sid)){
       record.statements.push({id:sid,hearingId,speakerId:addVoice(record,hearingId,'1'),t:turn.t,text:e.transcript.trim().slice(0,30000),phase:'queued'});
      }
      if(objectKey)h.audio='/api/live/'+caseId+'/'+hearingId+'/audio';
     });
     const inserted=await db.query('INSERT INTO voice_turns(case_id,hearing_id,id,start_seconds,bytes,object_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',[caseId,hearingId,turn.id,turn.t,bytes.length,objectKey]);
     if(inserted.length)await meter(db,org,'hours',bytes.length/48000);
     });ack(turn.id);
    }catch{send(ws,{type:'error',code:'save_failed'});close()}
   });
   ws.on('message',async raw=>{
    try{if(!ready||busy)throw new Error();busy=true;const turn=decodeTurn(raw as Buffer);
     const known=await transaction(db=>db.query('SELECT id FROM voice_turns WHERE case_id=$1 AND hearing_id=$2 AND id=$3',[caseId,hearingId,turn.id]));
     if(known.length){ack(turn.id);return}active=turn;
     send(upstream,{type:'input_audio_buffer.append',audio:turn.pcm});send(upstream,{type:'input_audio_buffer.commit'});
     deadline=setTimeout(()=>{send(ws,{type:'error',code:'transcription_timeout'});close()},45000);
    }catch{send(ws,{type:'error',code:'invalid_turn'});close()}
   });
  });
 }
 const listener=(req:IncomingMessage,socket:Duplex,head:Buffer)=>{
  const m=/^\/api\/live\/([\w-]+)\/([\w-]+)\/socket$/.exec((req.url??'').split('?')[0]);if(!m)return;
  void upgrade(req,socket,head,m[1],m[2]).catch(()=>{if(!socket.destroyed)socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')});
 };
 server.on('upgrade',listener);
 server.once('close',()=>{stopWorker();server.off('upgrade',listener);for(const ws of sockets.clients)ws.terminate();sockets.close()});
}
