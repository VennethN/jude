<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Check, Pencil, RotateCcw, Copy, MessageSquare, PanelsTopLeft, Play, ArrowUpRight, Bookmark, BookOpenText } from '@lucide/svelte';
  import { write } from '$lib/client';
  import type { Finding, InspectTarget, Lang, Workspace } from '$lib/domain';
  import { apiPath, assistantPath, boardPath, local, sourceOf, statuses, relations } from './records';
  import Inspector from './Inspector.svelte';
  import Match from './Match.svelte';

  let {workspace:w,lang,finding:f}:{workspace:Workspace;lang:Lang;finding:Finding}=$props();
  let id=$derived(lang==='id');
  let line=$derived(w.statements.find(s=>s.id===f.statementId));
  let hearing=$derived(w.hearings.find(h=>h.id===f.hearingId));
  let testimony=$derived(sourceOf(w,{kind:'statement',id:f.statementId},lang));
  let note=$state(untrack(()=>f.note));
  let busy=$state(false), feedback=$state(''), problem=$state(''), manualCopy=$state(false);
  let target=$state<InspectTarget|null>(null);
  let notes:HTMLTextAreaElement;
  let question:HTMLElement;
  async function save(check=false){
    if(busy)return;busy=true;problem='';feedback='';
    try{await write(apiPath(w,'findings/'+encodeURIComponent(f.id)),'PATCH',check?{reviewed:!f.reviewed,note}:{note});feedback=id?'Perubahan tersimpan.':'Changes saved.';}
    catch(e){problem=e instanceof Error?e.message:(id?'Gagal menyimpan.':'Could not save.');}
    finally{busy=false;}
  }
  async function toggleBookmark(){
    if(!line || busy)return;busy=true;problem='';
    try{await write(apiPath(w,'statements/'+encodeURIComponent(line.id)),'PATCH',{flagged:!line.flagged});}
    catch(e){problem=e instanceof Error?e.message:(id?'Perubahan gagal.':'Change failed.');}
    finally{busy=false;}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(f.question);feedback=id?'Pertanyaan disalin.':'Question copied.';}
    catch{manualCopy=true;const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(question);selection?.removeAllRanges();selection?.addRange(range);}
  }
  function shortcut(e:KeyboardEvent){
    if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||target||document.querySelector('dialog[open]')||(e.target instanceof HTMLElement && (e.target.isContentEditable||e.target.closest('input,textarea,select'))))return;
    if(e.key==='r'){ e.preventDefault();void save(true); }
    if(e.key==='n'){ e.preventDefault();notes?.focus(); }
  }
  onMount(()=>{
    if(f.isNew)void write(apiPath(w,'findings/'+encodeURIComponent(f.id)),'PATCH',{isNew:false}).catch(()=>{});
  });
</script>
<svelte:window onkeydown={shortcut}/>
<article class="detail" data-tour="finding-detail">
  <span class="ev-cap flag" data-status={f.status}><span></span>{statuses[f.status][lang]}</span>
  <h2 class="ev-title">{local(f.title,lang)}</h2>
  {#if testimony && line}
    <div class="evidence-pair" data-tour="finding-comparison">
      <section><span class="ev-cap">{id?'Keterangan sidang':'In testimony'}</span><blockquote><Match text={line.text} term={f.said}/></blockquote><button class="under" onclick={()=>target={kind:'statement',id:line!.id}}>{testimony.label}</button></section>
      <section><span class="ev-cap">{id?'Dalam berkas':'In the record'}</span>{#each f.sources as s (s.passageId)}
        {@const src=sourceOf(w,{kind:'passage',id:s.passageId},lang)}{#if src}<blockquote class="ev-record"><Match text={src.text} term={s.match}/></blockquote><button class="under" onclick={()=>target={kind:'passage',id:s.passageId}}>{src.label} <span class="ev-meta">· {relations[s.relation][lang]}</span></button>{/if}
      {:else}<p class="ev-sub">{id?'Belum ada kutipan sumber.':'No source passage is available.'}</p>{/each}</section>
    </div>
  {:else}<p class="ev-notice">{id?'Pernyataan untuk temuan ini tidak tersedia.':'The testimony for this finding is unavailable.'}</p>{/if}
  <p>{local(f.explanation,lang)}</p>
  {#if f.uncertainty}<details class="context"><summary>{id?'Konteks dan ketidakpastian':'Context and uncertainty'}</summary><p>{local(f.uncertainty,lang)}</p></details>{/if}
  <section class="question" data-tour="finding-question"><h3>{id?'Pertanyaan untuk saksi':'Suggested question'}</h3><blockquote bind:this={question}>{f.question}</blockquote><button class="ev-button" onclick={copy}><Copy size={15}/>{id?'Salin pertanyaan':'Copy question'}</button>
    {#if manualCopy}<p class="ev-meta" role="status">{id?'Seleksi sudah disiapkan. Salin secara manual.':'The question is selected. Use your copy shortcut.'}</p>{/if}
  </section>
  <div class="ev-actions">
    {#if testimony && hearing?.mode==='recorded'}<a class="ev-button" href={testimony.href+'&play=1'}><Play size={15}/>{id?'Putar dari sini':'Play from here'}</a>{/if}
    {#if line}<button class="ev-button" disabled={busy} aria-pressed={!!line.flagged} onclick={toggleBookmark}><Bookmark size={15}/>{line.flagged?(id?'Tersimpan':'Bookmarked'):(id?'Simpan pernyataan':'Bookmark line')}</button>{/if}
    <a class="ev-button" href={assistantPath(w,{kind:'finding',id:f.id})}><MessageSquare size={15}/>{id?'Tanya asisten':'Ask assistant'}</a>
    <a class="ev-button" href={boardPath(w,{kind:'finding',id:f.id})}><PanelsTopLeft size={15}/>{id?'Taruh di papan':'Put on board'}</a>
  </div>
  {#if f.legal?.length}<section class="law"><h3>{id?'Rujukan hukum':'Legal references'}</h3>{#each f.legal as lawId}{@const law=w.legal.find(l=>l.id===lawId)}{#if law}<button class="ev-button" onclick={()=>target={kind:'legal',id:lawId}}><BookOpenText size={16}/>{law.article} · {law.regulation}<ArrowUpRight size={14}/></button>{/if}{/each}</section>{/if}
  <section class="review" data-tour="finding-review"><h3>{id?'Pemeriksaan Anda':'Your review'}</h3><p>{local(f.verify,lang)}</p>
    <label class="ev-field-label">{id?'Catatan pemeriksaan':'Review note'}<textarea bind:this={notes} class="ev-textarea" rows="3" bind:value={note} placeholder={id?'Apa yang perlu ditindaklanjuti?':'What needs following up?'}/></label>
    <div class="ev-actions"><button class="ev-button primary" disabled={busy} onclick={()=>save(true)}>{#if f.reviewed}<RotateCcw size={16}/>{id?'Buka kembali':'Reopen'}{:else}<Check size={16}/>{id?'Tandai diperiksa':'Mark checked'}{/if}</button>
      <button class="ev-button" disabled={busy||note===f.note} onclick={()=>save()}><Pencil size={15}/>{id?'Simpan catatan':'Save note'}</button></div>
  </section>
  {#if feedback}<p role="status" class="ev-meta">{feedback}</p>{/if}{#if problem}<p class="ev-error" role="alert">{problem}</p>{/if}
</article>
{#if target}<Inspector workspace={w} {lang} {target} close={()=>target=null}/>{/if}
<style>
  .detail{background:var(--surface);border:1px solid var(--line);padding:clamp(1rem,2.6vw,2.25rem);border-radius:.7rem;min-width:0;line-height:1.6}.detail h2{margin:.55rem 0 1.3rem;font-size:2rem}.detail h3,.question h3{font:600 .93rem/1.35 var(--sans);margin:.2rem 0 .65rem}.detail p{max-width:72ch;margin:.8rem 0}.flag span{display:inline-block;width:9px;height:9px;border-radius:2px;background:#aa6726}.flag[data-status=context_needed] span{background:#806098}.flag[data-status=supported] span{background:#4b795d}.flag[data-status=insufficient_evidence] span{background:var(--muted)}.evidence-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-block:1px solid var(--line);margin:.7rem 0}.evidence-pair section{padding:1rem 1rem 1rem 0}.evidence-pair section+section{padding-left:1rem;border-left:1px solid var(--line)}.evidence-pair blockquote{margin:.55rem 0 .2rem}.under{min-height:44px;text-align:left;text-decoration:underline;text-underline-offset:.2em;font:600 .78rem/1.55 var(--sans);color:var(--accent);background:none;border:0;padding:.25rem 0;cursor:pointer}.context summary{cursor:pointer;padding:.65rem 0;font-weight:600;font-size:.88rem}.question{padding:1.1rem;margin:1.2rem 0;border-radius:.55rem;background:color-mix(in srgb,var(--accent) 6%,var(--paper))}.question blockquote{font:400 1.45rem/1.27 var(--display);margin:.4rem 0 .75rem}.review,.law{border-top:1px solid var(--line);padding-top:1.1rem;margin-top:1.2rem}@container(max-width:990px){.evidence-pair{grid-template-columns:1fr}.evidence-pair section+section{padding-left:0;border-left:0;border-top:1px solid var(--line)}}@container(max-width:650px){.detail h2{font-size:1.65rem}}
</style>

