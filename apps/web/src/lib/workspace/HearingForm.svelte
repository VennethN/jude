<script lang="ts">
 import { goto, invalidateAll } from '$app/navigation';
 import { CalendarDays, ChevronRight, FileAudio, FileUp, Mic } from '@lucide/svelte';
 import type { Hearing, Lang, Workspace } from '@jude/core/domain';
 import { api } from '$lib/client';
 import Dialog from './Dialog.svelte';
 import SheetHandle from './SheetHandle.svelte';
 import { timecode } from './format';
 type Flow='schedule'|'import'|'live'|'audio';
 let {workspace:w,lang,close,initial='',scheduled,transcription,guest=false}:{workspace:Workspace;lang:Lang;close:()=>void;initial?:string;scheduled?:Hearing;transcription:boolean;guest?:boolean}=$props();
 const en=$derived(lang==='en'), demo=$derived(w.caseRecord.label==='synthetic'), prefix=$derived('/api/cases/'+w.caseRecord.id+'/hearings');
 let uploadKey = '';
 let flow=$state<Flow|''>(''),title=$state(''),date=$state(''),time=$state('09:00'),permission=$state(false),closed=$state(false),busy=$state(false),message=$state(''),file=$state<File>(),draft=$state<{speaker:string;time:number;text:string}[]>([]),language=$state('id');
 $effect(()=>{flow=scheduled?'live':['live','schedule','import','audio'].includes(initial)?initial as Flow:'';title=scheduled?.title[lang]??'';date=scheduled?.date??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date())});
 const otherLive=$derived(w.hearings.find(item=>item.mode==='live' && item.id!==scheduled?.id));
 const choices=$derived([{id:'live' as const,icon:Mic,title:en?'Record live':'Rekam langsung',hint:en?'Transcribe an open hearing with permission.':'Transkripsikan sidang terbuka dengan izin.'},{id:'audio' as const,icon:FileAudio,title:en?'Upload audio':'Unggah audio',hint:en?'Transcribe a saved recording.':'Transkripsikan rekaman yang tersimpan.'},{id:'import' as const,icon:FileUp,title:en?'Import transcript':'Impor transkrip',hint:en?'Review speaker turns before filing.':'Periksa giliran pembicara sebelum disimpan.'},{id:'schedule' as const,icon:CalendarDays,title:en?'Schedule hearing':'Jadwalkan sidang',hint:en?'Set a hearing date and time.':'Tetapkan tanggal dan waktu sidang.'}]);
 function fail(e:unknown){message=e instanceof Error?e.message:(en?'Could not complete this action.':'Tindakan belum selesai.')}
 async function preview(f?:File){if(!f)return;file=f;uploadKey=crypto.randomUUID();if(flow!=='import')return;const body=new FormData();body.append('file',f);busy=true;message='';try{const r=await api<{title:string;date:string;turns:typeof draft}>(prefix+'/import/preview','POST',body);draft=r.turns;title=r.title;date=r.date}catch(e){fail(e)}finally{busy=false}}
 async function submit(e:SubmitEvent){e.preventDefault();if(busy)return;busy=true;message='';try{let h:Hearing;
   if(flow==='audio'){const form=new FormData();form.set('file',file!);form.set('title',title);form.set('date',date);form.set('lang',language);form.set('recordingPermission',String(permission&&!closed));h=await api<Hearing>('/api/live/'+w.caseRecord.id+'/upload','POST',form,{'Idempotency-Key':uploadKey})}
   else {const body={title,date,time,flow,language,recordingPermission:permission,closed,turns:flow==='import'?draft:undefined};h=await api<Hearing>(scheduled?prefix+'/'+scheduled.id+'/start':prefix+(flow==='import'?'/import':''),'POST',body)}
   close();await invalidateAll();await goto('/case/'+w.caseRecord.id+'/hearings/'+h.id);
 }catch(e){fail(e)}finally{busy=false}}
</script>
<Dialog title={flow?choices.find(x=>x.id===flow)!.title:(en?'New hearing':'Sidang baru')} {lang} {close} wide={flow==='import'&&draft.length>0}>
<div class="hearing-intake" class:choosing={!flow}>
  <SheetHandle dismiss={close}/>
{#if !flow}<p class="lead">{en?'Choose how testimony comes into the case.':'Pilih cara keterangan masuk ke perkara.'}</p><div class="flow-choices">{#each choices as c}<button disabled={c.id==='live'&&!demo&&(!transcription||guest)||c.id==='audio'&&(!transcription||guest||demo)} onclick={()=>{flow=c.id;message=''}}><span class="choice-icon" class:live={c.id==='live'}><c.icon size={20}/></span><span class="choice-text"><strong>{c.title}</strong><small>{c.hint}</small></span><ChevronRight size={15} class="choice-arrow" aria-hidden="true"/></button>{/each}</div>{#if !transcription||guest}<p class="small muted">{en?'Private audio transcription requires a configured account. Transcript import is available.':'Transkripsi audio pribadi memerlukan akun terkonfigurasi. Impor transkrip tersedia.'}</p>{/if}<div class="choice-foot"><button class="button" onclick={close}>{en?'Cancel':'Batal'}</button></div>
{:else}<form class="stack" onsubmit={submit}>
 {#if flow==='live' && otherLive}<p class="existing-live">{en?'Another hearing is already in progress.':'Sidang lain sedang berlangsung.'} <a href={'/case/'+w.caseRecord.id+'/hearings/'+otherLive.id}>{en?'Return to hearing':'Kembali ke sidang'} {otherLive.number}</a></p>{/if}
 {#if flow==='import'||flow==='audio'}<label class="field">{flow==='import'?(en?'Transcript file':'Berkas transkrip'):(en?'Audio file, up to 25 MB':'Berkas audio, hingga 25 MB')}<input type="file" accept={flow==='import'?'.txt,.vtt,.srt,.json,.csv,.docx,.pdf,.jude':'.wav,.m4a,.mp3,.mp4,.webm,.mpeg'} onchange={e=>preview(e.currentTarget.files?.[0])}/></label>{/if}
 {#if flow==='import'&&demo&&!draft.length}<button type="button" class="button" onclick={()=>preview(new File(['[00:00:00] Hakim Ketua: Sidang dibuka.\n[00:00:08] Saksi: Saya tiba di Gerbang Timur.'],'Risalah contoh.txt',{type:'text/plain'}))}>{en?'Use sample transcript':'Pakai contoh risalah'}</button>{/if}
 {#if flow!=='import'||draft.length}<label class="field">{en?'Hearing title':'Judul sidang'}<input required maxlength="160" bind:value={title}/></label>
 <div class="dates"><label class="field">{en?'Date':'Tanggal'}<input type="date" required bind:value={date}/></label>{#if flow==='schedule'}<label class="field">{en?'Time (WIB)':'Waktu (WIB)'}<input type="time" required bind:value={time}/></label>{/if}</div>{/if}
 {#if flow==='import'&&draft.length}<p>{en?'Check the speakers and wording before importing.':'Periksa pembicara dan teks sebelum mengimpor.'}</p><div class="turns">{#each draft as turn,i}<div><small>{timecode(turn.time)}</small><input class="text-input" aria-label={(en?'Speaker ':'Pembicara ')+(i+1)} bind:value={turn.speaker}/><textarea class="text-input" aria-label={(en?'Testimony ':'Keterangan ')+(i+1)} bind:value={turn.text}></textarea></div>{/each}</div>{/if}
 {#if flow==='audio'||flow==='live'}<label class="field">{en?'Recognition language':'Bahasa pengenalan'}<select bind:value={language}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></label>{/if}
 {#if flow==='live'||flow==='audio'}{#if demo&&flow==='live'}<p class="small muted">{en?'This synthetic hearing replays example testimony.':'Sidang sintetis ini memutar ulang contoh kesaksian.'}</p>{/if}
 <label><input type="checkbox" bind:checked={closed}/> {en?'Closed hearing':'Sidang tertutup'}</label>
 <label><input type="checkbox" required bind:checked={permission}/> {en?'The presiding judge permitted recording in this open hearing.':'Hakim ketua mengizinkan perekaman dalam sidang terbuka ini.'}</label>{/if}
 {#if message}<p class="error-text" role="alert">{message}</p>{/if}
 <div class="actions"><button type="submit" class="button primary" disabled={busy||flow==='import'&&!draft.length||flow==='audio'&&(!file||!permission||closed)||flow==='live'&&(!!otherLive||!permission||closed||(!demo&&(!transcription||guest)))}>{busy?(en?'Processing…':'Memproses…'):flow==='schedule'?(en?'Schedule hearing':'Jadwalkan sidang'):flow==='import'?(en?'Confirm and import':'Konfirmasi dan impor'):flow==='audio'?(en?'Transcribe audio':'Transkripsikan audio'):(en?'Start hearing':'Mulai sidang')}</button>
 {#if !scheduled}<button class="button subtle" type="button" onclick={()=>{flow='';draft=[];file=undefined;message=''}}>{en?'Back':'Kembali'}</button>{/if}</div>
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
  .flow-choices button:disabled { opacity:.56; }
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
