import type { Reply, Statement, Workspace } from '@jude/core/domain';
import { needsReview } from '@jude/core/domain';
import { liveScript, altScript } from '@jude/core/server/seed';
import { ApiError, required } from '@jude/core/server/validation';

export function counselReply(w:Workspace,line:Statement):Reply|null {
 const speaker=w.speakers.find(s=>s.id===line.speakerId);
 const previous=w.statements.filter(s=>s.hearingId===line.hearingId&&s.id!==line.id).at(-1);
 const assigned=w.speakers.find(s=>s.id===speaker?.alias)??speaker;
 const reason=assigned?.role==='judge'&&/penasihat hukum|penasehat hukum/i.test(line.text)?'called':assigned?.role==='opposing'&&/keberatan/i.test(line.text)&&previous?.speakerId==='ph'?'objection':assigned?.role==='witness'&&previous?.speakerId==='ph'?'answer':null;
 const counsel=w.speakers.find(s=>s.role==='counsel');
 if(!reason||!counsel)return null;
 const findings=w.findings.filter(needsReview).sort((a,b)=>Number(b.hearingId===line.hearingId)-Number(a.hearingId===line.hearingId)).slice(0,3);
 const suggestions:Reply['suggestions']=findings.map(f=>({text:f.question,basis:{kind:'finding',id:f.id},why:f.verify,confidence:f.status==='potential_inconsistency'?.83:.66}));
 suggestions.push({text:'Mohon waktu sebentar untuk memeriksa berkas, Yang Mulia.',basis:{kind:'procedure'},why:{id:'Memberi waktu untuk memeriksa sumber.',en:'Allows time to examine the source.'},confidence:.5});
 return {id:'reply-'+line.id,hearingId:line.hearingId,statementId:line.id,forId:counsel.id,reason,suggestions};
}
export function advanceExample(w:Workspace,hearingId:string,expected:number){
 const hearing=required(w.hearings,h=>h.id===hearingId);
 if(w.caseRecord.label!=='synthetic'||hearing.mode!=='live')throw new ApiError(409,'not_replaying','This hearing has no active replay.');
 const script=hearingId==='h3'?liveScript:altScript;
 const prefix='replay-'+hearingId+'-',cursor=w.statements.filter(s=>s.id.startsWith(prefix)).length;
 if(expected!==cursor||cursor>=script.length)return {cursor,done:cursor>=script.length};
 const entry=script[cursor],id=prefix+cursor;
 const prior=w.statements.filter(s=>s.hearingId===hearingId).reduce((t,s)=>Math.max(t,s.t),0);
 const line:Statement={id,hearingId,speakerId:entry.speakerId,text:entry.text,t:prior+6,phase:'complete',legal:entry.legal};
 if(!w.speakers.some(s=>s.id===entry.speakerId))w.speakers.push({id:entry.speakerId,label:'',role:'unknown',confirmed:false});
 w.statements.push(line);
 if(entry.finding&&entry.finding.sources.every(s=>w.passages.some(p=>p.id===s.passageId)))w.findings.push({...entry.finding,id:'f-'+id,hearingId,statementId:id,reviewed:false,note:''});
 for(const [i,c] of (entry.connections??[]).entries())if(w.passages.some(p=>p.id===c.to.id))w.connections.push({...c,id:'c-'+id+'-'+i,from:{kind:'statement',id}});
 const reply=counselReply(w,line);if(reply)w.replies.push(reply);
 return {cursor:cursor+1,done:cursor+1>=script.length,pause:entry.pause??3600};
}
