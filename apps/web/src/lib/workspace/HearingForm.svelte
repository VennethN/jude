<script lang="ts">
 import { goto, invalidateAll } from '$app/navigation';
 import { CalendarDays, FileUp, Mic, Upload } from '@lucide/svelte';
 import type { Hearing, Lang, Workspace } from '@jude/core/domain';
 import { api } from '$lib/client';
 import Dialog from './Dialog.svelte';
 import { timecode } from './format';
 type Flow='schedule'|'import'|'live'|'audio';
 let {workspace:w,lang,close,initial='',scheduled,transcription,guest=false}:{workspace:Workspace;lang:Lang;close:()=>void;initial?:string;scheduled?:Hearing;transcription:boolean;guest?:boolean}=$props();
 const en=$derived(lang==='en'), demo=$derived(w.caseRecord.label==='synthetic'), prefix=$derived('/api/cases/'+w.caseRecord.id+'/hearings');
 let flow=$state<Flow|''>(''),title=$state(''),date=$state(''),time=$state('09:00'),permission=$state(false),closed=$state(false),busy=$state(false),message=$state(''),file=$state<File>(),draft=$state<{speaker:string;time:number;text:string}[]>([]),language=$state('id');
 $effect(()=>{flow=scheduled?'live':['live','schedule','import','audio'].includes(initial)?initial as Flow:'';title=scheduled?.title[lang]??'';date=scheduled?.date??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date())});
 const choices=$derived([{id:'live' as const,icon:Mic,title:en?'Record live':'Rekam langsung',hint:en?'Transcribe an open hearing with permission.':'Transkripsikan sidang terbuka dengan izin.'},{id:'audio' as const,icon:Upload,title:en?'Upload audio':'Unggah audio',hint:en?'Transcribe a saved recording.':'Transkripsikan rekaman yang tersimpan.'},{id:'import' as const,icon:FileUp,title:en?'Import transcript':'Impor transkrip',hint:en?'Review speaker turns before filing.':'Periksa giliran pembicara sebelum disimpan.'},{id:'schedule' as const,icon:CalendarDays,title:en?'Schedule hearing':'Jadwalkan sidang',hint:en?'Set a hearing date and time.':'Tetapkan tanggal dan waktu sidang.'}]);
 function fail(e:unknown){message=e instanceof Error?e.message:(en?'Could not complete this action.':'Tindakan belum selesai.')}
 async function preview(f?:File){if(!f)return;file=f;if(flow!=='import')return;const body=new FormData();body.append('file',f);busy=true;message='';try{const r=await api<{title:string;date:string;turns:typeof draft}>(prefix+'/import/preview','POST',body);draft=r.turns;title=r.title;date=r.date}catch(e){fail(e)}finally{busy=false}}
 async function submit(e:SubmitEvent){e.preventDefault();if(busy)return;busy=true;message='';try{let h:Hearing;
   if(flow==='audio'){const form=new FormData();form.set('file',file!);form.set('title',title);form.set('date',date);form.set('lang',language);h=await api<Hearing>('/api/live/'+w.caseRecord.id+'/upload','POST',form)}
   else {const body={title,date,time,flow,recordingPermission:permission,closed,turns:flow==='import'?draft:undefined};h=await api<Hearing>(scheduled?prefix+'/'+scheduled.id+'/start':prefix+(flow==='import'?'/import':''),'POST',body)}
   close();await invalidateAll();await goto('/case/'+w.caseRecord.id+'/hearings/'+h.id);
 }catch(e){fail(e)}finally{busy=false}}
</script>
<Dialog title={flow?choices.find(x=>x.id===flow)!.title:(en?'New hearing':'Sidang baru')} {lang} {close} wide={flow==='import'&&draft.length>0}>
{#if !flow}<div class="flow-choices">{#each choices as c}<button disabled={c.id==='live'&&!demo&&(!transcription||guest)||c.id==='audio'&&(!transcription||guest||demo)} onclick={()=>{flow=c.id;message=''}}><c.icon size={21}/><span><strong>{c.title}</strong><small>{c.hint}</small></span></button>{/each}</div>{#if !transcription||guest}<p class="small muted">{en?'Private audio transcription requires a configured account. Transcript import is available.':'Transkripsi audio pribadi memerlukan akun terkonfigurasi. Impor transkrip tersedia.'}</p>{/if}
{:else}<form class="stack" onsubmit={submit}>
 {#if flow==='import'||flow==='audio'}<label class="field">{flow==='import'?(en?'Transcript file':'Berkas transkrip'):(en?'Audio file, up to 25 MB':'Berkas audio, hingga 25 MB')}<input type="file" accept={flow==='import'?'.txt,.vtt,.srt,.json,.csv,.docx,.pdf,.jude':'.wav,.m4a,.mp3,.mp4,.webm,.mpeg'} onchange={e=>preview(e.currentTarget.files?.[0])}/></label>{/if}
 {#if flow==='import'&&demo&&!draft.length}<button type="button" class="button" onclick={()=>preview(new File(['[00:00:00] Hakim Ketua: Sidang dibuka.\n[00:00:08] Saksi: Saya tiba di Gerbang Timur.'],'Risalah contoh.txt',{type:'text/plain'}))}>{en?'Use sample transcript':'Pakai contoh risalah'}</button>{/if}
 {#if flow!=='import'||draft.length}<label class="field">{en?'Hearing title':'Judul sidang'}<input required maxlength="160" bind:value={title}/></label>
 <div class="dates"><label class="field">{en?'Date':'Tanggal'}<input type="date" required bind:value={date}/></label>{#if flow==='schedule'}<label class="field">{en?'Time (WIB)':'Waktu (WIB)'}<input type="time" required bind:value={time}/></label>{/if}</div>{/if}
 {#if flow==='import'&&draft.length}<p>{en?'Check the speakers and wording before importing.':'Periksa pembicara dan teks sebelum mengimpor.'}</p><div class="turns">{#each draft as turn,i}<div><small>{timecode(turn.time)}</small><input class="text-input" aria-label={(en?'Speaker ':'Pembicara ')+(i+1)} bind:value={turn.speaker}/><textarea class="text-input" aria-label={(en?'Testimony ':'Keterangan ')+(i+1)} bind:value={turn.text}></textarea></div>{/each}</div>{/if}
 {#if flow==='audio'||flow==='live'}<label class="field">{en?'Recognition language':'Bahasa pengenalan'}<select bind:value={language}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></label>{/if}
 {#if flow==='live'}{#if demo}<p class="small muted">{en?'This synthetic hearing replays example testimony.':'Sidang sintetis ini memutar ulang contoh kesaksian.'}</p>{/if}
 <label><input type="checkbox" bind:checked={closed}/> {en?'Closed hearing':'Sidang tertutup'}</label>
 <label><input type="checkbox" required bind:checked={permission}/> {en?'The presiding judge permitted recording in this open hearing.':'Hakim ketua mengizinkan perekaman dalam sidang terbuka ini.'}</label>{/if}
 {#if message}<p class="error-text" role="alert">{message}</p>{/if}
 <div class="actions"><button type="submit" class="button primary" disabled={busy||flow==='import'&&!draft.length||flow==='audio'&&!file||flow==='live'&&(!permission||closed||(!demo&&(!transcription||guest)))}>{busy?(en?'Processing…':'Memproses…'):flow==='schedule'?(en?'Schedule hearing':'Jadwalkan sidang'):flow==='import'?(en?'Confirm and import':'Konfirmasi dan impor'):flow==='audio'?(en?'Transcribe audio':'Transkripsikan audio'):(en?'Start hearing':'Mulai sidang')}</button>
 {#if !scheduled}<button class="button subtle" type="button" onclick={()=>{flow='';draft=[];file=undefined;message=''}}>{en?'Back':'Kembali'}</button>{/if}</div>
 </form>{/if}</Dialog>
<style>.flow-choices{display:grid;margin-bottom:16px}.flow-choices button{display:flex;align-items:center;gap:15px;text-align:left;min-height:69px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--ink)}.flow-choices span{display:grid;gap:3px}.flow-choices small{color:var(--muted)}.dates{display:flex;gap:12px}.dates label{flex:1}.turns{overflow:auto;max-height:260px;display:grid;gap:12px}.turns>div{display:grid;grid-template-columns:auto 1fr 2fr;align-items:center;gap:8px}@media(max-width:550px){.turns>div{grid-template-columns:1fr}.dates{flex-wrap:wrap}}</style>
