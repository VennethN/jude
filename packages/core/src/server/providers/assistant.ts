import { randomUUID } from 'node:crypto';
import type { ChatMessage, Citation, ContextRef, Lang, Workspace } from '../../domain';
import { objectSchema, safeLanguage, str, structured } from './openai';
import { mergeEvidenceRanks, semanticMatches } from './semantic-retrieval';

export interface Source extends Citation { text:string; group:string }
const stop = new Set('a an di dan ke dari yang atas apa apakah saya saya ini itu the of to what when who how is are did was which this in with dan untuk siapa what'.split(' '));
function terms(s:string){return new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).filter(v=>v.length>1&&!stop.has(v)))}
function key(v:{kind:string;id:string}) {return v.kind+':'+v.id}
function contextKeys(w:Workspace, refs:ContextRef[]) {
  const included=new Set<string>();
  function add(ref:{kind:string;id:string}){included.add(key(ref))}
  for(const ref of refs) {
    if(ref.kind==='case')continue;
    if(ref.kind==='documents'){for(const p of w.passages)add({kind:'passage',id:p.id});continue}
    add(ref);
    if(ref.kind==='finding'){
      const f=w.findings.find(v=>v.id===ref.id);if(f){add({kind:'statement',id:f.statementId});for(const s of f.sources)add({kind:'passage',id:s.passageId})}
    }else if(ref.kind==='document'){for(const p of w.passages.filter(p=>p.docId===ref.id))add({kind:'passage',id:p.id})}
    else if(ref.kind==='hearing'){for(const s of w.statements.filter(s=>s.hearingId===ref.id))add({kind:'statement',id:s.id})}
    else if(ref.kind==='board'){
      const b=w.boards.find(b=>b.id===ref.id);for(const c of b?.cards??[]){add(c);if(c.kind==='excerpt'&&b?.excerpts[c.id]?.passageId)add({kind:'passage',id:b.excerpts[c.id].passageId!})}
    }else if(ref.kind==='connection'){const c=w.connections.find(c=>c.id===ref.id);if(c){add(c.from);add(c.to)}}
    else if(ref.kind==='statement'||ref.kind==='passage'){for(const c of w.connections){if(key(c.from)===key(ref))add(c.to);if(key(c.to)===key(ref))add(c.from)}}
  }
  return included;
}
export async function retrieve(w:Workspace,query:string,refs:ContextRef[],lang:Lang,orgId?:string):Promise<Source[]>{
  const words=terms(query), scope=contextKeys(w,refs),isScoped=refs.length>0&&!refs.some(r=>r.kind==='case');
  const all:Source[]=[
    ...w.passages.map(p=>({kind:'passage' as const,id:p.id,text:p.text,group:(w.documents.find(d=>d.id===p.docId)?.title??'')+' p. '+p.page})),
    ...w.statements.map(s=>({kind:'statement' as const,id:s.id,text:s.text,group:w.speakers.find(p=>p.id===s.speakerId)?.label??''})),
    ...w.findings.map(f=>({kind:'finding' as const,id:f.id,text:f.explanation[lang],group:f.title[lang]}))
  ];
  const candidates = all.filter(s=>!isScoped||scope.has(key(s)));
  const ranked=candidates.map(source=>{
    const corpus=terms(source.group+' '+source.text), score=[...words].filter(v=>corpus.has(v)).length;
    return {source, lexical:score, score:score+(scope.has(key(source))?4:0)};
  });
  ranked.sort((a,b)=>b.score-a.score);
  const fallback=ranked.filter(v=>v.score>0).map(r=>r.source);
  const semantic = await semanticMatches(w, orgId, query, isScoped ? candidates.map(({kind,id})=>({kind,id})) : undefined);
  if (!semantic.length) return fallback.slice(0,16);
  const merged = mergeEvidenceRanks(ranked.filter(v=>v.lexical>0).map(r=>r.source), semantic, candidates, 16);
  const used = new Set(merged.map(key));
  return [...merged, ...fallback.filter(s=>!used.has(key(s)))].slice(0,16);
}
const paragraph=objectSchema({summary:str,evidence: {type:'integer'},quote:str});
interface AnswerPart{summary:string;evidence:number;quote:string}
function checkedParts(value:unknown,sources:Source[]):value is {paragraphs:AnswerPart[]} {
  if(!value||typeof value!=='object'||!('paragraphs' in value)||!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.length>8)return false;
  return value.paragraphs.every((p:AnswerPart)=>p&&Number.isInteger(p.evidence)&&typeof p.summary==='string'&&p.summary.length<=1200&&safeLanguage(p.summary)&&!/[“”"\[\]]/.test(p.summary)&&typeof p.quote==='string'&&p.quote.trim().length>=4&&sources[p.evidence-1]?.text.includes(p.quote));
}
export async function answerQuestion(w:Workspace,question:string,contexts:ContextRef[],lang:Lang,allowModel=true,orgId?:string):Promise<ChatMessage>{
  const sources=await retrieve(w,question,contexts,lang,allowModel ? orgId : undefined), first=sources.slice(0,5);
  const fallback:ChatMessage={id:randomUUID(),role:'assistant',mode:'sources-only',text:first.map((s,i)=>'“'+s.text+'” ['+(i+1)+']').join('\n\n'),citations:first.map(({kind,id})=>({kind,id}))};
  if(!allowModel||!sources.length||w.caseRecord.label==='synthetic'||!process.env.OPENAI_API_KEY)return fallback;
  try{
    const boards=contexts.flatMap(r=>r.kind==='board' ? w.boards.filter(b=>b.id===r.id) : []);
    const answer=await structured('assistant','Answer in '+(lang==='id'?'Indonesian':'English')+'. Each paragraph may state one qualified comparison or observation and must reference one numbered source plus a short exact, verbatim quote from it. Keep the summary free of quotations and citation markers. Return no paragraphs if evidence is insufficient.',{question,boards:boards.map(b=>({name:b!.name,cards:b!.cards,links:b!.links})),sources:sources.map((s,i)=>({number:i+1,text:s.text,source:s.group}))},objectSchema({paragraphs:{type:'array',items:paragraph}}));
    if(!checkedParts(answer,sources))return fallback;
    const citations:Citation[]=[];const text=answer.paragraphs.map(p=>{
      const {kind,id}=sources[p.evidence-1];let n=citations.findIndex(c=>c.kind===kind&&c.id===id);if(n<0){n=citations.length;citations.push({kind,id})}
      return p.summary+' “'+p.quote+'” ['+(n+1)+']';
    }).join('\n\n');
    return {...fallback,mode:'ai',text,citations};
  }catch{return fallback}
}
