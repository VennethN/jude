import { randomUUID } from 'node:crypto';
import type { AssistantStage, ChatMessage, Citation, ContextRef, Lang, Workspace } from '../../domain';
import { providerIssue, structured } from './openai';
import { localSemanticSources } from './assistant-embeddings';
import { embeddingsConfigured } from './embeddings';
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

export function sourcePool(w:Workspace,refs:ContextRef[],lang:Lang):Source[]{
  const scope=contextKeys(w,refs),isScoped=refs.length>0&&!refs.some(r=>r.kind==='case');
  const all = caseSources(w, lang);
  return all.filter(s=>(!isScoped||scope.has(key(s)))&&s.text.trim());
}
export function retrieveLexical(w:Workspace,query:string,refs:ContextRef[],lang:Lang):Source[]{
  const words=terms(query), scope=contextKeys(w,refs);
  const ranked=sourcePool(w,refs,lang).map(source=>{
    const corpus=terms(source.group+' '+source.text), score=[...words].filter(v=>corpus.has(v)).length;
    return {source,score:score+(scope.has(key(source))?4:0)};
  });
  return ranked.filter(v=>v.score>0).sort((a,b)=>b.score-a.score).slice(0,16).map(r=>{
    // Bound prompt size while keeping an exact substring of the original record.
    const lower=r.source.text.toLowerCase();
    const match=[...words].map(word=>lower.indexOf(word)).filter(n=>n>=0).sort((a,b)=>a-b)[0]??0;
    const start=Math.max(0,match-500);
    return {...r.source,text:r.source.text.slice(start,start+6000)};
  });
}
interface RetrievalOptions {
  signal?: AbortSignal;
  minimumScore?: number;
  status?: (status: NonNullable<ChatMessage['retrieval']>) => void;
}
export async function retrieve(w: Workspace, query: string, refs: ContextRef[], lang: Lang, orgId?: string, options: RetrievalOptions = {}): Promise<Source[]> {
  const lexical = retrieveLexical(w, query, refs, lang);
  options.status?.('lexical');
  if (!orgId || w.caseRecord.label !== 'private' || w.caseRecord.archived || !embeddingsConfigured()) return lexical;
  const candidates = sourcePool(w, refs, lang);
  if (!candidates.length) return lexical;
  if (process.env.DATABASE_URL) {
    const scoped = refs.length > 0 && !refs.some(ref => ref.kind === 'case');
    const semantic = await semanticMatches(w, orgId, query, scoped ? candidates : undefined, options);
    if (!semantic.length) return lexical;
    return mergeEvidenceRanks(lexical, semantic, candidates, 16);
  }
  try {
    const found = await localSemanticSources(w, orgId, candidates, lexical, query, options.signal);
    options.status?.(found.partial ? 'partial' : 'hybrid');
    return found.sources;
  } catch (error) {
    options.signal?.throwIfAborted();
    console.warn('Assistant retrieval fallback', providerIssue(error));
    return lexical;
  }
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

export interface AnswerOptions { history?: ChatMessage[]; signal?: AbortSignal; progress?: (stage: AssistantStage) => void }
export function conversationQuery(question: string, history: ChatMessage[], lang: Lang) {
  // Resolve elliptical follow-ups without carrying an old topic into a new, standalone question.
  const followup = /\b(it|its|they|them|that|those|these|he|she|their|itu|tersebut|tadi|dia|mereka|nya)\b|\p{L}{3,}nya\b|^(and |also |what about |bagaimana dengan |lalu |kemudian )/iu.test(question);
  const recent = history.filter(m=>m.role==='user').slice(-2).map(m=>typeof m.text==='string'?m.text:m.text[lang]);
  return followup && recent.length ? question+'\n'+recent.join('\n').slice(-4000) : question;
}
export async function answerQuestion(
  w: Workspace, question: string, contexts: ContextRef[], lang: Lang, allowModel = true,
  orgId?: string, onPartial?: (message: ChatMessage) => void, options: AnswerOptions = {},
): Promise<ChatMessage> {
  const { signal, progress } = options;
  signal?.throwIfAborted();
  progress?.('retrieving');
  const history = (options.history ?? []).slice(-8).map(m => ({ role: m.role, text: (typeof m.text === 'string' ? m.text : m.text[lang]).slice(0, 1500) }));
  const query = conversationQuery(question, options.history ?? [], lang);
  let retrieval: ChatMessage['retrieval'] = 'lexical';
  const overview = isCaseSummary(question, contexts) ? summaryEvidence(w, caseSources(w, lang), lang) : undefined;
  const sources = overview?.sources ?? await retrieve(w, query, contexts, lang, allowModel ? orgId : undefined, { signal, minimumScore: 0, status: value => { retrieval = value; } });
  const first = sources.slice(0, 5);
  const fallback: ChatMessage = {
    id: randomUUID(), role: 'assistant', mode: 'sources-only',
    text: first.map((s, i) => '“' + s.text + '” [' + (i + 1) + ']').join('\n\n'),
    citations: first.map(({kind, id}) => ({kind, id})),
  };
  if (!overview && w.caseRecord.label === 'private') fallback.retrieval = retrieval;
  if (!allowModel || w.caseRecord.label === 'synthetic') return fallback;
  if (!process.env.OPENAI_API_KEY) return { ...fallback, issue: 'not_configured' };
  if (!sources.length) return { ...fallback, issue: 'insufficient' };
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
    progress?.('answering');
    const instructions = [
      'Answer in ' + (lang === 'id' ? 'Indonesian.' : 'English.'),
      overview ? summaryInstructions : 'Answer the specific question directly, within the selected context.',
      citationInstructions,
      'Use conversation history only to interpret the question, never as evidence.',
    ].join(' ');
    const boards = contexts.flatMap(r => r.kind === 'board' ? w.boards.filter(b => b.id === r.id) : []);
    const answer = await structured('assistant', instructions, {
      question, history,
      ...(overview && { case: { title: w.caseRecord.title, reference: w.caseRecord.reference, summary: w.caseRecord.summary[lang] }, issues: overview.issues }),
      boards: boards.map(b => ({ name: b.name, cards: b.cards, links: b.links })),
      sources: sources.map((s, i) => ({ number: i + 1, kind: s.kind, label: s.group, text: s.text.slice(0, 3600) })),
    }, answerSchema, acceptDelta, signal);
    signal?.throwIfAborted();
    if (!answer || typeof answer !== 'object' || !('paragraphs' in answer) || !Array.isArray(answer.paragraphs)) return { ...fallback, issue: answer === null ? 'incomplete' : 'unverified' };
    const { paragraphs } = answer;
    if (!paragraphs.length) return { ...fallback, text: '', citations: [], issue: 'insufficient' };
    if (paragraphs.length > 8 || !paragraphs.every(p => checkedParagraph(p, sources))) return { ...fallback, issue: 'unverified' };
    return { ...fallback, ...composeAnswer(fallback.id, paragraphs, sources) };
  } catch (error) {
    signal?.throwIfAborted();
    return { ...fallback, issue: providerIssue(error) };
  }
}
