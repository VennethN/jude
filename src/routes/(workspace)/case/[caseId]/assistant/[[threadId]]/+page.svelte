<script lang="ts">
  import {page} from '$app/state';
  import {goto} from '$app/navigation';
  import {write} from '$lib/client';
  import {ArrowLeft, History, Search, SquarePen, Trash2} from '@lucide/svelte';
  import type {PageData} from './$types';
  import type {ContextRef,Thread} from '$lib/domain';
  import {apiPath,casePath,dateLabel,evidenceKey,local,sourceOf} from '$lib/evidence/records';
  import Assistant from '$lib/evidence/Assistant.svelte';
  import '$lib/evidence/evidence.css';
  let {data}:{data:PageData}=$props();
  let w=$derived(data.workspace),lang=$derived(data.lang),id=$derived(lang==='id');
  let base=$derived(casePath(w)+'/assistant'),active=$derived(page.params.threadId||'');
  let query=$state(''),scope=$state(''),deleted=$state(''),confirmDelete=$state(''),busy=$state(false),problem=$state('');
  const key=(ref:ContextRef)=>'id' in ref?evidenceKey(ref):ref.kind;
  let sources=$derived.by(()=>{
    const options=new Map<string,string>();
    for(const t of w.threads)for(const m of t.messages)for(const c of m.contexts||[]){
      if(c.kind==='case')continue;
      const source=sourceOf(w,c,lang);if(source)options.set(key(c),source.label);
    }
    return [...options];
  });
  let history=$derived(w.threads.filter(t=>{
    const q=query.trim().toLowerCase();
    const match=!q||local(t.title,lang).toLowerCase().includes(q)||t.messages.some(m=>local(m.text,lang).toLowerCase().includes(q));
    return match&&(!scope||t.messages.some(m=>m.contexts?.some(c=>key(c)===scope)));
  }).toSorted((a,b)=>b.updated-a.updated));
  let invalid=$derived(active&&active!=='new'&&!w.threads.some(t=>t.id===active));
  function day(t:Thread){return dateLabel(t.updated,lang);}
  async function remove(threadId:string){
    if(busy)return;busy=true;problem='';
    try{await write(apiPath(w,'threads/'+encodeURIComponent(threadId)),'DELETE');deleted=threadId;confirmDelete='';if(active===threadId)await goto(base);}
    catch(e){problem=e instanceof Error?e.message:(id?'Penghapusan gagal.':'Could not delete.');}finally{busy=false;}
  }
  async function restore(){
    if(busy)return;busy=true;problem='';
    try{await write(apiPath(w,'threads/'+encodeURIComponent(deleted)+'/restore'),'POST');deleted='';}catch(e){problem=e instanceof Error?e.message:(id?'Pemulihan gagal.':'Could not restore.');}finally{busy=false;}
  }
</script>
<svelte:head><title>{id?'Asisten perkara':'Case assistant'} · Jude</title></svelte:head>
<div class="ev-page"><header class="ev-head"><div><h1>{id?'Asisten perkara':'Case assistant'}</h1><p>{id?'Ajukan pertanyaan dan telusuri sumber yang dikutip dalam jawabannya.':'Ask a question and follow the sources cited in the answer.'}</p></div><a class="ev-button" href={base+'/new'}><SquarePen size={16}/>{id?'Percakapan baru':'New conversation'}</a></header>
  {#if problem}<p role="alert" class="ev-error">{problem}</p>{/if}
  {#if deleted}<div class="ev-notice ev-inline" role="status">{id?'Percakapan dihapus.':'Conversation deleted.'}<button class="ev-button" disabled={busy} onclick={restore}>{id?'Urungkan':'Undo'}</button></div>{/if}
  {#if invalid}<p class="ev-notice" role="status">{id?'Percakapan tidak ditemukan.':'Conversation not found.'}</p>{/if}
  <div class="workspace" class:opened={!!active&&!invalid}>
    <aside class="history" data-tour="assistant-history"><h2 class="ev-title"><History size={19}/>{id?'Riwayat':'History'}</h2>
      <label class="ev-search"><Search size={15}/><input bind:value={query} type="search" aria-label={id?'Cari percakapan':'Search conversations'} placeholder={id?'Cari percakapan…':'Find a conversation…'}/></label>
      {#if sources.length}<select class="ev-select" bind:value={scope} aria-label={id?'Filter menurut konteks':'Filter by context'}><option value="">{id?'Semua konteks':'All contexts'}</option>{#each sources as [key,label]}<option value={key}>{label}</option>{/each}</select>{/if}
      <ul class="ev-list">{#each history as t,i (t.id)}<li>
        {#if i===0||day(t)!==day(history[i-1])}<h3>{day(t)}</h3>{/if}
        <div class="row"><a class="ev-pick" href={base+'/'+encodeURIComponent(t.id)} aria-current={t.id===active?'page':undefined}><strong>{local(t.title,lang)||(id?'Percakapan baru':'New conversation')}</strong><span class="ev-meta">{t.messages.length} {id?'pesan':'messages'}{t.sample?(id?' · Contoh sintetis':' · Synthetic example'):''}</span></a><button class="ev-icon" onclick={()=>confirmDelete=t.id} aria-label={(id?'Hapus percakapan ':'Delete conversation ')+local(t.title,lang)}><Trash2 size={14}/></button></div>
        {#if confirmDelete===t.id}<div class="ev-notice"><p>{id?'Hapus percakapan ini?':'Delete this conversation?'}</p><div class="ev-actions"><button class="ev-button" onclick={()=>confirmDelete=''}>{id?'Batal':'Cancel'}</button><button class="ev-button" disabled={busy} onclick={()=>remove(t.id)}>{id?'Hapus':'Delete'}</button></div></div>{/if}
      </li>{:else}<li class="ev-sub">{query||scope?(id?'Tidak ada percakapan yang cocok.':'No matching conversations.'):(id?'Pertanyaan pertama Anda akan memulai riwayat ini.':'Your first question starts this history.')}</li>{/each}</ul>
    </aside>
    <div class="conversation"><a class="mobile-back ev-link" href={base}><ArrowLeft size={15}/>{id?'Semua percakapan':'All conversations'}</a>
      {#key active || 'draft'}<Assistant workspace={w} {lang} threadId={invalid?undefined:active}/>{/key}
    </div>
  </div>
</div>
<style>
  .workspace{display:grid;grid-template-columns:minmax(13rem,28%) minmax(0,1fr);gap:clamp(1rem,3vw,2.6rem);align-items:start}.history{min-width:0;border-inline-end:1px solid var(--line);padding-inline-end:1rem}.history h2{display:flex;align-items:center;gap:.55rem;font-size:1.5rem;margin-bottom:.7rem}.history .ev-select{margin:.5rem 0;width:100%}.history h3{font:600 .78rem var(--sans);color:var(--muted);margin:1.1rem 0 .2rem}.history .row{display:flex;align-items:center}.history .row .ev-icon{border:0;background:none;color:var(--muted);width:36px;min-width:36px}.history .ev-pick{min-width:0;padding:.65rem .35rem}.history .ev-pick strong{display:block;font-size:.89rem;overflow-wrap:anywhere}.mobile-back{display:none}.conversation{min-width:0;max-width:57rem}.history .ev-list>li+li{border:0}
  @container(max-width:745px){.workspace{display:block}.history{border:0;padding:0}.workspace.opened .history,.workspace:not(.opened) .conversation{display:none}.mobile-back{display:inline-flex}.workspace.opened .conversation{display:block}}
</style>

