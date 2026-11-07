<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { ArrowUpRight, Check, ChevronDown, ChevronRight, Link2, SquarePlus } from '@lucide/svelte';
  import type { Board, Lang, Passage, Workspace } from '@jude/core/domain';
  import { api, ApiError } from '$lib/client';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import { apiPath, casePath } from './records';

  let { workspace, passages, pageNumber, selectedId, lang, inspect, permalink, citations }: {
    workspace: Workspace;
    passages: Passage[];
    pageNumber: number;
    selectedId?: string;
    lang: Lang;
    inspect: (passage: Passage) => void;
    permalink: (passage: Passage) => string;
    citations?: Snippet<[string]>;
  } = $props();

  const uid = $props.id();
  const here = $derived(passages.flatMap((p, i) => p.page === pageNumber ? [{ passage: p, n: i + 1 }] : []));
  const id = $derived(lang === 'id');
  const title = $derived(id ? 'Kutipan halaman ini' : 'On this page');
  let expanded = $state(false);
  let feedback = $state<{ id: string; copied: boolean; url: string }>();
  let manual = $state<HTMLInputElement>();
  let choosing = $state<Passage>();
  let targetId = $state('');
  let saving = $state('');
  let issue = $state('');
  let saved = $state<{passageId: string; board: Board}>();
  let interactive = $state(false);
  onMount(() => { interactive = true; });

  function contains(board: Board, p: Passage) {
    return board.cards.some(c => c.kind === 'passage' && c.id === p.id);
  }

  async function add(p: Passage, board?: Board) {
    if (saving) return;
    const controlId = uid + '-board-' + p.id;
    const opener = document.getElementById(controlId);
    const restore = document.activeElement === opener || choosing?.id === p.id;
    saving = p.id;
    issue = '';
    try {
      const card = { kind: 'passage', id: p.id };
      const result = board
        ? await api<Board>(apiPath(workspace, 'boards/' + encodeURIComponent(board.id) + '/cards'), 'POST', card)
        : await api<Board>(apiPath(workspace, 'boards/first'), 'POST', { name: id ? 'Papan 1' : 'Board 1', card });
      choosing = undefined;
      saved = { passageId: p.id, board: result };
      // The card is durable even if a subsequent workspace refresh is interrupted.
      await invalidateAll().catch(() => {});
      await tick();
      if (restore && (document.activeElement === document.body || document.activeElement === opener))
        document.getElementById(controlId)?.focus({preventScroll: true});
    } catch (error) {
      issue = error instanceof ApiError && error.status === 403
        ? (id ? 'Hanya editor perkara yang dapat menambahkan bukti ke papan.' : 'Only case editors can add evidence to a board.')
        : (id ? 'Kutipan belum tersimpan ke papan. Coba lagi.' : 'The passage could not be saved to the board. Try again.');
    } finally {
      saving = '';
    }
  }

  function startAdd(p: Passage) {
    issue = '';
    if (workspace.boards.length > 1) {
      choosing = p;
      targetId = workspace.boards.find(b => !contains(b, p))?.id ?? '';
    } else {
      void add(p, workspace.boards[0]);
    }
  }

  async function copy(passage: Passage) {
    const url = new URL(permalink(passage), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      feedback = { id: passage.id, copied: true, url };
    } catch {
      feedback = { id: passage.id, copied: false, url };
      await tick();
      manual?.focus();
      manual?.select();
    }
  }
</script>

<aside class="passage-index" data-tour="doc-passages" aria-labelledby={uid + '-title'}>
  <header>
    <h2 id={uid + '-title'}>
      <span class="wide-title">{title}</span>
      <button class="disclose" disabled={!interactive} aria-expanded={expanded} aria-controls={uid + '-entries'} onclick={() => expanded = !expanded}>
        <span>{title}</span>
        <span class="quantity">{here.length} {id ? 'kutipan' : here.length === 1 ? 'passage' : 'passages'}</span>
        <ChevronDown size={15} aria-hidden="true"/>
      </button>
    </h2>
    <span class="folio">{id ? 'Hal.' : 'p.'} {pageNumber}</span>
  </header>
  <div class="entries" class:expanded id={uid + '-entries'}>
    {#if here.length}
      <ol>
        {#each here as { passage, n } (passage.id)}
          {@const name = (id ? 'Kutipan ' : 'Passage ') + n}
          {@const copied = feedback?.id === passage.id && feedback.copied}
          {@const placed = workspace.boards.length && workspace.boards.every(b => contains(b, passage)) ? workspace.boards[0] : undefined}
          <li class:current={passage.id === selectedId}>
            <button class="preview" disabled={!interactive} aria-haspopup="dialog" aria-label={(id ? 'Buka ' : 'Open ') + name.toLowerCase()} onclick={() => inspect(passage)}>
              <span class="locator">{name}<ChevronRight size={13} aria-hidden="true"/></span>
              <span class="words">{passage.text}</span>
            </button>
            {@render citations?.(passage.id)}
            <div class="tools">
              <button disabled={!interactive} aria-label={(id ? 'Salin tautan' : 'Copy link') + ' · ' + name} onclick={() => copy(passage)}>
                {#if copied}<Check size={14} aria-hidden="true"/>{:else}<Link2 size={14} aria-hidden="true"/>{/if}
                <span>{copied ? (id ? 'Disalin' : 'Copied') : (id ? 'Salin tautan' : 'Copy link')}</span>
              </button>
              {#if placed}
                <a id={uid + '-board-' + passage.id} href={casePath(workspace) + '/findings?view=board&board=' + encodeURIComponent(placed.id)}
                  aria-label={(id ? 'Buka papan' : 'View board') + ' · ' + placed.name}>
                  <ArrowUpRight size={14} aria-hidden="true"/><span>{id ? 'Buka papan' : 'View board'}</span>
                </a>
              {:else}
                <button id={uid + '-board-' + passage.id} disabled={!interactive || !!saving} aria-busy={saving === passage.id} aria-haspopup={workspace.boards.length > 1 ? 'dialog' : undefined}
                  aria-label={(id ? 'Tambah ke papan' : 'Add to board') + ' · ' + name} onclick={() => startAdd(passage)}>
                  <SquarePlus size={14} aria-hidden="true"/><span>{id ? 'Tambah ke papan' : 'Add to board'}</span>
                </button>
              {/if}
            </div>
            {#if !placed && saved?.passageId === passage.id}
              <p class="saved">{id ? 'Ditambahkan ke' : 'Added to'} <a href={casePath(workspace) + '/findings?view=board&board=' + encodeURIComponent(saved.board.id)}>{saved.board.name}</a>.</p>
            {/if}
            {#if feedback?.id === passage.id && !feedback.copied}
              <label class="manual">{id ? 'Salin tautan ini' : 'Copy this link'}
                <input bind:this={manual} readonly value={feedback.url} onfocus={(e) => e.currentTarget.select()}/>
              </label>
            {/if}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="empty">{id ? 'Belum ada kutipan bertanda pada halaman ini.' : 'There are no indexed passages on this page.'}</p>
    {/if}
  </div>
  {#if issue && !choosing}<p class="empty" role="alert">{issue}</p>{/if}
  <span class="sr-only" role="status">{saved ? (id ? 'Kutipan ditambahkan ke ' : 'Passage added to ') + saved.board.name + '.' : ''}</span>
  <span class="sr-only" role="status">{feedback?.copied && here.some(({passage}) => passage.id === feedback?.id) ? (id ? 'Tautan kutipan disalin.' : 'Passage link copied.') : ''}</span>
</aside>
{#if choosing}
  {@const passage = choosing}
  <Dialog title={id ? 'Tambah ke papan' : 'Add to board'} {lang} close={() => { choosing = undefined; }}>
    <form class="choose" onsubmit={e => { e.preventDefault(); const board = workspace.boards.find(b => b.id === targetId); if (board) void add(passage, board); }}>
      <label>{id ? 'Pilih papan' : 'Choose board'}
        <select class="ev-field" bind:value={targetId}>
          {#each workspace.boards.filter(b => !contains(b, passage)) as board (board.id)}<option value={board.id}>{board.name}</option>{/each}
        </select>
      </label>
      {#if issue}<p class="empty" role="alert">{issue}</p>{/if}
      <button type="submit" class="ev-button primary" disabled={!targetId || !!saving}>{id ? 'Tambahkan' : 'Add'}</button>
    </form>
  </Dialog>
{/if}

<style>
  .passage-index { grid-area: index; min-width: 0; align-self: start; padding-inline-start: 17px; border-inline-start: 1px solid var(--line); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 1px 0 10px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; color: var(--ink-strong); font: 400 22px/1.15 var(--display); }
  .folio { white-space: nowrap; color: var(--muted); font: 400 12px/1.4 var(--mono); }
  .disclose { display: none; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { position: relative; min-width: 0; padding: 11px 0 7px; }
  li + li { border-top: 1px solid var(--line); }
  .preview { display: grid; width: 100%; gap: 5px; margin: 0; padding: 0; color: var(--ink); border: 0; background: transparent; text-align: start; border-radius: 3px; }
  .locator { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted-on-fill); font: 700 12px/1.4 var(--sans); }
  .locator :global(svg) { flex: none; color: var(--muted); }
  .current .locator, .preview:hover .locator { color: var(--accent); }
  .preview:hover .words { text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
  .words { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; font: 400 13px/1.5 var(--mono); }
  li :global(.finding-links) { margin-top: 7px; }
  .tools { display: flex; align-items: center; flex-wrap: wrap; gap: 0 12px; margin-top: 5px; }
  .tools :is(button,a) { display: inline-flex; align-items: center; min-height: 30px; gap: 5px; padding: 1px 0; border: 0; border-radius: 3px; color: var(--muted-on-fill); background: transparent; font: 600 12px/1.35 var(--sans); text-decoration: none; }
  .tools :is(button,a):hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
  .tools :global(svg) { flex: none; stroke-width: 1.7; }
  .passage-index :is(button,a,input):focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  .empty, .manual { margin: 10px 0 0; color: var(--muted); font: 500 13px/1.5 var(--sans); }
  .saved { margin: 5px 0; color: var(--muted); font: 500 12px/1.5 var(--sans); }
  .saved a { color: var(--accent); text-underline-offset: 2px; }
  .choose, .choose label { display: grid; gap: 8px; }
  .choose > button { justify-self: end; margin-top: 12px; }
  .manual { display: grid; gap: 4px; }
  .manual input { width: 100%; min-width: 0; padding: 6px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 4px; }
  @media(pointer: coarse) { .tools :is(button,a) { min-height: 44px; } .preview { min-height: 44px; } }
  @container (max-width:760px) {
    .passage-index { order: -1; width: 100%; padding: 0; border: 0; border-bottom: 1px solid var(--line); }
    header { padding: 0; border: 0; }
    h2 { width: 100%; }
    .wide-title, .folio { display: none; }
    .disclose { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 5px 0; border: 0; color: var(--ink-strong); background: transparent; text-align: start; font: 400 20px/1.2 var(--display); }
    .quantity { margin-inline-start: auto; color: var(--muted); font: 600 12px/1.4 var(--sans); }
    .disclose :global(svg) { color: var(--muted); }
    .disclose[aria-expanded='true'] :global(svg) { transform: rotate(180deg); }
    .entries { display: none; }
    .entries.expanded { display: block; border-top: 1px solid var(--line); }
    .empty { margin: 10px 0 14px; }
  }
</style>
