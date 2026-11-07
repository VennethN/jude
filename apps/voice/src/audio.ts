import type { Workspace } from '@jude/core/domain';
import { provider } from '@jude/core/server/providers/openai';
import { ApiError } from '@jude/core/server/validation';
import { toFile } from 'openai';

export function audioKey(org:string,caseId:string,hearingId:string){return [org,caseId,hearingId,'audio'].join('/')}
export function pcmWav(pcm:Buffer){
 const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
export async function fileTranscript(file:File,lang:string){
 const client=provider();if(!client)throw new ApiError(503,'provider_unavailable','Transcription is unavailable.');
 const model=process.env.OPENAI_TRANSCRIPTION_MODEL||'gpt-4o-transcribe-diarize';
 const audio=await toFile(new Uint8Array(await file.arrayBuffer()),file.name,{type:file.type});
 const data=await client.audio.transcriptions.create({file:audio,model,language:lang==='en'?'en':'id',...(model.includes('diarize')?{response_format:'diarized_json' as const,chunking_strategy:'auto'}:{response_format:'json' as const})});
 const segments='segments' in data && Array.isArray(data.segments)?data.segments.map(s=>({speaker:'speaker' in s?String(s.speaker):'1',t:s.start,end:s.end,text:s.text})): [{speaker:'1',t:0,end:0,text:data.text}];
 return segments.filter(s=>s.text?.trim());
}
export function addVoice(w:Workspace,hearingId:string,speaker:string){
 const id='voice-'+hearingId+'-'+speaker.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,70);
 if(!w.speakers.some(s=>s.id===id))w.speakers.push({id,label:'',role:'unknown',confirmed:false});
 return id;
}
