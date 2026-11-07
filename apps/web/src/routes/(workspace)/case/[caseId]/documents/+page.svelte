<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { Search, Upload, FileText, ChevronRight, MessageSquare, BookOpenText } from '@lucide/svelte';
  import type { PageData } from './$types';
  import { apiPath, assistantPath, casePath, dateLabel, local } from '$lib/evidence/records';
  import type { CaseDocument } from '@jude/core/domain';
  import { needsReview } from '@jude/core/domain';
  import Match from '$lib/evidence/Match.svelte';
  import '$lib/evidence/evidence.css';

  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace);
  let id = $derived(data.lang === 'id');
  let input: HTMLInputElement;
  let query = $state('');
  let busy = $state(false);
  let activeFile = $state('');
  let dragging = $state(false);
  let ready = $state<CaseDocument[]>([]);
  let failed = $state<{file:File; key:string; message:string}[]>([]);
  const requestKeys = new WeakMap<File,string>();
  let pendingFinding = $derived(w.findings.find(f => needsReview(f) && f.sources.some(s => w.passages.some(p => p.id===s.passageId))));
  let citedPassage = $derived(w.passages.find(p => pendingFinding?.sources.some(s => s.passageId===p.id)));
  let citedDocument = $derived(w.documents.find(d => d.id===citedPassage?.docId));
  let citedPhrase = $derived(pendingFinding?.sources.find(s=>s.passageId===citedPassage?.id)?.match);
  let term = $derived(query.trim().toLowerCase());
  let docs = $derived(
    w.documents.filter(
      (d) => !term || (d.title + ' ' + local(d.kind, data.lang)).toLowerCase().includes(term)
    )
  );
  let passages = $derived(
    term.length >= 2 ? w.passages.filter((p) => p.text.toLowerCase().includes(term)) : []
  );

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    busy = true;
    feedback = '';
    problem = '';
    ready=[]; failed=[];
    for(const file of files) {
      activeFile=file.name;
      const requestKey=requestKeys.get(file) || crypto.randomUUID();
      requestKeys.set(file,requestKey);
      try {
        if(file.size>25*1024*1024)throw new Error(id?'Batas per berkas adalah 25 MB.':'The limit is 25 MB per file.');
        const form=new FormData();
        form.set('file',file); form.set('title',file.name.replace(/\.[^.]+$/,'') || file.name);
        const response=await fetch(apiPath(w,'documents'),{method:'POST',body:form,headers:{'Idempotency-Key':requestKey}});
        const body=await response.json();
        if(!response.ok)throw new Error(body.error?.message || (id?'Gagal mengunggah.':'Upload failed.'));
        ready=[...ready,body];
      } catch (e) {
        failed=[...failed,{file,key:requestKey,message:e instanceof Error?e.message:(id?'Gagal mengunggah.':'Upload failed.')}];
      }
    }
    try {
      if(ready.length) await invalidateAll();
    } finally {
      activeFile='';busy=false;input.value='';
    }
  }
  function dragFiles(event:DragEvent) {
    if(!event.dataTransfer?.types.includes('Files'))return;
    event.preventDefault();dragging=true;
  }
  function dropFiles(event:DragEvent) {
    event.preventDefault();dragging=false;
    if(event.dataTransfer)void upload(Array.from(event.dataTransfer.files));

  }
</script>

<svelte:head><title>{id ? 'Dokumen' : 'Documents'} · Jude</title></svelte:head>
<div class="ev-page" role="region" aria-label={id?'Berkas perkara':'Case files'} ondragover={dragFiles} ondragleave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))dragging=false;}} ondrop={dropFiles}>
  <header class="ev-head">
    <div>
      <h1>{id ? 'Dokumen' : 'Documents'}</h1>
      <p>{id ? 'Berkas yang menjadi sumber dalam perkara ini.' : 'The source files held in this case.'}</p>
    </div>
    <div class="ev-actions">
      <input
        class="ev-only"
        tabindex="-1"
        bind:this={input}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        multiple
        aria-label={id ? 'Pilih berkas' : 'Choose files'}
        onchange={(e) => upload(Array.from(e.currentTarget.files ?? []))}
      />
      <button class="ev-button primary" disabled={busy} onclick={() => input.click()}
        ><Upload size={17} />{busy
          ? id
            ? 'Mengunggah…'
            : 'Uploading…'
          : id
            ? 'Unggah dokumen'
            : 'Upload documents'}</button
      >
    </div>
  </header>
  {#if dragging}<div class="drop-notice" role="status"><Upload size={18}/>{id?'Lepaskan berkas untuk mengunggah':'Drop files to upload'}</div>{/if}
  {#if busy}<p class="ev-notice" role="status">{id?'Membaca berkas':'Reading file'} · {activeFile}</p>{/if}
  {#each ready as d (d.id)}<div class="ev-notice ev-inline" role="status">{d.title} · {id?'siap dibuka':'ready to open'}<a class="ev-link" href={casePath(w)+'/documents/'+encodeURIComponent(d.id)}>{id?'Buka':'Open'}</a></div>{/each}
  {#each failed as item (item.key)}<div class="ev-notice ev-inline" role="alert"><strong>{item.file.name}</strong> {item.message}<button class="ev-button" disabled={busy} onclick={()=>upload([item.file])}>{id?'Coba lagi':'Try again'}</button></div>{/each}
  <div class="ev-tools" data-tour="docs-search">
    <label class="ev-search"
      ><Search size={17} /><span class="ev-only"
        >{id ? 'Cari dokumen atau kutipan' : 'Search documents or passages'}</span
      ><input
        type="search"
        bind:value={query}
        placeholder={id ? 'Cari berkas atau kutipan…' : 'Find a file or passage…'}
      /></label
    >
    <span class="ev-meta">{w.documents.length} {id ? 'dokumen' : 'documents'}</span>
  </div>
  {#if docs.length}
    <div class="archive-layout" class:with-citation={!!citedDocument && !term}>
    <ul class="ev-list files" data-tour="docs-list">
      {#each docs as doc (doc.id)}
        <li>
          <a href={casePath(w) + '/documents/' + encodeURIComponent(doc.id)}>
            <span class="doc-tab" aria-hidden="true"><FileText size={22}/></span>
            <span class="name"
              ><strong><Match text={doc.title} term={query} /></strong><span class="ev-meta"
                >{local(doc.kind, data.lang)}</span
              ></span
            >
            <span class="file-info"
              >{doc.file}<span class="ev-meta">{doc.pages} {id ? 'halaman' : 'pages'}</span></span
            >
            <span class="ev-meta date">{dateLabel(doc.added, data.lang)}</span><ChevronRight size={16} />
          </a>
        </li>
      {/each}
    </ul>
    {#if citedDocument && citedPassage && pendingFinding && !term}
      <aside class="cited-slip" aria-labelledby="cited-title">
        <div class="slip-head"><BookOpenText size={19}/><h2 id="cited-title">{id?'Dikutip dalam pemeriksaan':'Cited in review'}</h2></div>
        <div class="slip-text">
          <p class="folio-label">{citedDocument.title}</p>
          <blockquote class="ev-record">“<Match text={citedPassage.text} term={citedPhrase}/>”</blockquote>
          <a class="ev-link" href={casePath(w)+'/documents/'+encodeURIComponent(citedDocument.id)+'?p='+encodeURIComponent(citedPassage.id)}>{id?'Baca halaman':'Read page'} {citedPassage.page}<ChevronRight size={14}/></a>
        </div>
        <a class="slip-finding" href={casePath(w)+'/findings/'+encodeURIComponent(pendingFinding.id)}>{local(pendingFinding.title,data.lang)}<ChevronRight size={15}/></a>
      </aside>
    {/if}
    </div>
  {:else if !term}
    <div class="ev-empty">
      <FileText size={26} />
      <h2 class="ev-title">{id ? 'Belum ada dokumen' : 'No documents yet'}</h2>
      <p>
        {id
          ? 'Unggah PDF, DOCX, Markdown, atau teks untuk membuka berkas pertama.'
          : 'Upload a PDF, DOCX, Markdown or text file to open your first record.'}
      </p>
    </div>
  {/if}
  {#if term.length >= 2}
    <section class="matches" aria-live="polite">
      <h2 class="ev-title">{id ? 'Kutipan yang cocok' : 'Matching passages'}</h2>
      {#if passages.length}<ul class="ev-list">
          {#each passages as p (p.id)}
            {@const d = w.documents.find((item) => item.id === p.docId)}
            {#if d}<li>
                <a
                  class="ev-pick"
                  href={casePath(w) +
                    '/documents/' +
                    encodeURIComponent(d.id) +
                    '?p=' +
                    encodeURIComponent(p.id) +
                    '&view=text'}
                  ><span class="ev-cap"
                    ><BookOpenText size={15} /> {d.title} · {id ? 'hal.' : 'p.'} {p.page}</span
                  >
                  <p class="ev-record"><Match text={p.text} term={query} /></p></a
                >
              </li>{/if}
          {/each}
        </ul>{:else}<p class="ev-sub">
          {id
            ? 'Tidak ada kutipan yang cocok. Coba frasa lain.'
            : 'No matching passages. Try a different phrase.'}
        </p>{/if}
      <a class="ev-link" href={assistantPath(w, { kind: 'documents' })} onclick={(e)=>{e.preventDefault();goto(assistantPath(w,{kind:'documents'}),{state:{judeDraft:query}});}}
        ><MessageSquare size={15} />{id ? 'Tanyakan kepada asisten' : 'Ask the case assistant'}</a
      >
    </section>
  {:else if term && !docs.length}<p class="ev-sub">
      {id
        ? 'Ketik sekurangnya dua karakter untuk mencari kutipan.'
        : 'Enter at least two characters to search passages.'}
    </p>{/if}
</div>

<style>
  .ev-search {
    width: min(100%, 30rem);
  }
  .files a {
    color: var(--ink);
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) minmax(5rem, 10%) minmax(6.5rem, 12%) 20px;
    gap: 1rem;
    align-items: center;
    padding: 1rem 0.55rem;
    text-decoration: none;
  }
  .files a:hover .name strong {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .name,
  .file-info {
    display: grid;
    gap: 0.15rem;
  }
  .name strong {
    font-size: 1rem;
    overflow-wrap: anywhere;
  }
  .file-info {
    font-size: 0.82rem;
    font-weight: 600;
  }
  .doc-tab {
    display: grid;
    place-items: center;
    width: 37px;
    height: 44px;
    color: var(--forest);
    background: color-mix(in srgb, var(--forest) 9%, var(--surface));
    border-radius: 4px 9px 4px 4px;
  }
  .matches {
    margin-top: 2rem;
  }
  .matches ul {
    margin-top: 1rem;
  }
  .matches p.ev-record {
    margin: 0.45rem 0 0;
    max-width: 80ch;
  }
  .archive-layout { display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:1.5rem; }
  .archive-layout.with-citation { grid-template-columns:minmax(0,1fr) minmax(16rem,29%); }
  .cited-slip { min-width:0; background:var(--surface);border:1px solid var(--line);border-radius:.5rem;overflow:hidden; }
  .slip-head { display:flex;align-items:center;gap:.5rem;background:var(--wash);padding:.9rem 1rem;color:var(--ink); }
  .slip-head h2 { margin:0;font:400 1.4rem/1.1 var(--display); }
  .slip-text,.slip-finding { padding:.9rem 1rem; }
  .folio-label { font:600 .8rem/1.45 var(--sans);color:var(--muted);margin:0; }
  .slip-text blockquote { font-size:.93rem;line-height:1.53;margin:.7rem 0 .2rem; }
  .slip-finding { border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:.7rem;font:600 .83rem/1.5 var(--sans);color:var(--ink);text-decoration:none; }
  .slip-finding:hover {text-decoration:underline;text-underline-offset:.18em;}
  .drop-notice { display:flex;align-items:center;gap:.65rem;min-height:4rem;border:2px dashed var(--forest);padding:1rem;margin-bottom:.65rem; }
  @container(max-width:930px){.archive-layout.with-citation{grid-template-columns:1fr}.cited-slip{max-width:45rem}}
  @container (max-width:680px) {
    .files a {
      grid-template-columns: 30px minmax(0, 1fr) auto;
      gap: 0.65rem;
      padding: 0.9rem 0;
    }
    .doc-tab {
      width: 29px;
      height: 38px;
    }
    .files .date,
    .files .file-info {
      display: none;
    }
    .ev-search {
      width: 100%;
    }
  }
</style>
