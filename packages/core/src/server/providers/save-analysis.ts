import {randomUUID} from 'node:crypto';
import type {Statement} from '../../domain';
import {mutateWorkspace,readWorkspace} from '../cases';
import {analyzeStatement} from './analysis';

export async function analyzeSaved(org:string,caseId:string,line:Statement){
 const w=await readWorkspace(org,caseId), result=await analyzeStatement(w,line);
 await mutateWorkspace(org,caseId,ws=>{
   const s=ws.statements.find(s=>s.id===line.id);if(!s)return;s.phase=result?'complete':'saved';
   if(result&&!ws.findings.some(f=>f.id===result.id)){ws.findings.push(result);for(const ref of result.sources){
     if(!ws.connections.some(c=>c.from.id===line.id&&c.to.id===ref.passageId))ws.connections.push({id:randomUUID(),from:{kind:'statement',id:line.id},to:{kind:'passage',id:ref.passageId},relation:ref.relation,reviewed:false,basis:'ai',why:result.explanation});
   }}
 });
}
