import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { CaseRecord, Hearing, SessionInfo, Statement, Workspace } from '../src/domain';
import practice from '../src/guest-practice.json';
import { mutateWorkspace } from '../src/server/cases';
import { transaction } from '../src/server/db';
import { runAnalysisWorker } from '../src/server/jobs';
import * as provider from '../src/server/providers/openai';
import * as voice from '../src/server/voice-capabilities';
import { browser } from './api-client';
import { useIsolatedDatabase } from './isolated-db';

useIsolatedDatabase('guest_hearing');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test('a consenting guest can start the practice hearing and a verified new finding cites its imported exhibit', async () => {
  vi.stubEnv('OPENAI_API_KEY','test-only');
  vi.stubEnv('JUDE_PASAL_TOKEN','');
  vi.stubEnv('JUDE_SEMANTIC_SEARCH','false');
  vi.spyOn(voice,'transcriptionAvailable').mockResolvedValue(true);
  const noNetwork=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected network call'));
  const api=browser(), session=await api.ok<SessionInfo>('auth/demo','POST');
  const {caseId,refs}=session.demo!, base='cases/'+caseId, org=session.organization.id;
  const start=base+'/hearings/'+refs.h4+'/start';
  const consent = await api.request(start,'POST',{recordingPermission:false});
  expect(consent.status).toBe(422);
  expect((await consent.json()).error.code).toBe('recording_permission');
  const h=await api.ok<Hearing>(start,'POST',{recordingPermission:true,language:'en'});
  expect(h).toMatchObject({id:refs.h4,mode:'live',recordingPermission:{by:session.user.id,text:'I consent to have my voice transcribed for this practice hearing.'}});
  const other=await api.ok<CaseRecord>('cases','POST',{title:'Separate authorized workspace'});
  const settings = {flow:'live',title:'New hearing',date:'2026-11-08',recordingPermission:true};
  const denied=await api.request('cases/'+other.id+'/hearings','POST',settings);
  expect(denied.status).toBe(403);
  expect((await denied.json()).error.code).toBe('guest_live_unavailable');
  const outsider=browser();
  await outsider.ok('auth/demo','POST');
  expect((await outsider.request(start,'POST',{recordingPermission:true})).status).toBe(404);

  const workspace=()=>api.ok<Workspace>(base+'/workspace');
  const initial=await workspace();
  const source=initial.passages.find(p=>p.id===refs.d8p2)!;
  const line:Statement={id:randomUUID(),hearingId:h.id,speakerId:refs.rina,t:2,phase:'queued',
    text:'I am Rina Hartati. On 14 March 2026, I first entered Warehouse B through the East Gate at 21:30 WIB.'};
  const match='20:07:41 WIB';
  const copy={id:'Bandingkan waktu masuk di Gerbang Timur.',en:'Compare East Gate entry times.'};
  const calls:string[]=[];
  vi.spyOn(provider,'structured').mockImplementation(async (task,_instructions,raw)=>{
    calls.push(task);
    if(task==='review') return {accept:true};
    const input=raw as {line:string;sources:{id:string;text:string}[]};
    if(task!=='analysis'||input.line!==line.text) throw new Error('Unexpected model input');
    expect(input.sources).toContainEqual(expect.objectContaining({id:source.id,text:expect.stringContaining(match)}));
    return {checkable:true,status:'potential_inconsistency',said:'at 21:30 WIB',title:copy,explanation:copy,verify:copy,uncertainty:copy,
      question:'What did the officer observe at 20:07:41?',sources:[{passageId:source.id,relation:'conflicts',match}]};
  });
  // The voice transport persists a final transcript in exactly this queued state.
  await mutateWorkspace(org,caseId,w=>{w.statements.push(line);});
  const stop=runAnalysisWorker();
  try {
    await expect.poll(async()=>(await workspace()).findings.find(f=>f.statementId===line.id),{timeout:6500,interval:60})
      .toMatchObject({hearingId:h.id,status:'potential_inconsistency',sources:[{passageId:source.id,relation:'conflicts',match}]});
    const state=await workspace();
    expect(state.findings).toHaveLength(initial.findings.length+1);
    expect(state.statements.find(s=>s.id===line.id)?.phase).toBe('complete');
    expect(calls).toEqual(['analysis','review']);
  } finally {stop();}
  expect(noNetwork).not.toHaveBeenCalled();

  await api.ok(base+'/hearings/'+h.id+'/end','POST',{});
  const exhausted=practice.liveMinutes*60*24000*2;
  await transaction(db=>db.query('INSERT INTO usage_counts(org_id,period,quota,amount) VALUES($1,$2,$3,$4)',[org,'lifetime',practice.usageKey,exhausted]));
  const limited=await api.request(base+'/hearings','POST',settings);
  expect(limited.status).toBe(402);
  expect((await limited.json()).error.code).toBe('guest_live_limit');
  expect((await workspace()).hearings.filter(item=>item.mode==='live')).toEqual([]);
});
