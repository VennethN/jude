import type { Finding, L10n, Statement, Workspace } from '../../domain';
import { retrieve } from './assistant';
import { objectSchema, safeLanguage, str, structured } from './openai';

const l10n=objectSchema({id:str,en:str});
const statuses=['supported','potential_inconsistency','context_needed','insufficient_evidence'] as const;
const relations=['supports','conflicts','context','related'] as const;
const source=objectSchema({passageId:str,match:str,relation:{type:'string',enum:relations}});
const schema=objectSchema({checkable:{type:'boolean'},status:{type:'string',enum:statuses},said:str,title:l10n,explanation:l10n,verify:l10n,uncertainty:l10n,question:str,sources:{type:'array',items:source}});
const comparisonInstructions = [
  'Compare this exact testimony with all supplied passages. Preserve the transcript and quote an exact substring in said; never repair a name, time, or wording.',
  'Return checkable false for procedural speech. For a factual claim, identify the person, event, place, date and what each time actually measures before comparing.',
  'Use potential_inconsistency for a concrete possible difference about the same apparent event, even when identity or date still needs confirmation. State those limits explicitly; a missing date, a name spelling difference, or a merely possible return does not by itself erase the comparison.',
  'Do not confirm identity from a similar name, access-card name, or speaker label. Distinguish a card-use record from an officer reporting that they checked identity and saw the person enter. Attribute each observation to its source.',
  'Compare contemporaneous records, direct observations and prior clarification together. If they disagree, cite the strongest relevant evidence on both sides, rather than citing only the prior statement that resembles the testimony.',
  'Use context_needed when a concrete unresolved distinction prevents even a tentative same-event comparison; explain that distinction and cite the evidence bearing on it. Use insufficient_evidence when the supplied record provides no relevant evidence. Use supported only for what the sources actually corroborate.',
  'An explicit later return, a clearly different person, or a different date/event must not be called a time contradiction with an earlier entry. Do not invent such a distinction when it is only hypothetical. Do not infer that an access log is exhaustive unless the record says so.',
  'Describe a possible discrepancy for counsel to verify, never guilt, dishonesty or credibility. Give a concise bilingual explanation and uncertainty, exact source excerpts, and an Indonesian question that resolves the material uncertainty.',
].join(' ');
const reviewInstructions = [
  'Independently check the draft against the exact transcript and every supplied passage. Accept only a useful, cautious evidence comparison with exact quotations.',
  'Reject invented identity, corrected transcript wording, unsupported claims or judgments of a person. A similar name or speaker label is not proof of identity.',
  'Reject confusion between different people, dates, events, card use and observed entry, or an explicit later return and an earlier entry.',
  'Also reject a context_needed draft that omits concrete contrary evidence merely because a return, different date or spelling is hypothetically possible. A qualified potential_inconsistency can preserve those uncertainties without asserting identity or contradiction as established.',
  'Check that the cited passages include the strongest material contrary observation as well as relevant clarification; a quotation from a prior statement alone must not conceal a conflicting contemporaneous record.',
].join(' ');
function translated(x:unknown):x is L10n {
  return !!x&&typeof x==='object'&&'en' in x&&'id' in x&&typeof x.en==='string'&&typeof x.id==='string'&&safeLanguage(x.en+' '+x.id);
}
export async function analyzeStatement(workspace:Workspace,line:Statement,orgId?:string):Promise<Finding|null>{
  // Keep the retrieval shortlist: a lower-ranked direct observation may resolve
  // what a more similar prior statement leaves uncertain.
  const sources=await retrieve(workspace,line.text,[{kind:'documents'}],'id',orgId);
  if(!sources.length||!process.env.OPENAI_API_KEY)return null;
  try {
    const draft=await structured('analysis',comparisonInstructions,{line:line.text,sources},schema) as (Finding&{checkable:boolean})|null;
    if(!draft?.checkable||!statuses.includes(draft.status)||!draft.said||!line.text.includes(draft.said)||!translated(draft.title)||!translated(draft.explanation)||!translated(draft.verify)||!translated(draft.uncertainty)||typeof draft.question!=='string'||!safeLanguage(draft.question))return null;
    if(!Array.isArray(draft.sources)||!draft.sources.length||!draft.sources.every(s=>s.match&&relations.includes(s.relation)&&sources.some(p=>p.id===s.passageId&&p.text.includes(s.match!))))return null;
    const review=await structured('review',reviewInstructions,{draft,line:line.text,sources},objectSchema({accept:{type:'boolean'}})) as {accept?:boolean}|null;
    if(review?.accept!==true)return null;
    return {id:'finding-'+line.id,hearingId:line.hearingId,statementId:line.id,status:draft.status,title:draft.title,explanation:draft.explanation,verify:draft.verify,uncertainty:draft.uncertainty,question:draft.question,said:draft.said,sources:draft.sources,reviewed:false,note:''};
  }catch{return null}
}
