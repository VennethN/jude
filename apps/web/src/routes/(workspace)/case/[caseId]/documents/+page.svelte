<script lang="ts">
  import { displayTitle } from '$lib/workspace/format';
  import PageHeading from '$lib/workspace/PageHeading.svelte';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { ApiError, api } from '$lib/client';
  import DocumentRemoval from '$lib/evidence/DocumentRemoval.svelte';
  import { onMount } from 'svelte';
  import {
    Search,
    Upload,
    FileText,
    MessageSquare,
    BookOpenText,
    Trash2
  } from '@lucide/svelte';
  import type { PageData } from './$types';
  import { apiPath, assistantPath, casePath, dateLabel, local } from '$lib/evidence/records';
  import type { CaseDocument } from '@jude/core/domain';
  import Match from '$lib/evidence/Match.svelte';
  import '$lib/evidence/evidence.css';

  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace);
  let id = $derived(data.lang === 'id');
  let input: HTMLInputElement;
  let interactive = $state(false);
  onMount(() => {
    interactive = true;
  });
  let query = $state('');
  let busy = $state(false);
  let activeFile = $state('');
  let dragging = $state(false);
  let ready = $state<CaseDocument[]>([]);
  let failed = $state<{ file: File; key: string; message: string }[]>([]);
  const requestKeys = new WeakMap<File, string>();
  const documentCounts = $derived.by(() => {
    const cited = new Set(w.findings.flatMap(finding => finding.sources.map(source => source.passageId)));
    const counts = new Map<string, { passages: number; cited: number }>();
    for (const passage of w.passages) {
      const row = counts.get(passage.docId) ?? { passages: 0, cited: 0 };
      row.passages++;
      if (cited.has(passage.id)) row.cited++;
      counts.set(passage.docId, row);
    }
    return counts;
  });
  type RemovedDocument = { caseId: string; id: string; title: string; citedFindings: number };
  let deleting = $state<CaseDocument>();
  let undoBusy = $state(false),
    undoError = $state('');
  let removed = $derived((page.state as { judeRemovedDocument?: RemovedDocument }).judeRemovedDocument);
  async function afterRemoval(result: RemovedDocument) {
    deleting = undefined;
    ready = ready.filter((row) => row.id !== result.id);
    replaceState('', { ...page.state, judeRemovedDocument: result });
    await invalidateAll();
  }
  async function restoreDocument() {
    if (!removed || undoBusy) return;
    undoBusy = true;
    undoError = '';
    try {
      const restored = await api<CaseDocument>(
        apiPath(w, 'documents/' + encodeURIComponent(removed.id) + '/restore'),
        'POST',
        {}
      );
      await invalidateAll();
      replaceState('', { ...page.state, judeRemovedDocument: undefined });
      ready = [restored];
    } catch {
      undoError = id ? 'Dokumen belum dipulihkan. Coba lagi.' : 'Could not restore the document. Try again.';
    } finally {
      undoBusy = false;
    }
  }
  let term = $derived(query.trim().toLowerCase());
  let docs = $derived(
    w.documents.filter(
      (d) => !term || (displayTitle(d, data.lang) + ' ' + d.title + ' ' + local(d.kind, data.lang)).toLowerCase().includes(term)
    )
  );
  let passages = $derived(
    term.length >= 2 ? w.passages.filter((p) => p.text.toLowerCase().includes(term)) : []
  );

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    busy = true;
    ready = [];
    failed = [];
    for (const file of files) {
      activeFile = file.name;
      const requestKey = requestKeys.get(file) || crypto.randomUUID();
      requestKeys.set(file, requestKey);
      try {
        if (file.size > 25 * 1024 * 1024)
          throw new ApiError('document_too_large', '', 413);
        const form = new FormData();
        form.set('file', file);
        form.set('title', file.name.replace(/\.[^.]+$/, '') || file.name);
        const response = await fetch(apiPath(w, 'documents'), {
          method: 'POST',
          body: form,
          headers: { 'Idempotency-Key': requestKey }
        });
        const body = await response.json();
        if (!response.ok)
          throw new ApiError(body.error?.code ?? 'request_failed', body.error?.message ?? '', response.status);
        ready = [...ready, body];
      } catch (e) {
        failed = [
          ...failed,
          {
            file,
            key: requestKey,
            message: e instanceof ApiError ? e.message : id ? 'Gagal mengunggah.' : 'Upload failed.'
          }
        ];
      }
    }
    try {
      if (ready.length) await invalidateAll();
    } finally {
      activeFile = '';
      busy = false;
      input.value = '';
    }
  }
  function dragFiles(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragging = true;
  }
  function dropFiles(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer) void upload(Array.from(event.dataTransfer.files));
  }
</script>

<svelte:head><title>{id ? 'Dokumen' : 'Documents'} · Jude</title></svelte:head>
<div
  class="ev-page"
  role="region"
  aria-label={id ? 'Berkas perkara' : 'Case files'}
  ondragover={dragFiles}
  ondragleave={(e) => {
    if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) dragging = false;
  }}
  ondrop={dropFiles}
>
  <header class="ev-head">
    <PageHeading art="page">
      <h1>{id ? 'Dokumen' : 'Documents'}</h1>
      <p>{id ? 'Berkas yang menjadi sumber dalam perkara ini.' : 'The source files held in this case.'}</p>
    </PageHeading>
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
      <button class="ev-button primary" data-tour="doc-upload" disabled={!interactive || busy} onclick={() => input.click()}
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
  {#if removed?.caseId === w.caseRecord.id && !w.documents.some((d) => d.id === removed?.id)}<div
      class="ev-notice ev-inline removed"
      role="status"
    >
      <span
        ><strong>{removed.title}</strong> · {id
          ? 'Dokumen dihapus.'
          : 'Document removed.'}{#if removed.citedFindings}
          {removed.citedFindings}
          {id
            ? 'temuan mengutip berkas ini.'
            : removed.citedFindings === 1
              ? 'finding cites this file.'
              : 'findings cite this file.'}{/if}</span
      ><button class="ev-button" disabled={undoBusy} onclick={restoreDocument}
        >{id ? 'Urungkan' : 'Undo'}</button
      >
    </div>{/if}
  {#if undoError}<p class="ev-error" role="alert">{undoError}</p>{/if}
  {#if deleting}<DocumentRemoval
      workspace={w}
      lang={data.lang}
      doc={deleting}
      close={() => (deleting = undefined)}
      removed={afterRemoval}
    />{/if}
  {#if dragging}<div class="drop-notice" role="status">
      <Upload size={18} />{id ? 'Lepaskan berkas untuk mengunggah' : 'Drop files to upload'}
    </div>{/if}
  {#if busy}<p class="ev-notice" role="status">
      {id ? 'Membaca berkas' : 'Reading file'} · {activeFile}
    </p>{/if}
  {#each ready as d (d.id)}<div class="ev-notice ev-inline" role="status">
      {displayTitle(d, data.lang)} · {id ? 'siap dibuka' : 'ready to open'}<a
        class="ev-link"
        href={casePath(w) + '/documents/' + encodeURIComponent(d.id)}>{id ? 'Buka' : 'Open'}</a
      >
    </div>{/each}
  {#each failed as item (item.key)}<div class="ev-notice ev-inline" role="alert">
      <strong>{item.file.name}</strong>
      {item.message}<button class="ev-button" disabled={busy} onclick={() => upload([item.file])}
        >{id ? 'Coba lagi' : 'Try again'}</button
      >
    </div>{/each}
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
                    ><BookOpenText size={15} /> {displayTitle(d, data.lang)} · {id ? 'hal.' : 'p.'} {p.page}</span
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
      <a
        class="ev-link"
        href={assistantPath(w, { kind: 'documents' })}
        onclick={(e) => {
          e.preventDefault();
          goto(assistantPath(w, { kind: 'documents' }), { state: { judeDraft: query } });
        }}><MessageSquare size={15} />{id ? 'Tanyakan kepada asisten' : 'Ask the case assistant'}</a
      >
    </section>
  {:else if term && !docs.length}<p class="ev-sub">
      {id
        ? 'Ketik sekurangnya dua karakter untuk mencari kutipan.'
        : 'Enter at least two characters to search passages.'}
    </p>{/if}
  {#if docs.length}
    <ul class="files" data-tour="docs-list">
      {#each docs as doc (doc.id)}
        {@const counts = documentCounts.get(doc.id)}
        <li>
          <span class="doc-tab" aria-hidden="true"><FileText size={20}/><small>{doc.file}</small></span>
          <div class="doc-body">
            <a class="doc-title" href={casePath(w) + '/documents/' + encodeURIComponent(doc.id)}>
              <Match text={displayTitle(doc, data.lang)} term={query}/>
            </a>
            <span class="ev-meta">{local(doc.kind, data.lang)}</span>
            <div class="doc-stats">
              <span>{doc.pages} {id ? 'halaman' : doc.pages === 1 ? 'page' : 'pages'}</span>
              <span>{counts?.passages ?? 0} {id ? 'kutipan' : counts?.passages === 1 ? 'passage' : 'passages'}</span>
              {#if counts?.cited}
                <a class="doc-citations" href={casePath(w) + '/findings?doc=' + encodeURIComponent(doc.id)}>
                  {counts.cited} {id ? 'dirujuk temuan' : 'cited by findings'}
                </a>
              {/if}
            </div>
            <span class="ev-meta">{id ? 'Ditambahkan' : 'Added'} {dateLabel(doc.added, data.lang)} · {doc.size}</span>
          </div>
          <button class="file-action" aria-label={(id ? 'Hapus dokumen ' : 'Remove document ') + displayTitle(doc, data.lang)}
            title={id ? 'Hapus dokumen' : 'Remove document'} disabled={!interactive || busy}
            onclick={() => (deleting = doc)}><Trash2 size={16}/></button>
        </li>
      {/each}
    </ul>
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

</div>

<style>
  .ev-search {
    width: min(100%, 30rem);
  }
  .files { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,300px),1fr)); gap: 12px; }
  .files li { position: relative; display: grid; grid-template-columns: 42px minmax(0,1fr) 28px; align-content: start;
    gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .files li:hover, .files li:focus-within { border-color: var(--muted); }
  .doc-tab { align-self: start; display: grid; justify-items: center; gap: 3px; padding: 7px 2px;
    border-radius: 6px; background:var(--wash); color: var(--ink); }
  .doc-tab small { font: 600 .69rem/1.2 var(--sans); }
  .doc-body { display: grid; align-content: start; gap: 4px; }
  .doc-title { font-weight: 600; line-height: 1.4; text-decoration: none; color: var(--ink); }
  .doc-title::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
  .doc-title:hover { text-decoration: underline; }
  .doc-stats { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 10px; color:var(--muted); font-size: .8rem; }
  .doc-citations, .file-action { position: relative; z-index: 1; }
  .doc-citations { padding-block: 3px; font-weight: 600; color: var(--accent); text-underline-offset: 3px; }
  .file-action { align-self: start; justify-self: end; min-height: 32px; width: 32px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); }
  .file-action:hover,.file-action:focus-visible { background: var(--wash); color: var(--accent); }
  .removed { justify-content: space-between; }
  @media (pointer: coarse) { .doc-citations, .file-action { min-height: 44px; } .doc-citations { display:inline-flex; align-items:center; } }
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
  .drop-notice {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-height: 4rem;
    border: 2px dashed var(--forest);
    padding: 1rem;
    margin-bottom: 0.65rem;
  }
  @container (max-width:680px) { .ev-search { width:100%; } }
</style>
