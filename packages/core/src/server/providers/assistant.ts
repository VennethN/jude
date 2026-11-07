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
export function contextKeys(w:Workspace, refs:ContextRef[]) {
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
export function caseSources(w: Workspace, lang: Lang): Source[] {
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
  'Use plain prose for short answers. When a longer answer benefits from structure, use concise Markdown headings in the requested language, selective bold or italic emphasis, and short bulleted or numbered lists.',
  'Place a heading on its own line at the start of a summary that also contains supported prose. Give each distinct list item its own cited summary. Do not include Markdown links or HTML.',
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

export interface AnswerOptions {
  history?: ChatMessage[];
  signal?: AbortSignal;
  progress?: (stage: AssistantStage) => void;
  /** The legal research flow has already selected the in-scope case exhibits and testimony. */
  legalEvidence?: Source[];
}
function selectedHistory(w: Workspace, contexts: ContextRef[], history: ChatMessage[]) {
  const recent = history.slice(-8);
  if (!contexts.length || contexts.some(ref => ref.kind === 'case')) return recent;
  const selected = contextKeys(w, contexts);
  if (contexts.some(ref => ref.kind === 'documents')) {
    selected.add('documents');
    for (const doc of w.documents) selected.add(key({ kind: 'document', id: doc.id }));
  }
  let includeTurn = false;
  return recent.filter(message => {
    if (message.role === 'user') {
      includeTurn = !!message.contexts?.length && message.contexts.every(ref => {
        if (ref.kind === 'case') return false;
        if (ref.kind === 'documents') return selected.has('documents');
        return !ref.unavailable && selected.has(key(ref));
      });
      return includeTurn;
    }
    return includeTurn && (message.citations ?? []).every(c => !c.unavailable && selected.has(key(c)));
  });
}
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
  const previous = selectedHistory(w, contexts, options.history ?? []);
  const history = previous.map(m => ({ role: m.role, text: (typeof m.text === 'string' ? m.text : m.text[lang]).slice(0, 1500) }));
  const query = conversationQuery(question, previous, lang);
  let retrieval: ChatMessage['retrieval'] = 'lexical';
  const overview = !options.legalEvidence && isCaseSummary(question, contexts) ? summaryEvidence(w, caseSources(w, lang), lang) : undefined;
  const sources = options.legalEvidence ?? overview?.sources ?? await retrieve(w, query, contexts, lang, allowModel ? orgId : undefined, { signal, minimumScore: 0, status: value => { retrieval = value; } });
  const first = sources.slice(0, 5);
  const fallback: ChatMessage = {
    id: randomUUID(), role: 'assistant', mode: 'sources-only',
    text: first.map((s, i) => '“' + s.text + '” [' + (i + 1) + ']').join('\n\n'),
    citations: first.map(({kind, id}) => ({kind, id})),
  };
  if (!overview && !options.legalEvidence && w.caseRecord.label === 'private') fallback.retrieval = retrieval;
  if (!allowModel || w.caseRecord.label === 'synthetic') return fallback;
  if (!process.env.OPENAI_API_KEY) return { ...fallback, issue: 'not_configured' };
  if (!sources.length) return { ...fallback, issue: 'insufficient' };
  const verified = (value: unknown): value is AnswerParagraph => {
    if (!checkedParagraph(value, sources)) return false;
    if (!options.legalEvidence) return true;
    // A model may identify an article named in a quotation. Discovery links are added separately.
    const articles = [...value.summary.matchAll(/\b(?:pasal|articl(?:e|es))\s+(\d{1,4}[a-z]?)\b/gi)];
    return articles.every(([, number]) => value.citations.some(citation =>
      new RegExp('\\b(?:pasal|article)\\s+' + number + '\\b', 'i').test(citation.quote)));
  };
  const partials: AnswerParagraph[] = [];
  let validPrefix = true;
  const acceptDelta = onPartial && readParagraphs(value => {
    if (!validPrefix || partials.length >= 8 || !verified(value)) { validPrefix = false; return; }
    partials.push(value);
    onPartial(composeAnswer(fallback.id, partials, sources));
  }, value => {
    if (validPrefix && partials.length < 8 && verified(value)) {
      onPartial(composeAnswer(fallback.id, [...partials, value], sources, true));
    }
  });
  try {
    progress?.('answering');
    const instructions = [
      'Answer in ' + (lang === 'id' ? 'Indonesian.' : 'English.'),
      overview ? summaryInstructions : 'Answer the specific question directly, within the selected context.',
      ...(options.legalEvidence ? [
        'Explain what the selected case record actually establishes about the legal question in one or two short paragraphs. Attribute any charging provision to the exact document or speaker who named it.',
        'Distinguish the alleged offence, evidence bearing on it and a sentencing factor. A discrepancy by itself does not establish an offence or an aggravating factor. Cite the concrete facts and say which charge or element is still unverified. If needed ask for the indictment or the particular missing evidence, rather than asking the user to name a topic already in the record.',
        'Use only the supplied exhibits and testimony. Do not introduce article numbers, legal rules, penalties or conclusions from memory. An independent section will give public research links.',
      ] : []),
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
    if (paragraphs.length > 8 || !paragraphs.every(verified)) return { ...fallback, issue: 'unverified' };
    return { ...fallback, ...composeAnswer(fallback.id, paragraphs, sources) };
  } catch (error) {
    signal?.throwIfAborted();
    return { ...fallback, issue: providerIssue(error) };
  }
}
