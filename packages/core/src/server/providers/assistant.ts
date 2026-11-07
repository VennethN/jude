import { randomUUID } from 'node:crypto';
import type { ChatMessage, Citation, ContextRef, Lang, Workspace } from '../../domain';
import { structured } from './openai';
import { isCaseSummary, summaryEvidence } from './case-summary';
import { answerSchema, checkedParagraph, composeAnswer, readParagraphs, type AnswerParagraph } from './answer-paragraphs';
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
function caseSources(w: Workspace, lang: Lang): Source[] {
  const documents = new Map(w.documents.map(doc => [doc.id, doc.title]));
  const hearings = new Map(w.hearings.map(hearing => [hearing.id, hearing]));
  const speakers = new Map(w.speakers.map(speaker => [speaker.id, speaker.alias ?? speaker.label]));
  return [
    ...w.passages.map(p => ({
      kind: 'passage' as const, id: p.id, text: p.text,
      group: (documents.get(p.docId) ?? '') + ' p. ' + p.page,
    })),
    ...w.statements.map(s => {
      const hearing = hearings.get(s.hearingId);
      const source = hearing && (lang === 'id' ? 'Sidang ' : 'Hearing ') + hearing.number + ' · ' + hearing.title[lang];
      return { kind: 'statement' as const, id: s.id, text: s.text, group: [speakers.get(s.speakerId), source].filter(Boolean).join(' · ') };
    }),
    ...w.findings.map(f => ({ kind: 'finding' as const, id: f.id, text: f.explanation[lang], group: f.title[lang] })),
  ];
}

export async function retrieve(w:Workspace,query:string,refs:ContextRef[],lang:Lang,orgId?:string):Promise<Source[]>{
  const words=terms(query), scope=contextKeys(w,refs),isScoped=refs.length>0&&!refs.some(r=>r.kind==='case');
  const all = caseSources(w,lang);
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
const citationInstructions = [
  'Write clear paragraphs in the requested interface language. Keep the original language of the evidence quotes.',
  'Give each material assertion a citation to a numbered source and a short exact substring from that source.',
  'When comparing accounts, cite each side. Prefer the original testimony and documents over derivative findings.',
  'Write the summary in your own words, without quote marks or citation markers. The application formats the citations.',
  'An issue in the case index is a lead to verify against its sources. Case metadata identifies the matter and is not independent evidence.',
  'If the supplied sources support no material answer, return an empty paragraphs array.',
].join(' ');
const summaryInstructions = [
  'Write a brief case summary for counsel. Open with what this case concerns and the central factual question.',
  'Explain the material sequence, identify who said or recorded what, and distinguish agreed facts from disputed or unverified ones.',
  'Address the most consequential uncertainty in the supplied record. If two times may describe different events, explain exactly what each source timed.',
  'Tie every uncertainty to concrete evidence or an express limitation in a source. Avoid generic speculation about missing information.',
  'Use two to four concise paragraphs as the record warrants. Prefer synthesis across sources to a list of quotes.',
].join(' ');

export async function answerQuestion(
  w: Workspace, question: string, contexts: ContextRef[], lang: Lang, allowModel = true,
  orgId?: string, onPartial?: (message: ChatMessage) => void,
): Promise<ChatMessage> {
  const overview = isCaseSummary(question, contexts) ? summaryEvidence(w, caseSources(w, lang), lang) : undefined;
  const sources = overview?.sources ?? await retrieve(w, question, contexts, lang, allowModel ? orgId : undefined);
  const first = sources.slice(0, 5);
  const fallback: ChatMessage = {
    id: randomUUID(), role: 'assistant', mode: 'sources-only',
    text: first.map((s, i) => '“' + s.text + '” [' + (i + 1) + ']').join('\n\n'),
    citations: first.map(({kind, id}) => ({kind, id})),
  };
  if (!allowModel || !sources.length || w.caseRecord.label === 'synthetic' || !process.env.OPENAI_API_KEY) return fallback;
  const partials: AnswerParagraph[] = [];
  let validPrefix = true;
  const acceptDelta = onPartial && readParagraphs(value => {
    if (!validPrefix || partials.length >= 8 || !checkedParagraph(value, sources)) { validPrefix = false; return; }
    partials.push(value);
    onPartial(composeAnswer(fallback.id, partials, sources));
  }, value => {
    if (validPrefix && partials.length < 8 && checkedParagraph(value, sources)) {
      onPartial(composeAnswer(fallback.id, [...partials, value], sources, true));
    }
  });
  try {
    const instructions = [
      'Answer in ' + (lang === 'id' ? 'Indonesian.' : 'English.'),
      overview ? summaryInstructions : 'Answer the specific question directly, within the selected context.',
      citationInstructions,
    ].join(' ');
    const boards = contexts.flatMap(r => r.kind === 'board' ? w.boards.filter(b => b.id === r.id) : []);
    const answer = await structured('assistant', instructions, {
      question,
      ...(overview && { case: { title: w.caseRecord.title, reference: w.caseRecord.reference, summary: w.caseRecord.summary[lang] }, issues: overview.issues }),
      boards: boards.map(b => ({ name: b.name, cards: b.cards, links: b.links })),
      sources: sources.map((s, i) => ({ number: i + 1, kind: s.kind, label: s.group, text: s.text.slice(0, 3600) })),
    }, answerSchema, acceptDelta);
    if (!answer || typeof answer !== 'object' || !('paragraphs' in answer) || !Array.isArray(answer.paragraphs)) return fallback;
    const { paragraphs } = answer;
    if (paragraphs.length === 0 || paragraphs.length > 8 || !paragraphs.every(p => checkedParagraph(p, sources))) return fallback;
    return composeAnswer(fallback.id, paragraphs, sources);
  } catch {
    return fallback;
  }
}
