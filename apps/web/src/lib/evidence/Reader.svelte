<script lang="ts">
  import { displayTitle } from '$lib/workspace/format';
  import PageHeading from '$lib/workspace/PageHeading.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Download,
    Minus,
    Plus,
    Search,
    ScanText,
    Trash2
  } from '@lucide/svelte';
  import type { Finding, InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import { apiPath, assistantPath, casePath, local } from './records';
  import FindingLink from './FindingLink.svelte';
  import Match from './Match.svelte';
  import Inspector from './Inspector.svelte';
  import DocumentRemoval from './DocumentRemoval.svelte';
  import PdfSheet from './PdfSheet.svelte';
  import PassageIndex from './PassageIndex.svelte';
  import './evidence.css';

  let { workspace: w, lang, docId }: { workspace: Workspace; lang: Lang; docId: string } = $props();
  let id = $derived(lang === 'id');
  let doc = $derived(w.documents.find((d) => d.id === docId)!);
  let list = $derived(w.passages.filter((p) => p.docId === doc.id));
  let selected = $derived(list.find((p) => p.id === page.url.searchParams.get('p')));
  const citations = $derived.by(() => {
    const byPassage = new Map<string, Finding[]>();
    for (const finding of w.findings) {
      for (const passageId of new Set(finding.sources.map(source => source.passageId))) {
        const rows = byPassage.get(passageId);
        if (rows) rows.push(finding);
        else byPassage.set(passageId, [finding]);
      }
    }
    return byPassage;
  });
  let original = $derived(apiPath(w, 'documents/' + encodeURIComponent(doc.id) + '/original'));
  let pdfUrl = $derived(doc.pdf || (doc.file === 'PDF' ? original : undefined));
  let textView = $derived(!pdfUrl || page.url.searchParams.get('view') === 'text');
  let count = $state(0);
  let total = $derived(count || Math.max(1, doc.pages));
  let number = $derived(
    Math.min(
      total,
      Math.max(1, Number.parseInt(page.url.searchParams.get('page') || '', 10) || selected?.page || 1)
    )
  );
  let active = $derived(list.filter((p) => p.page === number));
  let zoom = $state(1),
    query = $state(''),
    find = $state(false);
  let annotations = $derived(
    active.map((p) => ({
      id: p.id,
      text: p.text,
      loud: w.findings.some(
        (f) =>
          !f.reviewed &&
          (f.status === 'context_needed' || f.status === 'potential_inconsistency') &&
          f.sources.some((s) => s.passageId === p.id)
      ),
      label: (id ? 'Buka kutipan ' : 'Open passage ') + (list.indexOf(p) + 1)
    }))
  );
  let inspect = $state<InspectTarget | null>(null);
  let deleting = $state(false);
  let searchResults = $derived(
    query.trim() ? list.filter((p) => p.text.toLowerCase().includes(query.trim().toLowerCase())) : []
  );
  let textOnPage = $state('');
  let textLoading = $state(false);
  let selection = $state('');
  let selectionRoot: HTMLElement;
  let paragraphGroups = $derived.by(() => {
    if (!textOnPage || !textView) return [];
    const raw = textOnPage.replace(/\s+/g, ' ').trim();
    const spans = active
      .map((p) => ({ p, start: raw.toLowerCase().indexOf(p.text.replace(/\s+/g, ' ').toLowerCase()) }))
      .filter((r) => r.start >= 0)
      .sort((a, b) => a.start - b.start);
    const groups: { text: string; ref?: string }[] = [];
    let at = 0;
    for (const { p, start } of spans) {
      if (start < at) continue;
      if (start > at) groups.push({ text: raw.slice(at, start) });
      groups.push({ text: p.text, ref: p.id });
      at = start + p.text.replace(/\s+/g, ' ').length;
    }
    if (at < raw.length) groups.push({ text: raw.slice(at) });
    return groups;
  });
  function url(changes: Record<string, string | null>) {
    const params = new URLSearchParams(page.url.searchParams);
    for (const [key, val] of Object.entries(changes))
      val === null ? params.delete(key) : params.set(key, val);
    return page.url.pathname + (params.size ? '?' + params : '');
  }
  function turn(n: number) {
    return goto(url({ page: String(n), p: null }), { noScroll: true, keepFocus: true });
  }
  function readSelection() {
    const range = window.getSelection();
    selection =
      range?.rangeCount &&
      selectionRoot?.contains(range.anchorNode) &&
      selectionRoot.contains(range.focusNode)
        ? range.toString().trim().slice(0, 3000)
        : '';
  }
  function sendSelection(to: 'assistant' | 'board') {
    if (!selection) return;
    const passage = active.find((p) => p.text.includes(selection));
    const draft =
      (id ? 'Apa yang berkaitan dengan kutipan ini? ' : 'What relates to this passage? ') +
      '“' +
      selection.slice(0, 220) +
      '”';
    const excerpt = { docId: doc.id, page: number, text: selection, passageId: passage?.id };
    if (to === 'board') {
      return goto(casePath(w) + '/findings?view=board', { state: { judeExcerpt: excerpt } });
    }
    const context = passage
      ? { kind: 'passage' as const, id: passage.id }
      : { kind: 'document' as const, id: doc.id };
    return goto(assistantPath(w, context), { state: { judeDraft: draft } });
  }
  function onReady(pages: number) {
    count = pages;
  }
  $effect(() => {
    const src = pdfUrl,
      n = number;
    textOnPage = '';
    selection = '';
    if (!src || !textView) return;
    let active = true;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    textLoading = true;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      task = pdfjs.getDocument({ url: src, withCredentials: true });
      const pdf = await task.promise;
      const sheet = await pdf.getPage(Math.min(n, pdf.numPages));
      const content = await sheet.getTextContent();
      if (active) {
        count = pdf.numPages;
        textOnPage = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ');
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (active) textLoading = false;
        void task?.destroy();
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  });
</script>

{#snippet citationLinks(passageId: string)}
  {#if citations.has(passageId)}
    <div class="finding-links">
      {#each citations.get(passageId) ?? [] as finding (finding.id)}
        <FindingLink workspace={w} {finding} {lang} variant="pill"/>
      {/each}
    </div>
  {/if}
{/snippet}
{#snippet textPassage(passageId: string, text: string)}
  <div class="passage-block" class:focused={selected?.id === passageId}>
    <button class="passage" data-tour={selected?.id === passageId ? 'source-passage' : undefined} data-pid={passageId} onclick={() => (inspect = { kind: 'passage', id: passageId })}>
      {#if citations.has(passageId)}<mark><Match {text} term={query}/></mark>{:else}<Match {text} term={query}/>{/if}
    </button>
    {@render citationLinks(passageId)}
  </div>
{/snippet}

<svelte:head><title>{displayTitle(doc, lang)} · Jude</title></svelte:head>
<svelte:document onselectionchange={readSelection} />
<div class="ev-page" data-tour="reader">
  <a class="ev-link" href={casePath(w) + '/documents'}
    ><ArrowLeft size={15} />{id ? 'Dokumen' : 'Documents'}</a
  >
  <header class="ev-head">
    <PageHeading art="page" compact>
      <h1>{displayTitle(doc, lang)}</h1>
      <p class="ev-meta">{id ? 'Dokumen ditampilkan dalam bahasa aslinya.' : 'This document is shown in its original language.'}</p>
      <p>{local(doc.kind, lang)} · {doc.file} · {doc.pages} {id ? 'halaman' : 'pages'}</p>
    </PageHeading>
    <div class="ev-actions">
      <a class="ev-button" href={original} download
        ><Download size={16} />{id ? 'Unduh asli' : 'Download original'}</a
      ><button
        class="ev-icon"
        aria-label={id ? 'Hapus dokumen' : 'Remove document'}
        title={id ? 'Hapus dokumen' : 'Remove document'}
        onclick={() => (deleting = true)}><Trash2 size={16} /></button
      >
    </div>
  </header>
  <div class="ev-tabs" data-tour="doc-view-switch">
    {#if pdfUrl}<a href={url({ view: null })} aria-current={!textView ? 'page' : undefined}
        >{id ? 'Asli' : 'Original'}</a
      >{/if}<a href={url({ view: 'text' })} aria-current={textView ? 'page' : undefined}
      >{id ? 'Teks' : 'Text'}</a
    >
  </div>
  {#if doc.scanned}<p class="ev-cap">
      <ScanText size={17} />{id
        ? 'Berkas pindai. Periksa kutipan OCR pada halaman asli.'
        : 'Scanned file. Check OCR passages against the original page.'}
    </p>{/if}
  <div class="reader-layout">
    {#key doc.id}
      <PassageIndex workspace={w} passages={list} pageNumber={number} selectedId={selected?.id} {lang}
        inspect={(p) => (inspect = { kind: 'passage', id: p.id })}
        permalink={(p) => url({ p: p.id, view: 'text', page: null })}
        citations={textView ? undefined : citationLinks}/>
    {/key}
    <div class="ev-pane">
      <div class="ev-tools reader-tools" data-tour="reader-tools">
        <div class="ev-inline">
          <button
            class="ev-icon"
            aria-label={id ? 'Halaman sebelumnya' : 'Previous page'}
            disabled={number <= 1}
            onclick={() => turn(number - 1)}><ChevronLeft size={17} /></button
          >
          <label
            ><span class="ev-only">{id ? 'Halaman' : 'Page'}</span><select
              class="ev-select"
              value={number}
              onchange={(e) => turn(+e.currentTarget.value)}
              >{#each Array.from({ length: total }, (_, i) => i + 1) as n}<option value={n}
                  >{id ? 'Hal.' : 'p.'} {n} / {total}</option
                >{/each}</select
            ></label
          >
          <button
            class="ev-icon"
            aria-label={id ? 'Halaman berikutnya' : 'Next page'}
            disabled={number >= total}
            onclick={() => turn(number + 1)}><ChevronRight size={17} /></button
          >
        </div>
        <div class="ev-inline">
          {#if !textView}<button
              class="ev-icon"
              disabled={zoom <= 0.75}
              aria-label={id ? 'Perkecil' : 'Zoom out'}
              onclick={() => (zoom = Math.max(0.75, zoom - 0.25))}><Minus size={16} /></button
            ><button class="ev-button" onclick={() => (zoom = 1)} title={id ? 'Sesuaikan lebar' : 'Fit width'}
              >{Math.round(zoom * 100)}%</button
            ><button
              class="ev-icon"
              disabled={zoom >= 2}
              aria-label={id ? 'Perbesar' : 'Zoom in'}
              onclick={() => (zoom = Math.min(2, zoom + 0.25))}><Plus size={16} /></button
            >{/if}
          <button
            class="ev-icon"
            aria-label={id ? 'Cari kutipan' : 'Find passage'}
            aria-pressed={find}
            onclick={() => (find = !find)}><Search size={17} /></button
          >
        </div>
      </div>
      {#if find}<div class="ev-stack lookup">
          <label class="ev-search"
            ><Search size={16} /><input
              type="search"
              aria-label={id ? 'Cari dalam kutipan' : 'Find in passages'}
              bind:value={query}
              placeholder={id ? 'Cari dalam kutipan…' : 'Find in passages…'}
            /></label
          >
          {#if query.trim()}<span class="ev-meta">{searchResults.length} {id ? 'hasil' : 'matches'}</span>
            <ul class="ev-list">
              {#each searchResults as p (p.id)}<li>
                  <a class="ev-pick ev-record" href={url({ page: null, p: p.id })}
                    ><strong>{id ? 'Hal.' : 'p.'} {p.page}.</strong> <Match text={p.text} term={query} /></a
                  >
                </li>{/each}
            </ul>{/if}
        </div>{/if}
      <div class="reading" bind:this={selectionRoot}>
        {#if textView}
          <article class="transcript" data-tour="doc-text">
            <h2 class="ev-meta">{id ? 'Halaman' : 'Page'} {number}</h2>
            {#each paragraphGroups as group}
              {#if group.ref}{@render textPassage(group.ref, group.text)}
              {:else}<p class="ev-record">{group.text}</p>{/if}
            {/each}
            {#each active.filter((p) => !paragraphGroups.some((g) => g.ref === p.id)) as p (p.id)}
              {@render textPassage(p.id, p.text)}
            {/each}
            {#if !active.length && !paragraphGroups.length}<p>
                {textLoading
                  ? id
                    ? 'Membaca halaman…'
                    : 'Reading page…'
                  : id
                    ? 'Teks halaman ini belum tersedia.'
                    : 'Text for this page is unavailable.'}
              </p>{/if}
          </article>
        {:else if pdfUrl}<PdfSheet
            url={pdfUrl}
            pageNo={number}
            {zoom}
            {lang}
            highlight={selected?.page === number ? selected.text : query}
            {annotations}
            select={(id) => (inspect = { kind: 'passage', id })}
            ready={onReady}
          />{/if}
      </div>
      {#if selection}
        <div class="ev-tools">
          <span class="ev-meta">{id ? 'Teks terpilih' : 'Selected text'}</span>
          <div class="ev-actions">
            <button class="ev-button" onclick={() => sendSelection('assistant')}
              >{id ? 'Tanya asisten' : 'Ask assistant'}</button
            >
            <button class="ev-button" onclick={() => sendSelection('board')}
              >{id ? 'Taruh di papan' : 'Put on board'}</button
            >
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
{#if deleting}<DocumentRemoval
    workspace={w}
    {lang}
    {doc}
    close={() => (deleting = false)}
    removed={(result) =>
      goto(casePath(w) + '/documents', { invalidateAll: true, state: { judeRemovedDocument: result } })}
  />{/if}
{#if inspect}<Inspector workspace={w} {lang} target={inspect} close={() => (inspect = null)} />{/if}

<style>
  .reader-layout {
    display: grid;
    grid-template-areas: 'document index';
    grid-template-columns: minmax(0, 1fr) clamp(235px, 25%, 280px);
    gap: clamp(14px, 1.6vw, 24px);
    align-items: start;
  }
  .reader-layout > .ev-pane { grid-area: document; min-width: 0; }
  .reader-tools {
    margin: 0 0 0.65rem;
    border-top: 0;
    padding-top: 0;
  }
  .reading {
    min-height: 23rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--ink) 6%, var(--paper));
    border-radius: 0.65rem;
  }
  .transcript {
    min-height: 23rem;
    margin: auto;
    background: var(--surface);
    padding: clamp(1rem, 4vw, 3rem);
    color: var(--ink);
  }
  .transcript h2 {
    margin: 0 0 1.25rem;
    font-weight: 600;
  }
  .passage-block { display: grid; gap: 6px; min-width: 0; padding: 6px 8px; margin: 0 -8px 8px; border-radius: 4px; scroll-margin-top: 120px; }
  .passage { padding: 0; border: 0; color: var(--ink); font: 400 14.5px/1.75 var(--mono); background: transparent; text-align: start; cursor: pointer; }
  .passage:hover { text-decoration: underline; text-decoration-color: var(--line-strong); }
  .passage mark { background: var(--mark); color: var(--mark-ink); }
  .passage-block.focused { outline: 2px solid var(--focus); outline-offset: 0; }
  .finding-links { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; gap: 6px; }
  .lookup {
    padding: 0.75rem 0;
    max-height: 18rem;
    overflow: auto;
  }
  @container (max-width:760px) {
    .reader-layout {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    .reading {
      padding: 0.35rem;
    }
    .reader-tools {
      gap: 0.35rem;
    }
    .reader-tools .ev-icon {
      width: 39px;
    }
    .reader-tools .ev-inline {
      gap: 0.15rem;
    }
  }
</style>
