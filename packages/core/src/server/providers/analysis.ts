import type { Finding, L10n, Statement, Workspace } from '../../domain';
import { retrieve } from './assistant';
import { objectSchema, safeLanguage, str, structured } from './openai';

const l10n=objectSchema({id:str,en:str});
const statuses=['supported','potential_inconsistency','context_needed','insufficient_evidence'] as const;
const relations=['supports','conflicts','context','related'] as const;
const source=objectSchema({passageId:str,match:str,relation:{type:'string',enum:relations}});
const schema=objectSchema({checkable:{type:'boolean'},status:{type:'string',enum:statuses},said:str,title:l10n,explanation:l10n,verify:l10n,uncertainty:l10n,question:l10n,sources:{type:'array',items:source}});
function translated(x:unknown):x is L10n {
  return !!x&&typeof x==='object'&&'en' in x&&'id' in x&&typeof x.en==='string'&&typeof x.id==='string'&&!!x.en.trim()&&!!x.id.trim()&&safeLanguage(x.en+' '+x.id);
}
export async function analyzeStatement(workspace:Workspace,line:Statement,orgId?:string):Promise<Finding|null>{
  const sources=(await retrieve(workspace,line.text,[{kind:'documents'}],'id',orgId)).slice(0,10);
  if(!sources.length||!process.env.OPENAI_API_KEY)return null;
  try {
    const draft=await structured('analysis','Compare this exact testimony with the supplied passages. Flag only verifiable differences. A different time or location can refer to a different event. Return checkable false for procedural speech. Cite verbatim excerpts on both sides, write the suggested clarification question in both Indonesian and English (question.id and question.en), keep verbatim source quotes unchanged, and describe what remains uncertain in both languages.',{line:line.text,sources},schema) as (Omit<Finding,'question'>&{checkable:boolean;question:L10n})|null;
    if(!draft?.checkable||!statuses.includes(draft.status)||!draft.said||!line.text.includes(draft.said)||!translated(draft.title)||!translated(draft.explanation)||!translated(draft.verify)||!translated(draft.uncertainty)||!translated(draft.question))return null;
    if(!Array.isArray(draft.sources)||!draft.sources.length||!draft.sources.every(s=>s.match&&relations.includes(s.relation)&&sources.some(p=>p.id===s.passageId&&p.text.includes(s.match!))))return null;
    const review=await structured('review','Check the draft against its quotations. Reject unsupported claims, confusion about separate events, or judgments of a person. Accept only a useful and cautious evidence comparison.',{draft,line:line.text,sources},objectSchema({accept:{type:'boolean'}})) as {accept?:boolean}|null;
    if(review?.accept!==true)return null;
    return {id:'finding-'+line.id,hearingId:line.hearingId,statementId:line.id,status:draft.status,title:draft.title,explanation:draft.explanation,verify:draft.verify,uncertainty:draft.uncertainty,question:draft.question.id,questionTranslation:draft.question,said:draft.said,sources:draft.sources,reviewed:false,note:''};
  }catch{return null}
}
