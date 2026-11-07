<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { Search, Upload, FileText, ChevronRight, MessageSquare, BookOpenText } from '@lucide/svelte';
  import type { PageData } from './$types';
  import { apiPath, assistantPath, casePath, dateLabel, local } from '$lib/evidence/records';
  import Match from '$lib/evidence/Match.svelte';
  import '$lib/evidence/evidence.css';

  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace);
  let id = $derived(data.lang === 'id');
  let input: HTMLInputElement;
  let query = $state('');
  let busy = $state(false);
  let feedback = $state('');
  let problem = $state('');
  let term = $derived(query.trim().toLowerCase());
  let docs = $derived(w.documents.filter(d => !term || (d.title + ' ' + local(d.kind,data.lang)).toLowerCase().includes(term)));
  let passages = $derived(term.length >= 2 ? w.passages.filter(p => p.text.toLowerCase().includes(term)) : []);

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    busy = true; feedback = ''; problem = '';
    let completed = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.set('file',file);
        form.set('title',file.name.replace(/\.[^.]+$/,'') || file.name);
        const res = await fetch(apiPath(w,'documents'), {method:'POST',body:form,headers:{'Idempotency-Key':crypto.randomUUID()}});
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(file.name + ' — ' + (body.error?.message || (id ? 'Gagal mengunggah' : 'Upload failed')));
        }
        completed++;
      }
    } catch (err) {
      problem = err instanceof Error ? err.message : (id ? 'Unggahan gagal. Coba lagi.' : 'Upload failed. Try again.');
    } finally {
      if (completed) {
        feedback = id ? completed + ' dokumen ditambahkan.' : completed + (completed === 1 ? ' document added.' : ' documents added.');
        await invalidateAll();
      }
      busy = false; input.value = '';
    }
  }
</script>
<svelte:head><title>{id ? 'Dokumen' : 'Documents'} · Jude</title></svelte:head>
<div class="ev-page">
  <header class="ev-head"><div><h1>{id ? 'Dokumen' : 'Documents'}</h1><p>{id ? 'Berkas yang menjadi sumber dalam perkara ini.' : 'The source files held in this case.'}</p></div>
    <div class="ev-actions"><input class="ev-only" tabindex="-1" bind:this={input} type="file" accept=".pdf,.docx,.txt,.md" multiple aria-label={id ? 'Pilih berkas' : 'Choose files'} onchange={e=>upload(Array.from(e.currentTarget.files ?? []))} />
      <button class="ev-button primary" disabled={busy} onclick={()=>input.click()}><Upload size={17}/>{busy ? (id ? 'Mengunggah…' : 'Uploading…') : (id ? 'Unggah dokumen' : 'Upload documents')}</button></div>
  </header>
  {#if feedback}<p role="status">{feedback}</p>{/if}
  {#if problem}<p class="ev-error" role="alert">{problem}</p>{/if}
  <div class="ev-tools" data-tour="docs-search">
    <label class="ev-search"><Search size={17}/><span class="ev-only">{id ? 'Cari dokumen atau kutipan' : 'Search documents or passages'}</span><input type="search" bind:value={query} placeholder={id ? 'Cari berkas atau kutipan…' : 'Find a file or passage…'}/></label>
    <span class="ev-meta">{w.documents.length} {id ? 'dokumen' : 'documents'}</span>
  </div>
  {#if docs.length}
    <ul class="ev-list files" data-tour="docs-list">
      {#each docs as doc (doc.id)}
        <li><a href={casePath(w) + '/documents/' + encodeURIComponent(doc.id)}>
          <span class="doc-tab"><FileText size={23}/></span>
          <span class="name"><strong><Match text={doc.title} term={query} /></strong><span class="ev-meta">{local(doc.kind,data.lang)}</span></span>
          <span class="file-info">{doc.file}<span class="ev-meta">{doc.pages} {id ? 'halaman' : 'pages'}</span></span>
          <span class="ev-meta date">{dateLabel(doc.added,data.lang)}</span><ChevronRight size={16}/>
        </a></li>
      {/each}
    </ul>
  {:else if !term}
    <div class="ev-empty"><FileText size={26}/><h2 class="ev-title">{id ? 'Belum ada dokumen' : 'No documents yet'}</h2><p>{id ? 'Unggah PDF, DOCX, Markdown, atau teks untuk membuka berkas pertama.' : 'Upload a PDF, DOCX, Markdown or text file to open your first record.'}</p></div>
  {/if}
  {#if term.length >= 2}
    <section class="matches" aria-live="polite"><h2 class="ev-title">{id ? 'Kutipan yang cocok' : 'Matching passages'}</h2>
      {#if passages.length}<ul class="ev-list">{#each passages as p (p.id)}
        {@const d=w.documents.find(item=>item.id===p.docId)}
        {#if d}<li><a class="ev-pick" href={casePath(w)+'/documents/'+encodeURIComponent(d.id)+'?p='+encodeURIComponent(p.id)+'&view=text'}><span class="ev-cap"><BookOpenText size={15}/> {d.title} · {id ? 'hal.' : 'p.'} {p.page}</span><p class="ev-record"><Match text={p.text} term={query}/></p></a></li>{/if}
      {/each}</ul>{:else}<p class="ev-sub">{id ? 'Tidak ada kutipan yang cocok. Coba frasa lain.' : 'No matching passages. Try a different phrase.'}</p>{/if}
      <a class="ev-link" href={assistantPath(w,{kind:'documents'},query)}><MessageSquare size={15}/>{id ? 'Tanyakan kepada asisten' : 'Ask the case assistant'}</a>
    </section>
  {:else if term && !docs.length}<p class="ev-sub">{id ? 'Ketik sekurangnya dua karakter untuk mencari kutipan.' : 'Enter at least two characters to search passages.'}</p>{/if}
</div>
<style>
  .ev-search{width:min(100%,30rem)}.files a{color:var(--ink);display:grid;grid-template-columns:42px minmax(0,1fr) minmax(5rem,10%) minmax(6.5rem,12%) 20px;gap:1rem;align-items:center;padding:1rem .55rem;text-decoration:none;}
  .files a:hover .name strong{color:var(--accent);text-decoration:underline;text-underline-offset:.2em}.name,.file-info{display:grid;gap:.15rem}.name strong{font-size:1rem;overflow-wrap:anywhere}.file-info{font-size:.82rem;font-weight:600}.doc-tab{display:grid;place-items:center;width:37px;height:44px;color:var(--forest);background:color-mix(in srgb,var(--forest) 9%,var(--surface));border-radius:4px 9px 4px 4px}.matches{margin-top:2rem}.matches ul{margin-top:1rem}.matches p.ev-record{margin:.45rem 0 0;max-width:80ch}
  @container (max-width:680px){.files a{grid-template-columns:30px minmax(0,1fr) auto;gap:.65rem;padding:.9rem 0}.doc-tab{width:29px;height:38px}.files .date,.files .file-info{display:none}.ev-search{width:100%}}
</style>

