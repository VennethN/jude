<script lang="ts">
 import { isGuestPractice, guestPracticeMinutes } from '@jude/core/domain';
 import { connectStartedHearing } from './hearing-detail/active-recording.svelte';
 import { prepareMicrophone, type PreparedMicrophone } from './microphone-input';
 import { goto } from '$app/navigation';
 import { page } from '$app/state';
 import { onDestroy } from 'svelte';
 import { CalendarDays, ChevronRight, FileAudio, FileUp, Mic } from '@lucide/svelte';
 import type { Hearing, Lang, SessionInfo, Workspace } from '@jude/core/domain';
 import { api, ApiError } from '$lib/client';
 import { canStartHearing } from './hearing-access';
 import PracticePrompt from './hearing-detail/PracticePrompt.svelte';
 import Dialog from './Dialog.svelte';
 import SheetHandle from './SheetHandle.svelte';
 import { timecode } from './format';
 import { guardUnsavedChanges } from './unsaved-changes';
 type Flow='schedule'|'import'|'live'|'audio';
 let {workspace:w,lang,close,initial='',scheduled,transcription,account}:{workspace:Workspace;lang:Lang;close:()=>void;initial?:string;scheduled?:Hearing;transcription:boolean;account:SessionInfo}=$props();
 const en=$derived(lang==='en'), demo=$derived(w.caseRecord.label==='synthetic'), prefix=$derived('/api/cases/'+w.caseRecord.id+'/hearings');
 let uploadKey = '';
 let keep = $state(false);
 let active = true;
 let pendingInput: PreparedMicrophone | undefined;
 let previewRequest: AbortController | undefined;
 let previewing=$state(false),submitting=$state(false);
 const busy=$derived(previewing||submitting);
 let flow=$state<Flow|''>(''),title=$state(''),date=$state(''),time=$state('09:00'),message=$state(''),file=$state<File>(),draft=$state<{speaker:string;time:number;text:string}[]>([]),language=$state('id');
 let recordingConsent=$state<'closed'|'permitted'|''>('');
 let importBaseline=$state('');
 const importSnapshot=()=>JSON.stringify({title,date,turns:draft});
 const confirmDiscard=guardUnsavedChanges(
   ()=>active&&!submitting&&flow==='import'&&!!importBaseline&&importSnapshot()!==importBaseline,
   ()=>en?'Your transcript edits have not been imported. Discard them and continue?':'Perubahan transkrip belum diimpor. Buang perubahan dan lanjutkan?'
 );
 const closed=$derived(recordingConsent==='closed'),permission=$derived(recordingConsent==='permitted');
 const practiceTitle=$derived(en?'East Gate testimony practice':'Latihan kesaksian Gerbang Timur');
 $effect(()=>{
   const requested=scheduled?'live':['live','schedule','import','audio'].includes(initial)?initial as Flow:'';
   flow=requested;
   if(isGuestPractice(account,w.caseRecord))language=lang;
   title=scheduled?.title[lang]??(requested==='live' && isGuestPractice(account,w.caseRecord) ? practiceTitle : '');
   date=scheduled?.date??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
 });
 const otherLive=$derived(w.hearings.find(item=>item.mode==='live' && item.id!==scheduled?.id));
 const guest=$derived(account.user.guest), livePlan=$derived(account.plan.id!=='basic'), practice=$derived(isGuestPractice(account,w.caseRecord));
 const privateAudio = $derived(!demo && !guest && transcription);
 const canRecord = $derived(canStartHearing(account,w.caseRecord,transcription));
 const serviceHint = $derived(en ? 'The voice service has not enabled transcription.' : 'Transkripsi belum aktif pada layanan suara.');
 const signInHint = $derived(en ? 'Sign in to use audio in a private case.' : 'Masuk untuk menggunakan audio dalam perkara privat.');
 const recordHint = $derived(demo ? (en ? 'Replay the example hearing.' : 'Putar ulang sidang contoh.')
   : practice ? (!transcription ? serviceHint : (en ? `${guestPracticeMinutes} minutes of live audio across your guest hearings.` : `${guestPracticeMinutes} menit audio langsung untuk seluruh sidang latihan Anda.`))
   : guest ? signInHint : !livePlan ? (en ? 'Live recording requires Advocate Pro or higher.' : 'Rekam langsung tersedia mulai paket Advokat Pro.')
   : !transcription ? serviceHint : (en ? 'Transcribe an open hearing with permission.' : 'Transkripsikan sidang terbuka dengan izin.'));
 const uploadHint = $derived(demo || guest ? signInHint : !transcription ? serviceHint
   : (en ? 'Transcribe a saved recording.' : 'Transkripsikan rekaman yang tersimpan.'));
 const choices = $derived([
   { id: 'live' as const, icon: Mic, title: practice ? (en ? 'Practice live testimony' : 'Latihan kesaksian langsung') : (en ? 'Record live' : 'Rekam langsung'), hint: recordHint, disabled: !canRecord },
   { id: 'audio' as const, icon: FileAudio, title: en ? 'Upload audio' : 'Unggah audio', hint: uploadHint, disabled: !privateAudio },
   { id: 'import' as const, icon: FileUp, title: en ? 'Import transcript' : 'Impor transkrip', hint: en ? 'Review speaker turns before filing.' : 'Periksa giliran pembicara sebelum disimpan.', disabled: false },
   { id: 'schedule' as const, icon: CalendarDays, title: en ? 'Schedule hearing' : 'Jadwalkan sidang', hint: en ? 'Set a hearing date and time.' : 'Tetapkan tanggal dan waktu sidang.', disabled: false }
 ]);
 function fail(e:unknown){message=e instanceof ApiError && e.code==='guest_live_limit' ? (en?`Your ${guestPracticeMinutes} minutes of practice audio have been used. You can still review the transcript and findings.`:`Jatah ${guestPracticeMinutes} menit audio latihan Anda sudah terpakai. Transkrip dan temuan tetap dapat ditinjau.`) : e instanceof Error?e.message:(en?'Could not complete this action.':'Tindakan belum selesai.')}
 function cancelPreview() {
   previewRequest?.abort();
   previewRequest=undefined;
   previewing=false;
 }
 function retire() {
   active=false;
   cancelPreview();
   pendingInput?.release();
   pendingInput=undefined;
 }
 function dismiss() {
   if(!confirmDiscard())return;
   retire();
   close();
 }
 function back() {
   if(!confirmDiscard())return;
   cancelPreview();
   flow='';draft=[];file=undefined;message='';importBaseline='';
 }
 onDestroy(retire);
 async function preview(f?:File,input?:HTMLInputElement) {
   if(submitting)return;
   if(!confirmDiscard()){
     if(input){const previous=new DataTransfer();if(file)previous.items.add(file);input.files=previous.files}
     return;
   }
   cancelPreview();
   file=f;uploadKey=f?crypto.randomUUID():'';message='';
   if(flow!=='import')return;
   // A preview belongs only to its selected file, including when its replacement fails.
   draft=[];title='';importBaseline='';
   if(!f)return;
   const request=new AbortController();
   previewRequest=request;previewing=true;
   const body=new FormData();body.append('file',f);
   try {
     const r=await api<{title:string;date:string;turns:typeof draft}>(prefix+'/import/preview','POST',body,undefined,request.signal);
     if(!active||previewRequest!==request)return;
     draft=r.turns;title=r.title;date=r.date;
     importBaseline=importSnapshot();
   } catch(e) {
     if(active&&previewRequest===request&&!request.signal.aborted)fail(e);
   } finally {
     if(previewRequest===request){previewRequest=undefined;previewing=false}
   }
 }
 async function submit(e:SubmitEvent){
   e.preventDefault();
   if(busy||!flow||flow==='import'&&!draft.length)return;
   submitting=true;
   message='';
   const originPath=page.url.pathname,caseId=w.caseRecord.id;
   const useMicrophone=flow==='live' && !demo && canRecord && permission && !closed && !otherLive;
   const input=useMicrophone ? prepareMicrophone() : undefined;
   pendingInput=input;
   let handedOff=false;
   try{let h:Hearing;
   if(flow==='audio'){const form=new FormData();form.set('file',file!);form.set('title',title);form.set('date',date);form.set('lang',language);form.set('recordingPermission',String(permission&&!closed));h=await api<Hearing>('/api/live/'+w.caseRecord.id+'/upload','POST',form,{'Idempotency-Key':uploadKey})}
   else {const body={title,date,time,flow,language,recordingPermission:permission,closed,turns:flow==='import'?draft:undefined};h=await api<Hearing>(scheduled?prefix+'/'+scheduled.id+'/start':prefix+(flow==='import'?'/import':''),'POST',body)}
   // A retired form must not interrupt a newer navigation by refreshing its
   // previous route while the destination is still loading.
   if(!active||page.url.pathname!==originPath)return;
   const autoConnect=h.mode==='live' && h.recordingPermission?.by===account.user.id;
   const destination='/case/'+caseId+'/hearings/'+h.id;
   const userId=account.user.id, guestSession=guest, retain=!guestSession && keep;
   pendingInput=undefined;
   dismiss();await goto(destination,{invalidateAll:true});
   if(input && autoConnect && location.pathname===destination){
     handedOff=true;
     connectStartedHearing(caseId,h.id,userId,retain,h.startedAt,h.language,guestSession,input);
   }
 }catch(e){if(active)fail(e)}finally{
   if(!handedOff)input?.release();
   pendingInput=undefined;
   submitting=false;
 }}
</script>
<Dialog title={flow?choices.find(x=>x.id===flow)!.title:(en?'New hearing':'Sidang baru')} {lang} close={dismiss} wide={flow==='import'&&draft.length>0}>
<div class="hearing-intake" class:choosing={!flow}>
  <SheetHandle dismiss={dismiss}/>
{#if !flow}<p class="lead">{en?'Choose how testimony comes into the case.':'Pilih cara keterangan masuk ke perkara.'}</p><div class="flow-choices">{#each choices as c}<button disabled={c.disabled} onclick={()=>{flow=c.id;message='';if(practice&&c.id==='live'&&!title)title=practiceTitle}}><span class="choice-icon" class:live={c.id==='live'}><c.icon size={20}/></span><span class="choice-text"><strong>{c.title}</strong><small>{c.hint}</small></span><ChevronRight size={15} class="choice-arrow" aria-hidden="true"/></button>{/each}</div>{#if !guest && !demo && !livePlan}<p class="small muted"><a href="/billing">{en ? 'View plans and billing' : 'Lihat paket dan tagihan'}</a></p>{/if}<div class="choice-foot"><button class="button" onclick={dismiss}>{en?'Cancel':'Batal'}</button></div>
{:else}<form class="stack" onsubmit={submit}>
 {#if flow==='live' && !canRecord}<p class="small muted">{recordHint}</p>{:else if flow==='audio' && !privateAudio}<p class="small muted">{uploadHint}</p>{/if}
 {#if flow==='live' && practice}<PracticePrompt workspace={w} {account} {lang}/><p class="small muted">{en ? `Your guest workspace includes ${guestPracticeMinutes} minutes of live audio in total. Your testimony is saved as text.` : `Ruang kerja tamu mencakup total ${guestPracticeMinutes} menit audio langsung. Kesaksian Anda disimpan sebagai teks.`}</p>{/if}
 {#if flow==='live' && otherLive}<p class="existing-live">{en?'Another hearing is already in progress.':'Sidang lain sedang berlangsung.'} <a href={'/case/'+w.caseRecord.id+'/hearings/'+otherLive.id}>{en?'Return to hearing':'Kembali ke sidang'} {otherLive.number}</a></p>{/if}
 {#if flow==='import'||flow==='audio'}<label class="field">{flow==='import'?(en?'Transcript file':'Berkas transkrip'):(en?'Audio file, up to 25 MB':'Berkas audio, hingga 25 MB')}<input type="file" disabled={submitting} accept={flow==='import'?'.txt,.vtt,.srt,.json,.csv,.docx,.pdf,.jude':'.wav,.m4a,.mp3,.mp4,.webm,.mpeg'} onchange={e=>preview(e.currentTarget.files?.[0],e.currentTarget)}/></label>{/if}
 {#if flow==='import'&&demo&&!draft.length}<button type="button" class="button" onclick={()=>preview(new File(['[00:00:00] Hakim Ketua: Sidang dibuka.\n[00:00:08] Saksi: Saya tiba di Gerbang Timur.'],'Risalah contoh.txt',{type:'text/plain'}))}>{en?'Use sample transcript':'Pakai contoh risalah'}</button>{/if}
 {#if flow!=='import'||draft.length}<label class="field">{en?'Hearing title':'Judul sidang'}<input disabled={submitting} required maxlength="160" bind:value={title}/></label>
 <div class="dates"><label class="field">{en?'Date':'Tanggal'}<input type="date" disabled={submitting} required bind:value={date}/></label>{#if flow==='schedule'}<label class="field">{en?'Time (WIB)':'Waktu (WIB)'}<input type="time" disabled={submitting} required bind:value={time}/></label>{/if}</div>{/if}
 {#if flow==='import'&&draft.length}<p>{en?'Check the speakers and wording before importing.':'Periksa pembicara dan teks sebelum mengimpor.'}</p><div class="turns">{#each draft as turn,i}<div><small>{timecode(turn.time)}</small><input disabled={submitting} class="text-input" aria-label={(en?'Speaker ':'Pembicara ')+(i+1)} bind:value={turn.speaker}/><textarea disabled={submitting} class="text-input" aria-label={(en?'Testimony ':'Keterangan ')+(i+1)} bind:value={turn.text}></textarea></div>{/each}</div>{/if}
 {#if flow==='audio'||flow==='live'}<label class="field">{en?'Recognition language':'Bahasa pengenalan'}<select disabled={submitting} bind:value={language}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></label>{/if}
 {#if flow==='live'||flow==='audio'}{#if demo&&flow==='live'}<p class="small muted">{en?'This synthetic hearing replays example testimony.':'Sidang sintetis ini memutar ulang contoh kesaksian.'}</p>{/if}
 <label><input disabled={submitting} type="checkbox" checked={closed} onchange={e=>recordingConsent=e.currentTarget.checked?'closed':''}/> {en?'Closed hearing':'Sidang tertutup'}</label>
 <label><input disabled={submitting} type="checkbox" required checked={permission} onchange={e=>recordingConsent=e.currentTarget.checked?'permitted':''}/> {practice && flow==='live' ? (en?'I agree to send my voice for this practice. If I am in a real hearing, it is open and the presiding judge permitted recording.':'Saya setuju mengirim suara saya untuk latihan ini. Jika saya berada di sidang nyata, sidang terbuka dan hakim ketua mengizinkan perekaman.') : (en?'The presiding judge permitted recording in this open hearing.':'Hakim ketua mengizinkan perekaman dalam sidang terbuka ini.')}</label>
 {#if closed}<p class="small muted" role="status">{en?'Recording is unavailable for closed hearings.':'Perekaman tidak tersedia untuk sidang tertutup.'}</p>{/if}{/if}
 {#if flow==='live' && privateAudio}<label><input disabled={submitting} type="checkbox" bind:checked={keep}/> {en?'Also retain the audio recording in this case.':'Simpan juga rekaman audio dalam perkara ini.'}</label>{/if}
 {#if message}<p class="error-text" role="alert">{message}</p>{/if}
 <div class="actions"><button type="submit" class="button primary" disabled={busy||flow==='import'&&!draft.length||flow==='audio'&&(!privateAudio||!file||!permission||closed)||flow==='live'&&(!canRecord||!!otherLive||!permission||closed)}>{busy?(en?'Processing…':'Memproses…'):flow==='schedule'?(en?'Schedule hearing':'Jadwalkan sidang'):flow==='import'?(en?'Confirm and import':'Konfirmasi dan impor'):flow==='audio'?(en?'Transcribe audio':'Transkripsikan audio'):(en?'Start hearing':'Mulai sidang')}</button>
 {#if !scheduled}<button class="button subtle" type="button" disabled={submitting} onclick={back}>{en?'Back':'Kembali'}</button>{/if}</div>
 </form>{/if}</div></Dialog>
<style>
  :global(dialog:has(.hearing-intake)) { width:min(620px,calc(100% - 32px)); padding:22px; border-radius:14px; }
  :global(dialog:has(.hearing-intake) .dialog-head) { align-items:center; margin-bottom:15px; }
  :global(dialog:has(.hearing-intake) .dialog-head h2) { font:400 26px/1.2 var(--display); }
  :global(dialog.wide:has(.hearing-intake)) { width:min(710px,calc(100% - 32px)); }
  .hearing-intake { min-width:0; }
  .lead { margin:0 0 15px; color:var(--muted); font:400 14px/1.55 var(--sans); }
  .flow-choices { display:grid; gap:8px; }
  .flow-choices button { display:flex; align-items:center; gap:14px; min-height:70px; padding:13px 14px; text-align:left; border:1px solid var(--line-strong,var(--line)); border-radius:8px; background:var(--surface); color:var(--ink-strong,var(--ink)); }
  .flow-choices button:hover:not(:disabled) { border-color:var(--ink-strong,var(--ink)); background:var(--surface-2,var(--wash)); }
  .flow-choices button:disabled { cursor:not-allowed; }
  .flow-choices button:disabled strong,.flow-choices button:disabled :global(.choice-arrow) { color:var(--muted); }
  .flow-choices button:disabled .choice-icon { opacity:.64; }
  .choice-icon { display:grid; flex:none; place-items:center; width:40px; height:40px; background:var(--selected,var(--wash)); border-radius:50%; }
  .choice-icon.live { background:var(--st-inconsistency-bg,var(--wash)); color:var(--alert,var(--accent)); }
  .choice-text { display:grid; gap:2px; }
  .choice-text strong { font:600 14px/1.5 var(--sans); }
  .choice-text small { color:var(--muted); font:400 12.5px/1.45 var(--sans); }
  .flow-choices :global(.choice-arrow) { margin-left:auto; flex:none; color:var(--muted); }
  .choice-foot { display:flex; justify-content:flex-end; margin-top:16px; }
  .hearing-intake .small { margin:12px 0 0; }
  .dates { display:flex; gap:12px; }
  .dates label { flex:1; }
  .turns { overflow:auto; max-height:260px; display:grid; gap:12px; }
  .turns>div { display:grid; grid-template-columns:auto 1fr 2fr; align-items:center; gap:8px; }
  .existing-live { margin:0; padding:10px 12px; background:var(--selected,var(--wash)); border-radius:7px; font-size:13px; }
  .existing-live a { font-weight:600; }
  @media(max-width:719px) {
    :global(dialog:has(.hearing-intake)),:global(dialog.wide:has(.hearing-intake)) { width:100%; max-width:100%; max-height:calc(100dvh - 10px); padding:26px 16px max(16px,env(safe-area-inset-bottom)); margin:auto 0 0; border-radius:18px 18px 0 0; }
    .flow-choices button { min-height:76px; }
    .turns>div { grid-template-columns:1fr; }
    .dates { flex-wrap:wrap; }
  }
</style>
