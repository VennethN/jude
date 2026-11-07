import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Client } from 'pg';
import type { CaseRecord, SessionInfo, Thread, Workspace } from '../src/domain';
import { mutateWorkspace } from '../src/server/cases';
import { transaction } from '../src/server/db';
import * as model from '../src/server/providers/openai';
import { answerQuestion as answer, conversationQuery, retrieveLexical as retrieve } from '../src/server/providers/assistant';
import { browser } from './api-client';
import { runSemanticIndexBatch } from '../src/server/semantic-index';

const owners = new Map<string, string>();
const answerQuestion = (w: Workspace, question: string, contexts: Parameters<typeof answer>[2], lang: Parameters<typeof answer>[3]) => answer(w, question, contexts, lang, true, owners.get(w.caseRecord.id));

let postgres: Client | undefined;
const schema = 'jude_assistant_test_' + randomUUID().replaceAll('-', '');
beforeAll(async () => {
  if (process.env.JUDE_TEST_DATABASE_URL) {
    postgres = new Client({ connectionString: process.env.JUDE_TEST_DATABASE_URL });
    await postgres.connect();
    await postgres.query('CREATE SCHEMA "' + schema + '"');
    const url = new URL(process.env.JUDE_TEST_DATABASE_URL);
    url.searchParams.set('options', '-c search_path=' + schema);
    process.env.DATABASE_URL = url.href;
  } else { delete process.env.DATABASE_URL; process.env.JUDE_DB_PATH = ':memory:'; }
  delete process.env.OPENAI_API_KEY;
});
afterAll(async () => { if (postgres) { await postgres.query('DROP SCHEMA "' + schema + '" CASCADE'); await postgres.end(); } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture() {
  const client = browser();
  const session = await client.ok<SessionInfo>('auth/signup', 'POST', { name: 'Counsel', email: randomUUID() + '@example.test', password: 'Docket-1234' });
  const c = await client.ok<CaseRecord>('cases', 'POST', { title: 'Assistant regression' });
  const thread = await client.ok<Thread>('cases/' + c.id + '/threads', 'POST', {});
  const doc = randomUUID(), passage = randomUUID();
  await mutateWorkspace(session.organization.id, c.id, w => {
    w.documents.push({ id: doc, caseId: c.id, title: 'Catatan pengiriman', kind: {id:'Catatan',en:'Record'}, pages:1,file:'TXT',size:'1 KB',added:'2026-11-07' });
    w.passages.push({ id: passage, docId: doc, page:1,text:'Sari menyerahkan tiga kotak pada pukul 09.15.' });
  });
  owners.set(c.id, session.organization.id);
  const workspace = async () => {
    if (process.env.DATABASE_URL && process.env.OPENAI_API_KEY) {
      for (let i = 0; i < 100; i++) {
        if (!await runSemanticIndexBatch()) break;
        if (i === 99) throw new Error('Index did not drain');
      }
    }
    return client.ok<Workspace>('cases/' + c.id + '/workspace');
  };
  const path = 'cases/' + c.id + '/threads/' + thread.id + '/messages';
  return { client, session, caseId: c.id, doc, passage, thread, workspace, path };
}

function providers() {
  vi.stubEnv('OPENAI_API_KEY', 'test-only');
  const embedding = vi.fn(async ({ input, dimensions = 512 }: {input:string|string[]; dimensions?:number}) => ({ data: (Array.isArray(input) ? input : [input]).map((text,index) => ({index,embedding:Array.from({length:dimensions},(_,i)=>i=== (/weather|cuaca/i.test(text)?1:0)?1:0)})) }));
  vi.spyOn(model, 'provider').mockReturnValue({ embeddings: { create: embedding } } as unknown as NonNullable<ReturnType<typeof model.provider>>);
  const structured = vi.spyOn(model, 'structured').mockImplementation(async (_task,_instruction,raw) => {
    const input = raw as {sources: {number:number;text:string}[]};
    return {paragraphs:[{summary:'Catatan mencatat '+input.sources[0].text.slice(0,300),citations:[{evidence:1,quote:input.sources[0].text.slice(0,200)}]}]};
  });
  return { embedding, structured };
}

test.skipIf(!!process.env.JUDE_TEST_DATABASE_URL)('SQLite retrieval is case-scoped, caches embeddings and invalidates edited text', async () => {
  const c = await fixture(), p = providers();
  const w = await c.workspace();
  expect(retrieve(w,'Who delivered the containers?',[],'en')).toHaveLength(0);
  const first = await answerQuestion(w,'Who delivered the containers?',[],'en');
  expect(first).toMatchObject({mode:'ai',retrieval:'hybrid',citations:[{kind:'passage',id:c.passage}]});
  expect(first.text).toContain('Sari menyerahkan tiga kotak');
  expect(p.embedding).toHaveBeenCalledTimes(2);
  await answerQuestion(w,'Who delivered the containers?',[],'en');
  expect(p.embedding).toHaveBeenCalledTimes(3); // only the question is re-embedded
  await mutateWorkspace(c.session.organization.id,c.caseId,w=>{w.passages[0].text='Budi menyerahkan dua kotak pada pukul 10.00.';});
  expect((await answerQuestion(await c.workspace(),'Who delivered the containers?',[],'en')).text).toContain('Budi');
  expect(p.embedding).toHaveBeenCalledTimes(5);
  const other = await fixture();
  await answerQuestion(await other.workspace(),'Who delivered the containers?',[],'en');
  expect(p.embedding).toHaveBeenCalledTimes(7); // never reuse another case's cached source
  await mutateWorkspace(c.session.organization.id,c.caseId,w=>{w.passages=[];});
  expect(await transaction(db=>db.query('SELECT * FROM assistant_embeddings WHERE case_id=$1',[c.caseId]))).toHaveLength(0);
});

test('follow-ups receive recent history while a new subject does not inherit its retrieval query', async () => {
  const c = await fixture(), p = providers();
  const send = async (text:string) => { await c.workspace(); return c.client.ok<Thread>(c.path,'POST',{text,withLegal:false}); };
  await send('Berapa kotak yang diserahkan?');
  const followup = await send('Siapa yang menyerahkannya?');
  expect(followup.messages.at(-1)?.mode).toBe('ai');
  const input = p.structured.mock.calls.at(-1)![2] as {history:{role:string;text:string}[]};
  expect(input.history).toHaveLength(2);
  expect(input.history[0].text).toBe('Berapa kotak yang diserahkan?');
  expect(conversationQuery('Siapa yang menyerahkannya?',followup.messages.slice(0,2),'id')).toContain('Berapa kotak');
  expect(conversationQuery('What is the weather tomorrow?',followup.messages,'en')).toBe('What is the weather tomorrow?');
  expect((await send('What is the weather tomorrow?')).messages.at(-1)).toMatchObject({mode:'sources-only',issue:'insufficient',citations:[]});
});

test('selected context excludes other documents from embedding and answering', async () => {
  const c = await fixture(), p = providers(), other = randomUUID();
  await mutateWorkspace(c.session.organization.id,c.caseId,w=>{
    w.documents.push({...w.documents[0],id:other,title:'Excluded record'});
    w.passages.push({...w.passages[0],id:randomUUID(),docId:other,text:'EXCLUDED private record.'});
  });
  await answerQuestion(await c.workspace(),'Who delivered the containers?',[{kind:'document',id:c.doc}],'en');
  if (!process.env.DATABASE_URL) expect(JSON.stringify(p.embedding.mock.calls)).not.toContain('EXCLUDED');
  expect(JSON.stringify(p.structured.mock.calls)).not.toContain('EXCLUDED');
});

test.each(['incomplete','unverified','unavailable'] as const)('provider %s returns a diagnosed, grounded fallback',async issue=>{
  const c = await fixture(), p = providers();
  if(issue==='incomplete')p.structured.mockResolvedValue(null);
  if(issue==='unverified')p.structured.mockResolvedValue({paragraphs:[{summary:'A claim',citations:[{evidence:1,quote:'invented quotation'}]}]});
  if(issue==='unavailable')p.structured.mockRejectedValue(new Error('private provider diagnostic'));
  const answer = await answerQuestion(await c.workspace(),'kotak',[],'id');
  expect(answer).toMatchObject({mode:'sources-only',issue,citations:[{kind:'passage',id:c.passage}]});
  expect(JSON.stringify(answer)).not.toContain('private provider diagnostic');
});

test('stream reports stages, keeps idempotency, and rejects overlong questions',async()=>{
  const c=await fixture();providers();
  const key=randomUUID();
  const data={text:'Siapa yang menyerahkan kotak?',withLegal:false};
  await c.workspace();
  const response=await c.client.request(c.path,'POST',data,key,{accept:'application/x-ndjson'});
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  expect(events.filter(e=>e.type==='status').map(e=>e.phase)).toEqual(['reading','retrieving','answering','saving']);
  expect(events.at(-1).thread.messages).toHaveLength(2);
  expect((await c.client.ok<Thread>(c.path,'POST',data,key)).messages).toHaveLength(2);
  expect((await c.client.request(c.path,'POST',{text:'x'.repeat(6001)})).status).toBe(422);
});

test('cancelled work is not saved or metered',async()=>{
  const c=await fixture(),p=providers(),controller=new AbortController();
  p.structured.mockImplementation(async()=>{controller.abort();throw new DOMException('Aborted','AbortError');});
  await c.workspace();
  const response=await c.client.request(c.path,'POST',{text:'kotak',withLegal:false},undefined,{signal:controller.signal,accept:'application/x-ndjson'});
  await response.text();
  expect(controller.signal.aborted).toBe(true);
  expect((await c.workspace()).threads[0].messages).toHaveLength(0);
  const rows=await transaction(db=>db.query<{amount:number}>('SELECT amount FROM usage_counts WHERE org_id=$1 AND quota=$2',[c.session.organization.id,'questions']));
  expect(rows.reduce((n,row)=>n+Number(row.amount),0)).toBe(0);
});

test('explicit Stop cancels a resumable request before saving', async () => {
  const c = await fixture(), p = providers(), entered = Promise.withResolvers<void>(), key = randomUUID();
  p.structured.mockImplementation(async (_task, _instruction, _input, _schema, _delta, signal) => {
    entered.resolve();
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
  });
  await c.workspace();
  const response = await c.client.request(c.path, 'POST', { text: 'kotak', withLegal: false }, key, 'application/x-ndjson');
  await entered.promise;
  expect(await c.client.ok(c.path.replace(/messages$/, 'cancel'), 'POST', {}, key)).toEqual({ cancelled: true });
  await response.text();
  expect((await c.workspace()).threads[0].messages).toHaveLength(0);
});

test('a source edited during generation cannot become a stale citation',async()=>{
  const c=await fixture(),p=providers();
  p.structured.mockImplementation(async()=>{
    await mutateWorkspace(c.session.organization.id,c.caseId,w=>{w.passages[0].text='Budi membawa satu kotak.';});
    return {paragraphs:[{summary:'Catatan menyebut Sari.',citations:[{evidence:1,quote:'Sari menyerahkan tiga kotak'}]}]};
  });
  await c.workspace();
  expect((await c.client.request(c.path,'POST',{text:'kotak',withLegal:false})).status).toBe(409);
  expect((await c.workspace()).threads[0].messages).toHaveLength(0);
});

test('low positive cross-language similarity remains a candidate, and insufficient evidence produces no spurious citations',async()=>{
  const c=await fixture(),p=providers();
  p.embedding.mockImplementation(async ({input,dimensions=512})=>({data:(Array.isArray(input)?input:[input]).map((text,index)=>({index,embedding:Array.from({length:dimensions},(_,i)=>!/^Who /.test(text)?(i===0?1:0):(i===0?0.2:i===1?Math.sqrt(0.96):0))}))}));
  expect((await answerQuestion(await c.workspace(),'Who delivered the containers?',[],'en')).mode).toBe('ai');
  p.structured.mockResolvedValue({paragraphs:[]});
  const declined=await answerQuestion(await c.workspace(),'Who owns the ship?',[],'en');
  expect(declined).toMatchObject({issue:'insufficient',text:'',citations:[]});
});

test('revoked write access during generation prevents saving the answer',async()=>{
  const c=await fixture(),p=providers();
  p.structured.mockImplementation(async()=>{
    await transaction(db=>db.query('UPDATE case_members SET role=$1 WHERE case_id=$2 AND user_id=$3',['viewer',c.caseId,c.session.user.id]));
    return {paragraphs:[{summary:'Catatan menyebut Sari.',citations:[{evidence:1,quote:'Sari menyerahkan tiga kotak'}]}]};
  });
  await c.workspace();
  expect((await c.client.request(c.path,'POST',{text:'kotak',withLegal:false})).status).toBe(403);
  expect((await c.workspace()).threads[0].messages).toHaveLength(0);
});

test.skipIf(!!process.env.JUDE_TEST_DATABASE_URL)('SQLite indexing budget is explicit and later questions resume missing sources',async()=>{
  const c=await fixture(),p=providers();
  await mutateWorkspace(c.session.organization.id,c.caseId,w=>{
    for(let i=0;i<100;i++)w.passages.push({id:randomUUID(),docId:c.doc,page:1,text:'Sari menyerahkan kotak '+i+'.'});
  });
  const w=await c.workspace();
  expect((await answerQuestion(w,'kotak',[],'id')).retrieval).toBe('partial');
  const first=p.embedding.mock.calls.filter(([arg])=>Array.isArray(arg.input)&&arg.input.every(text=>text.includes('Sari menyerahkan'))).reduce((n,[arg])=>n+(arg.input as string[]).length,0);
  expect(first).toBe(96);
  expect((await answerQuestion(w,'kotak',[],'id')).retrieval).toBe('hybrid');
  const total=p.embedding.mock.calls.filter(([arg])=>Array.isArray(arg.input)&&arg.input.every(text=>text.includes('Sari menyerahkan'))).reduce((n,[arg])=>n+(arg.input as string[]).length,0);
  expect(total).toBe(101);
});

test('the semantic-search switch disables embedding on either database', async () => {
  const c = await fixture(), p = providers();
  vi.stubEnv('JUDE_SEMANTIC_SEARCH', 'false');
  const result = await answerQuestion(await c.workspace(), 'Who delivered the containers?', [], 'en');
  expect(result).toMatchObject({ mode: 'sources-only', retrieval: 'lexical' });
  expect(p.embedding).not.toHaveBeenCalled();
});

test.skipIf(!process.env.JUDE_TEST_DATABASE_URL)('PostgreSQL discloses pending indexing and reuses the background index', async () => {
  const c = await fixture(), p = providers();
  const pending = await c.client.ok<Workspace>('cases/' + c.caseId + '/workspace');
  expect((await answerQuestion(pending, 'Who delivered the containers?', [], 'en')).retrieval).toBe('partial');
  expect(p.embedding).not.toHaveBeenCalled();
  const indexed = await c.workspace();
  const result = await answerQuestion(indexed, 'Who delivered the containers?', [], 'en');
  expect(result).toMatchObject({ mode: 'ai', retrieval: 'hybrid', citations: [{ kind: 'passage', id: c.passage }] });
  expect(await transaction(db => db.query('SELECT * FROM assistant_embeddings WHERE case_id=$1', [c.caseId]))).toHaveLength(0);
});
