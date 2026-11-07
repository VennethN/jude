<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import {
    Plus,
    Minus,
    ClipboardList,
    FileText,
    MessageSquare,
    Grip,
    Move,
    Lightbulb,
    Minimize2,
    PanelsTopLeft,
    Pencil,
    Link as LinkIcon,
    Trash2,
    ArrowUpRight,
    Maximize,
    X,
  } from '@lucide/svelte';
  import type { Board, BoardCard, BoardRef, Excerpt, Lang, Relation, Workspace } from '@jude/core/domain';
  import { needsReview } from '@jude/core/domain';
  import BoardLibrary from './board/BoardLibrary.svelte';
  import BoardSuggestion from './board/BoardSuggestion.svelte';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import { api, ApiError } from '$lib/client';
  import { apiPath, assistantPath, casePath, evidenceKey, relations, sourceOf } from './records';

  let { workspace: w, lang }: { workspace: Workspace; lang: Lang } = $props();
  let id = $derived(lang === 'id');
  let interactive = $state(false);
  onMount(() => {
    interactive = true;
  });
  let requested = $derived(page.url.searchParams.get('board'));
  let dataBoard = $derived(w.boards.find((b) => b.id === requested) || w.boards[0]);
  const workingBoard = $derived<Board>({
    id: '',
    name: id ? 'Papan 1' : 'Board 1',
    cards: [],
    links: [],
    excerpts: {},
    suggest: true,
    dismissed: [],
    updated: 0,
    version: 0,
  });
  let recent = $state<Board>();
  let removed = $state<{ id: string; name: string }>();
  let board = $derived(
    recent && recent.id === dataBoard?.id && recent.version >= dataBoard.version
      ? recent
      : (dataBoard ?? workingBoard),
  );
  let selected = $state(''),
    focused = $state(false),
    picker = $state(false),
    editor = $state(false),
    name = $state(''),
    mode = $state<'new' | 'rename' | 'delete' | null>(null);
  let problem = $state(''),
    busy = $state(false),
    feedback = $state(''),
    note = $state('');
  let linkTo = $state(''),
    linkName = $state(''),
    relation = $state<Relation>('related');
  let zoom = $state(1),
    pane = $state<HTMLDivElement>();
  let drag = $state<{
    key: string;
    px: number;
    py: number;
    x: number;
    y: number;
    nx: number;
    ny: number;
  } | null>(null);
  let selection = $derived(board?.cards.find((c) => c.key === selected));
  let item = $derived(selection ? sourceOf(w, selection, lang, board) : undefined);
  let start = $derived(page.url.searchParams.get('start'));
  let pickedExcerpt = $derived((page.state as { judeExcerpt?: Excerpt }).judeExcerpt);
  let excerpt = $derived(pickedExcerpt?.text),
    docId = $derived(pickedExcerpt?.docId || ''),
    pageNumber = $derived(pickedExcerpt?.page || 1);
  let candidates = $derived.by(() => {
    const list: BoardRef[] = [
      ...w.findings.map((f) => ({ kind: 'finding' as const, id: f.id })),
      ...w.documents.map((d) => ({ kind: 'document' as const, id: d.id })),
      ...w.passages.map((p) => ({ kind: 'passage' as const, id: p.id })),
      ...w.statements.map((s) => ({ kind: 'statement' as const, id: s.id })),
    ];
    return list
      .map((ref) => ({ ref, source: sourceOf(w, ref, lang), key: evidenceKey(ref) }))
      .filter((entry) => entry.source);
  });
  let first = $derived(candidates.find((c) => c.key === start));
  let suggested = $derived.by(() => {
    if (!board?.suggest) return [];
    const present = new Set(board.cards.map((c) => c.key)),
      keys = new Set<string>();
    for (const c of w.connections) {
      const from = evidenceKey(c.from),
        to = evidenceKey(c.to);
      if (present.has(from) && !present.has(to)) keys.add(to);
      if (present.has(to) && !present.has(from)) keys.add(from);
    }
    for (const c of board.cards.filter((c) => c.kind === 'finding')) {
      const f = w.findings.find((f) => f.id === c.id);
      if (f) {
        keys.add('statement:' + f.statementId);
        for (const s of f.sources) keys.add('passage:' + s.passageId);
      }
    }
    if (!board.cards.length) {
      const times = new Map(w.statements.map((s) => [s.id, s.t]));
      return w.findings
        .filter((f) => needsReview(f) && !board.dismissed.includes('finding:' + f.id))
        .sort((a, b) => (times.get(a.statementId) ?? Infinity) - (times.get(b.statementId) ?? Infinity))
        .slice(0, 3)
        .map((f) => candidates.find((c) => c.key === 'finding:' + f.id)!);
    }
    return candidates
      .filter((c) => keys.has(c.key) && !present.has(c.key) && !board?.dismissed.includes(c.key))
      .slice(0, 4);
  });
  let width = $derived(
    Math.max(780, ...(board?.cards.map((c) => c.x + 275) ?? []), drag ? drag.nx + 275 : 0),
  );
  let height = $derived(
    Math.max(380, ...(board?.cards.map((c) => c.y + 165) ?? []), drag ? drag.ny + 165 : 0),
  );
  function url(b?: string) {
    const params = new URLSearchParams({ view: 'board' });
    if (b) params.set('board', b);
    return casePath(w) + '/findings?' + params;
  }
  function kindName(kind: BoardRef['kind']) {
    return {
      finding: id ? 'Temuan' : 'Finding',
      statement: id ? 'Pernyataan' : 'Statement',
      document: id ? 'Dokumen' : 'Document',
      passage: id ? 'Kutipan' : 'Passage',
      excerpt: id ? 'Pilihan teks' : 'Excerpt',
    }[kind];
  }
  function select(card: BoardCard) {
    selected = card.key;
    note = card.note || '';
    linkTo = '';
    linkName = '';
    editor = false;
  }
  async function persist(change: (draft: Board) => void) {
    if (busy) return;
    busy = true;
    problem = '';
    feedback = '';
    try {
      const current = board.id
        ? board
        : await api<Board>(apiPath(w, 'boards/first'), 'POST', { name: workingBoard.name });
      const draft = structuredClone($state.snapshot(current));
      change(draft);
      recent = await api<Board>(apiPath(w, 'boards/' + encodeURIComponent(current.id)), 'PUT', draft);
      await invalidateAll();
      if (!requested || requested !== recent.id || start || excerpt)
        await goto(url(recent.id), { replaceState: true, noScroll: true });
      feedback = id ? 'Tersimpan.' : 'Saved.';
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        recent = undefined;
        await invalidateAll();
        problem = id
          ? 'Papan berubah di tempat lain. Periksa perubahan lalu ulangi.'
          : 'The board changed elsewhere. Review it and try again.';
      } else problem = e instanceof Error ? e.message : id ? 'Penyimpanan gagal.' : 'Save failed.';
    } finally {
      busy = false;
    }
  }
  async function boardAction() {
    if (busy) return;
    if (mode === 'rename') {
      if (!name.trim()) return;
      await persist((b) => {
        b.name = name.trim();
      });
    } else {
      const action = mode;
      if (action !== 'delete' && !name.trim()) return;
      busy = true;
      problem = '';
      try {
        if (action === 'delete' && board) {
          const deleting = { id: board.id, name: board.name };
          await api(apiPath(w, 'boards/' + encodeURIComponent(deleting.id)), 'DELETE');
          removed = deleting;
          recent = undefined;
          await invalidateAll();
          await goto(url(), { replaceState: true });
        }
        if (action === 'new') {
          const created = await api<Board>(apiPath(w, 'boards'), 'POST', { name: name.trim() });
          await invalidateAll();
          await goto(url(created.id), { replaceState: true });
        }
        selected = '';
      } catch (e) {
        problem = e instanceof Error ? e.message : id ? 'Perubahan gagal.' : 'Change failed.';
      } finally {
        busy = false;
      }
    }
    if (!problem) mode = null;
  }
  async function restoreBoard() {
    if (!removed || busy) return;
    busy = true;
    problem = '';
    try {
      const restored = await api<Board>(
        apiPath(w, 'boards/' + encodeURIComponent(removed.id) + '/restore'),
        'POST',
        {},
      );
      removed = undefined;
      await invalidateAll();
      await goto(url(restored.id), { replaceState: true, noScroll: true });
      feedback = id ? 'Papan dipulihkan.' : 'Board restored.';
    } catch (e) {
      problem =
        e instanceof Error ? e.message : id ? 'Papan belum dipulihkan.' : 'Could not restore the board.';
    } finally {
      busy = false;
    }
  }
  let excerptAttempt = { signature: '', key: '' };
  async function add(ref: BoardRef, custom?: string, position?: { x: number; y: number }) {
    if (busy) return;
    busy = true;
    problem = '';
    feedback = '';
    try {
      const card = custom
        ? { kind: 'excerpt', docId, page: pageNumber, text: custom, passageId: pickedExcerpt?.passageId }
        : { ...ref, ...position };
      let headers: HeadersInit | undefined;
      if (custom) {
        const signature = JSON.stringify([w.caseRecord.id, board.id, card]);
        if (excerptAttempt.signature !== signature) excerptAttempt = { signature, key: crypto.randomUUID() };
        headers = { 'Idempotency-Key': excerptAttempt.key };
      }
      const saved = board.id
        ? await api<Board>(
            apiPath(w, 'boards/' + encodeURIComponent(board.id) + '/cards'),
            'POST',
            card,
            headers,
          )
        : await api<Board>(apiPath(w, 'boards/first'), 'POST', { name: workingBoard.name, card }, headers);
      recent = saved;
      await invalidateAll();
      if (requested !== saved.id || start || custom)
        await goto(url(saved.id), { replaceState: true, noScroll: true });
      const added = custom
        ? saved.cards.findLast((c) => c.kind === 'excerpt' && saved.excerpts[c.id]?.text === custom)
        : saved.cards.find((c) => c.key === evidenceKey(ref));
      if (added) select(added);
      excerptAttempt = { signature: '', key: '' };
      picker = false;
      feedback = id ? 'Tersimpan.' : 'Saved.';
    } catch (e) {
      problem =
        e instanceof Error ? e.message : id ? 'Bukti belum tersimpan.' : 'Could not save the evidence.';
    } finally {
      busy = false;
    }
  }
  function dropEvidence(e: DragEvent) {
    e.preventDefault();
    const candidate = candidates.find(
      (c) => c.key === e.dataTransfer?.getData('application/x-jude-board-ref'),
    );
    const surface = pane ?? (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.empty-canvas');
    if (!candidate || !surface) return;
    const rect = surface.getBoundingClientRect();
    void add(candidate.ref, undefined, {
      x: Math.max(0, Math.round((e.clientX - rect.left + surface.scrollLeft) / zoom - 18)),
      y: Math.max(0, Math.round((e.clientY - rect.top + surface.scrollTop) / zoom - 18)),
    });
  }
  function allowDrop(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/x-jude-board-ref')) e.preventDefault();
  }
  async function leaveFocus() {
    focused = false;
    await tick();
    document.querySelector<HTMLButtonElement>('[data-board-focus-toggle]')?.focus();
  }
  function openDialog(dialog: HTMLDialogElement) {
    dialog.showModal();
    return {
      destroy() {
        dialog.close();
      },
    };
  }
  function shortcut(event: KeyboardEvent) {
    if (
      !focused ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.defaultPrevented ||
      event.isComposing ||
      (event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.matches('textarea,input,select')))
    )
      return;
    if (document.querySelectorAll('dialog[open]').length > 1) return;
    if (event.key === '+' || event.key === '=') zoom = Math.min(1.6, zoom + 0.1);
    else if (event.key === '-') zoom = Math.max(0.3, zoom - 0.1);
    else if (event.key === '0') zoom = 1;
    else return;
    event.preventDefault();
  }
  function dismiss(key: string) {
    void persist((b) => {
      if (!b.dismissed.includes(key)) b.dismissed.push(key);
    });
  }
  async function remove() {
    await persist((b) => {
      b.cards = b.cards.filter((c) => c.key !== selected);
      b.links = b.links.filter((l) => l.from !== selected && l.to !== selected);
      if (selection?.kind === 'excerpt') delete b.excerpts[selection.id];
    });
    if (!problem) selected = '';
  }
  function move(key: string, x: number, y: number) {
    return persist((b) => {
      const c = b.cards.find((c) => c.key === key);
      if (c) {
        c.x = Math.round(Math.max(0, x));
        c.y = Math.round(Math.max(0, y));
      }
    });
  }
  function startDrag(e: PointerEvent, card: BoardCard) {
    if (busy || e.button !== 0) return;
    select(card);
    e.currentTarget instanceof Element && e.currentTarget.setPointerCapture(e.pointerId);
    drag = { key: card.key, px: e.clientX, py: e.clientY, x: card.x, y: card.y, nx: card.x, ny: card.y };
  }
  function pointerMove(e: PointerEvent) {
    if (drag) {
      drag.nx = Math.max(0, drag.x + (e.clientX - drag.px) / zoom);
      drag.ny = Math.max(0, drag.y + (e.clientY - drag.py) / zoom);
    }
  }
  function endDrag() {
    const p = drag;
    drag = null;
    if (p && (p.x !== p.nx || p.y !== p.ny)) void move(p.key, p.nx, p.ny);
  }
  function position(key: string) {
    const c = board?.cards.find((c) => c.key === key);
    return { x: drag?.key === key ? drag.nx : (c?.x ?? 0), y: drag?.key === key ? drag.ny : (c?.y ?? 0) };
  }
  function arrow(e: KeyboardEvent, c: BoardCard) {
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = offsets[e.key];
    if (d) {
      e.preventDefault();
      const step = e.shiftKey ? 50 : 10;
      void move(c.key, c.x + d[0] * step, c.y + d[1] * step);
    }
  }
  function addLink() {
    if (!selection || !linkTo || linkTo === selected) return;
    void persist((b) => {
      if (!b.links.some((l) => l.from === selected && l.to === linkTo))
        b.links.push({
          id: crypto.randomUUID(),
          from: selected,
          to: linkTo,
          relation,
          label: linkName.trim(),
        });
    });
  }
  function fit() {
    if (pane) {
      zoom = Math.min(1, Math.max(0.3, pane.clientWidth / width));
      pane.scrollTo(0, 0);
    }
  }
  $effect(() => {
    const cur = dataBoard?.id;
    untrack(() => {
      if (recent && cur !== recent.id) {
        recent = undefined;
        selected = '';
        editor = false;
      }
    });
  });
</script>

<svelte:window onkeydown={shortcut} />
{#snippet library()}
  <BoardLibrary
    workspace={w}
    {lang}
    placed={board.cards.map((c) => c.key)}
    disabled={busy || !interactive}
    pick={(ref) => void add(ref)}
  />
{/snippet}
{#snippet suggestions()}
  {#each suggested as candidate (candidate.key)}
    <BoardSuggestion
      workspace={w}
      {lang}
      ref={candidate.ref}
      disabled={busy || !interactive}
      accept={() => void add(candidate.ref)}
      dismiss={() => dismiss(candidate.key)}
    />
  {/each}
{/snippet}
{#snippet content()}
  <div class="board-work" class:expanded={focused}>
    <div class="ev-tools board-tools">
      <div class="board-identity">
        <PanelsTopLeft size={16} aria-hidden="true" />
        <select
          class="board-select"
          aria-label={id ? 'Pilih papan' : 'Choose board'}
          value={board.id}
          disabled={!interactive || busy}
          onchange={(e) => {
            selected = '';
            goto(url(e.currentTarget.value));
          }}
        >
          {#if !w.boards.length}<option value="">{workingBoard.name}</option>{/if}
          {#each w.boards as b}<option value={b.id}>{b.name}</option>{/each}
        </select>
      </div>
      <button
        class="ev-icon manage"
        disabled={!interactive || busy}
        aria-label={id ? 'Papan baru' : 'New board'}
        title={id ? 'Papan baru' : 'New board'}
        onclick={() => {
          mode = 'new';
          name = '';
        }}><Plus size={16} /></button
      >
      {#if board.id}
        <button
          class="ev-icon manage"
          disabled={!interactive || busy}
          aria-label={id ? 'Ganti nama papan' : 'Rename board'}
          title={id ? 'Ganti nama papan' : 'Rename board'}
          onclick={() => {
            mode = 'rename';
            name = board.name;
          }}><Pencil size={15} /></button
        >
        <button
          class="ev-icon manage"
          disabled={!interactive || busy}
          aria-label={id ? 'Hapus papan' : 'Delete board'}
          title={id ? 'Hapus papan' : 'Delete board'}
          onclick={() => (mode = 'delete')}><Trash2 size={15} /></button
        >
      {/if}
      <button
        class="ev-button tray-toggle"
        aria-expanded={picker}
        data-tour="board-add"
        disabled={!interactive || busy}
        onclick={() => (picker = true)}><Plus size={15} />{id ? 'Tambahkan' : 'Add'}</button
      >
      <button
        class="ev-button suggest-toggle"
        aria-pressed={board.suggest}
        disabled={!interactive || busy}
        onclick={() =>
          persist((b) => {
            b.suggest = !b.suggest;
          })}><Lightbulb size={15} />{id ? 'Saran' : 'Suggestions'}<span aria-hidden="true"></span></button
      >
      {#if board.id && board.cards.length}<a
          class="ev-button ask"
          href={assistantPath(w, { kind: 'board', id: board.id })}
          ><MessageSquare size={15} />{id ? 'Tanya asisten tentang papan' : 'Ask about this board'}</a
        >
      {:else}<button
          class="ev-button ask"
          disabled
          title={id ? 'Tambahkan kartu untuk bertanya tentang papan.' : 'Add a card to ask about this board.'}
          ><MessageSquare size={15} />{id ? 'Tanya asisten tentang papan' : 'Ask about this board'}</button
        >{/if}
      <span class="board-count"
        >{board.cards.length}
        {id ? 'kartu' : board.cards.length === 1 ? 'card' : 'cards'} · {board.links.length}
        {id ? 'garis' : board.links.length === 1 ? 'link' : 'links'}</span
      >
      <button
        class="ev-button focus-toggle"
        data-board-focus-toggle
        disabled={!interactive}
        onclick={() => (focused ? leaveFocus() : (focused = true))}
        >{#if focused}<Minimize2 size={15} />{id
            ? 'Keluar dari mode papan'
            : 'Exit board mode'}{:else}<Maximize size={15} />{id ? 'Mode papan' : 'Board mode'}{/if}</button
      >
    </div>
    {#if mode}<form
        class="ev-notice"
        onsubmit={(e) => {
          e.preventDefault();
          boardAction();
        }}
      >
        {#if mode === 'delete'}<p>
            {id ? 'Hapus papan dan susunan kartunya?' : 'Delete this board and its card arrangement?'}
          </p>{:else}<label class="ev-field-label"
            >{id ? 'Nama papan' : 'Board name'}<input
              class="ev-field"
              maxlength="100"
              required
              bind:value={name}
            /></label
          >{/if}
        <div class="ev-actions">
          <button class="ev-button" type="button" onclick={() => (mode = null)}
            >{id ? 'Batal' : 'Cancel'}</button
          ><button class="ev-button primary" disabled={busy}
            >{mode === 'delete' ? (id ? 'Hapus' : 'Delete') : id ? 'Simpan' : 'Save'}</button
          >
        </div>
      </form>{/if}
    {#if first && !board?.cards.some((c) => c.key === first?.key)}<div class="ev-notice ev-inline">
        <strong>{first.source?.label}</strong><button
          class="ev-button"
          disabled={busy}
          onclick={() => first && add(first.ref)}>{id ? 'Tambahkan ke papan' : 'Add to board'}</button
        >
      </div>{/if}
    {#if excerpt && w.documents.some((d) => d.id === docId)}<div class="ev-notice">
        <blockquote class="ev-record">{excerpt}</blockquote>
        <button
          class="ev-button"
          disabled={busy}
          onclick={() => add({ kind: 'excerpt', id: crypto.randomUUID() }, excerpt!)}
          >{id ? 'Tambahkan pilihan teks' : 'Add selected text'}</button
        >
      </div>{/if}
    {#if picker}<Dialog
        title={id ? 'Tambahkan ke papan' : 'Add to the board'}
        {lang}
        close={() => (picker = false)}
        side
        ><div class="tray-dialog">
          <button
            class="ev-icon close-tray"
            aria-label={id ? 'Tutup pemilih bukti' : 'Close evidence picker'}
            onclick={() => (picker = false)}><X size={18} /></button
          >{@render library()}
        </div></Dialog
      >{/if}
    {#if removed}<div class="ev-notice ev-inline" role="status">
        <span>{removed.name} · {id ? 'Papan dihapus.' : 'Board deleted.'}</span>
        <button class="ev-button" disabled={busy} onclick={restoreBoard}>{id ? 'Urungkan' : 'Undo'}</button>
      </div>{/if}
    {#if problem}<p class="ev-error" role="alert">{problem}</p>{/if}
    <p class="ev-meta save-state" role="status">{busy ? (id ? 'Menyimpan…' : 'Saving…') : feedback}</p>
    {#if !board.cards.length && suggested.length}<p class="start-hint">
        <Lightbulb size={15} />{id
          ? 'Belum ada kartu. Temuan yang perlu dilihat bisa jadi awal.'
          : 'No cards yet. Start with a finding that needs review.'}
      </p>{/if}
    <div class="board-grid">
      <div
        class="board-view"
        role="region"
        aria-label={id ? 'Papan bukti' : 'Evidence board'}
        ondragover={allowDrop}
        ondrop={dropEvidence}
      >
        {#if board.cards.length}
          <div class="board-pane" data-tour="board-canvas" bind:this={pane}>
            <div class="board-space" style:width={width * zoom + 'px'} style:height={height * zoom + 'px'}>
              <div
                class="board-scene"
                style:width={width + 'px'}
                style:height={height + 'px'}
                style:transform={'scale(' + zoom + ')'}
              >
                <svg class="lines" {width} {height} aria-hidden="true"
                  >{#each board.links as l (l.id)}{@const a = position(l.from)}{@const b = position(
                      l.to,
                    )}<line
                      x1={a.x + 117}
                      y1={a.y + 62}
                      x2={b.x + 117}
                      y2={b.y + 62}
                      data-relation={l.relation}
                    />{/each}</svg
                >
                {#each board.cards as card (card.key)}{@const src = sourceOf(
                    w,
                    card,
                    lang,
                    board,
                  )}{@const pos = position(card.key)}
                  <button
                    class="board-card"
                    class:current={selected === card.key}
                    aria-pressed={selected === card.key}
                    style:transform={'translate(' + pos.x + 'px,' + pos.y + 'px)'}
                    onclick={() => select(card)}
                    onkeydown={(e) => arrow(e, card)}
                    onpointerdown={(e) => startDrag(e, card)}
                    onpointermove={pointerMove}
                    onpointerup={endDrag}
                    onpointercancel={() => (drag = null)}
                  >
                    <span class="ev-cap"
                      >{#if card.kind === 'finding'}<ClipboardList
                          size={14}
                        />{:else if card.kind === 'statement'}<MessageSquare size={14} />{:else}<FileText
                          size={14}
                        />{/if}{kindName(card.kind)}<Grip size={14} /></span
                    ><strong>{src?.label}</strong><span
                      class="snippet"
                      class:ev-record={card.kind === 'passage' || card.kind === 'excerpt'}
                      >{card.note || src?.text}</span
                    >
                  </button>
                {/each}
              </div>
            </div>
          </div>
          <ul class="ev-list mobile-board">
            {#each board.cards as card (card.key)}{@const src = sourceOf(w, card, lang, board)}
              <li>
                <button
                  class="ev-pick"
                  onclick={() => select(card)}
                  aria-current={selected === card.key ? 'true' : undefined}
                  ><span class="ev-meta">{kindName(card.kind)}</span><strong>{src?.label}</strong><span
                    >{card.note || src?.text}</span
                  ></button
                >
              </li>{/each}
          </ul>
        {:else}
          <div class="empty-canvas" data-tour="board-canvas">
            <div class="empty-plane" style:zoom>
              {#if suggested.length}<div class="canvas-suggestions">{@render suggestions()}</div>{/if}
              <div class="drop-hint">
                <PanelsTopLeft size={22} aria-hidden="true" />
                <p>
                  {id
                    ? 'Seret bukti dari daftar di kanan, atau pilih untuk menaruhnya di papan.'
                    : 'Drag evidence from the tray or choose an item to place it on the board.'}
                </p>
              </div>
            </div>
          </div>
          <section class="empty-mobile" data-tour="board-canvas">
            <PanelsTopLeft size={22} aria-hidden="true" />
            <p>
              {id
                ? 'Papan masih kosong. Tambahkan temuan, ucapan di sidang, kutipan, atau dokumen.'
                : 'Your board is empty. Add a finding, a line of testimony, a passage, or a document.'}
            </p>
            <button class="ev-button primary" disabled={!interactive || busy} onclick={() => (picker = true)}
              ><Plus size={16} />{id ? 'Tambahkan' : 'Add'}</button
            >
          </section>
        {/if}
        <div class="zoom-tools" aria-label={id ? 'Perbesaran' : 'Zoom'} role="group">
          <button
            aria-label={id ? 'Perkecil' : 'Zoom out'}
            disabled={!interactive || zoom <= 0.3}
            onclick={() => (zoom = Math.max(0.3, zoom - 0.1))}><Minus size={15} /></button
          ><button
            aria-label={id ? 'Kembali ke 100%' : 'Reset zoom'}
            disabled={!interactive}
            onclick={() => (zoom = 1)}>{Math.round(zoom * 100)}%</button
          ><button
            aria-label={id ? 'Perbesar' : 'Zoom in'}
            disabled={!interactive || zoom >= 1.6}
            onclick={() => (zoom = Math.min(1.6, zoom + 0.1))}><Plus size={15} /></button
          ><button
            aria-label={id ? 'Muat semua kartu' : 'Fit all cards'}
            disabled={!interactive || !board.cards.length}
            onclick={fit}><Maximize size={14} /></button
          >
        </div>
      </div>
      <aside class="desktop-library" data-tour="board-add">{@render library()}</aside>
    </div>
    {#if selected && selection && item}<section class="card-editor ev-notice">
        <header class="ev-inline">
          <h2 class="ev-title">{item.label}</h2>
          <button
            class="ev-icon"
            aria-label={id ? 'Tutup detail' : 'Close detail'}
            onclick={() => (selected = '')}><X size={16} /></button
          >
        </header>
        <blockquote class:ev-record={selection.kind === 'passage' || selection.kind === 'excerpt'}>
          {item.text}
        </blockquote>
        <div class="ev-actions">
          <a class="ev-button" href={item.href}
            >{id ? 'Buka sumber' : 'Open source'}<ArrowUpRight size={14} /></a
          ><button class="ev-button" onclick={() => (editor = !editor)}
            ><Pencil size={14} />{id ? 'Ubah kartu' : 'Edit card'}</button
          ><button class="ev-button" disabled={busy} onclick={remove}
            ><Trash2 size={14} />{id ? 'Keluarkan dari papan' : 'Remove from board'}</button
          >
        </div>
        {#if selection.note && !editor}<p>{selection.note}</p>{/if}
        {#if editor}<label class="ev-field-label"
            >{id ? 'Catatan kartu' : 'Card note'}<textarea class="ev-textarea" bind:value={note}
            ></textarea></label
          ><button
            class="ev-button"
            disabled={busy}
            onclick={() =>
              persist((b) => {
                const c = b.cards.find((c) => c.key === selected);
                if (c) c.note = note;
              })}>{id ? 'Simpan catatan' : 'Save note'}</button
          >
          <div class="ev-inline movement">
            <Move
              size={16}
            />{#each [[-30, 0, id ? 'Kiri' : 'Left'], [30, 0, id ? 'Kanan' : 'Right'], [0, -30, id ? 'Atas' : 'Up'], [0, 30, id ? 'Bawah' : 'Down']] as direction}<button
                class="ev-button"
                disabled={busy}
                onclick={() =>
                  selection &&
                  move(selected, selection.x + Number(direction[0]), selection.y + Number(direction[1]))}
                >{direction[2]}</button
              >{/each}
          </div>
          {#if board && board.cards.length > 1}<form
              onsubmit={(e) => {
                e.preventDefault();
                addLink();
              }}
            >
              <label class="ev-field-label"
                >{id ? 'Hubungkan ke kartu' : 'Connect to card'}<select
                  class="ev-select"
                  bind:value={linkTo}
                  required
                  ><option value="">{id ? 'Pilih kartu' : 'Choose a card'}</option
                  >{#each board.cards.filter((c) => c.key !== selected) as c}<option value={c.key}
                      >{sourceOf(w, c, lang, board)?.label}</option
                    >{/each}</select
                ></label
              >
              <label class="ev-field-label"
                >{id ? 'Relasi' : 'Relation'}<select class="ev-select" bind:value={relation}
                  >{#each Object.entries(relations) as [r, l]}<option value={r}>{l[lang]}</option
                    >{/each}</select
                ></label
              ><label class="ev-field-label"
                >{id ? 'Nama garis (opsional)' : 'Line label (optional)'}<input
                  class="ev-field"
                  bind:value={linkName}
                /></label
              ><button class="ev-button" disabled={busy || !linkTo}
                ><LinkIcon size={15} />{id ? 'Hubungkan' : 'Connect'}</button
              >
            </form>{/if}
        {/if}
      </section>{/if}
    {#if board}
      {#if board.links.length}<details class="lines-list">
          <summary>{id ? 'Garis pada papan' : 'Board connections'} ({board.links.length})</summary>
          <ul class="ev-list">
            {#each board.links as l (l.id)}
              {@const a = board.cards.find((c) => c.key === l.from)}{@const b = board.cards.find(
                (c) => c.key === l.to,
              )}
              <li class="ev-row">
                <span
                  >{a ? sourceOf(w, a, lang, board)?.label : ''} —
                  <strong>{l.label || relations[l.relation][lang]}</strong>
                  — {b ? sourceOf(w, b, lang, board)?.label : ''}</span
                ><button
                  class="ev-icon"
                  disabled={busy}
                  aria-label={id ? 'Hapus garis' : 'Remove line'}
                  onclick={() =>
                    persist((b) => {
                      b.links = b.links.filter((e) => e.id !== l.id);
                    })}><Trash2 size={15} /></button
                >
              </li>{/each}
          </ul>
        </details>{/if}
      {#if suggested.length}<section
          class="related-suggestions"
          class:initial={!board.cards.length}
          aria-label={id ? 'Bukti yang disarankan' : 'Suggested evidence'}
        >
          <h2><Lightbulb size={15} />{id ? 'Saran' : 'Suggestions'}</h2>
          <div>{@render suggestions()}</div>
        </section>{/if}
    {/if}
  </div>
{/snippet}
{#if focused}<dialog
    class="board-focus"
    aria-label={id ? 'Mode papan' : 'Board mode'}
    use:openDialog
    oncancel={(e) => {
      e.preventDefault();
      void leaveFocus();
    }}
  >
    {@render content()}
  </dialog>{:else}{@render content()}{/if}

<style>
  .board-tools {
    margin-bottom: 0.5rem;
  }
  .save-state:empty {
    display: none;
  }
  .save-state {
    margin: 0.4rem 0;
    color: var(--muted);
  }
  .board-pane {
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 0.65rem;
    background: var(--paper);
    background-image: radial-gradient(var(--line) 1px, transparent 1px);
    background-size: 20px 20px;
    max-height: 66vh;
    min-height: 20rem;
    overscroll-behavior: contain;
  }
  .board-space,
  .board-scene {
    position: relative;
    transform-origin: top left;
  }
  .lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .lines line {
    stroke: var(--muted);
    stroke-width: 2;
  }
  .lines line[data-relation='conflicts'] {
    stroke: var(--ev-conflicts);
  }
  .lines line[data-relation='context'] {
    stroke: var(--ev-context);
  }
  .lines line[data-relation='supports'] {
    stroke: var(--ev-supports);
  }
  .board-card {
    position: absolute;
    top: 0;
    left: 0;
    width: 230px;
    height: 134px;
    border: 1px solid var(--line);
    border-radius: 0.55rem;
    background: var(--surface);
    color: var(--ink);
    text-align: start;
    padding: 0.7rem 0.85rem;
    display: grid;
    align-content: start;
    gap: 0.28rem;
    cursor: grab;
    touch-action: none;
    font: inherit;
    overflow: hidden;
  }
  .board-card:active {
    cursor: grabbing;
  }
  .board-card.current {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .board-card .ev-cap {
    color: var(--muted);
  }
  .board-card .ev-cap :global(svg:last-child) {
    margin-left: auto;
  }
  .board-card strong {
    font-size: 0.94rem;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .snippet {
    font-size: 0.81rem;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-editor {
    margin-top: 1rem;
  }
  .card-editor header {
    justify-content: space-between;
  }
  .card-editor blockquote {
    margin: 0.8rem 0;
  }
  .movement,
  .lines-list {
    margin: 1rem 0;
  }
  .lines-list summary {
    cursor: pointer;
    padding: 0.6rem 0;
  }
  .board-work {
    min-width: 0;
  }
  .board-tools {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 7px;
    padding: 0;
    border: 0;
  }
  .board-identity {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-inline: 9px 4px;
    min-height: 36px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .board-select {
    max-width: 13em;
    background: transparent;
    border: 0;
    color: var(--ink);
    font: 500 0.83rem/1.3 var(--sans);
  }
  .board-count {
    margin-left: auto;
    white-space: nowrap;
    color: var(--muted);
    font-size: 0.79rem;
    font-variant-numeric: tabular-nums;
  }
  .suggest-toggle[aria-pressed='true'] {
    background: var(--wash);
    border-color: color-mix(in srgb, var(--forest) 38%, var(--line));
  }
  .suggest-toggle span {
    display: inline-flex;
    align-items: center;
    width: 28px;
    height: 17px;
    padding: 2px;
    border-radius: 99px;
    background: var(--muted);
  }
  .suggest-toggle span::after {
    content: '';
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--surface);
  }
  .suggest-toggle[aria-pressed='true'] span {
    justify-content: flex-end;
    background: var(--forest);
  }
  .start-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px dashed var(--line);
    border-radius: 7px;
    padding: 8px 11px;
    background: var(--surface);
    color: var(--muted);
    font-size: 0.81rem;
    margin: 10px 0;
  }
  .board-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 30.5%);
    align-items: start;
    gap: 14px;
  }
  .board-view {
    position: relative;
    min-width: 0;
  }
  .desktop-library {
    min-width: 0;
  }
  .tray-toggle,
  .mobile-board,
  .empty-mobile {
    display: none;
  }
  .empty-canvas,
  .board-pane {
    height: clamp(410px, 64vh, 650px);
    border: 1px solid var(--line);
    border-radius: 12px;
    background-color: color-mix(in srgb, var(--paper) 65%, var(--surface));
    background-image: radial-gradient(color-mix(in srgb, var(--muted) 32%, transparent) 1px, transparent 1px);
    background-size: 22px 22px;
  }
  .empty-canvas {
    position: relative;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .empty-plane {
    min-height: 100%;
    padding-block: 60px;
  }
  .canvas-suggestions {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 280px;
    gap: 96px;
    padding-inline: 40px;
    width: max-content;
  }
  .drop-hint {
    display: grid;
    place-items: center;
    gap: 6px;
    border: 2px dashed var(--line);
    border-radius: 9px;
    margin: 60px auto 0;
    text-align: center;
    width: min(440px, 85%);
    padding: 24px;
    color: var(--muted);
  }
  .canvas-suggestions + .drop-hint {
    margin-top: 44px;
  }
  .drop-hint p {
    margin: 0;
    font-size: 0.81rem;
  }
  .zoom-tools {
    position: absolute;
    bottom: 12px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 3px;
    background: var(--surface);
    box-shadow: 0 3px 9px #12251b1a;
  }
  .zoom-tools button {
    min-width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--ink);
    border: 0;
    border-radius: 4px;
    font-size: 0.78rem;
  }
  .zoom-tools button:disabled {
    color: var(--muted);
  }
  .related-suggestions {
    margin-top: 12px;
    padding: 13px;
    border: 1px dashed var(--line);
    border-radius: 10px;
  }
  .related-suggestions h2 {
    display: flex;
    gap: 7px;
    align-items: center;
    margin: 0 0 10px;
    font: 500 0.86rem var(--sans);
    color: var(--muted);
  }
  .related-suggestions > div {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .related-suggestions.initial {
    display: none;
  }
  .board-focus {
    inset: 0;
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 16px;
    border: 0;
    background: var(--paper);
    color: var(--ink);
    overflow: auto;
    container-type: inline-size;
  }
  .board-focus::backdrop {
    background: var(--paper);
  }
  .expanded .board-pane,
  .expanded .empty-canvas {
    height: calc(100dvh - 106px);
    max-height: none;
  }
  .tray-dialog {
    position: relative;
    padding: 10px 0;
  }
  .close-tray {
    position: absolute;
    top: 17px;
    right: 6px;
    z-index: 1;
  }
  @container (max-width:710px) {
    .board-tools {
      gap: 8px;
    }
    .board-tools .ask {
      order: 4;
    }
    .board-count {
      order: 5;
      display: block;
      flex-basis: 100%;
      text-align: right;
    }
    .board-tools .suggest-toggle {
      order: 3;
    }
    .board-tools .manage {
      width: 36px;
    }
    .board-identity {
      max-width: 50%;
    }
    .board-select {
      max-width: 100%;
    }
    .tray-toggle,
    .empty-mobile {
      display: flex;
    }
    .board-grid {
      display: block;
    }
    .desktop-library,
    .zoom-tools,
    .focus-toggle,
    .board-pane,
    .empty-canvas,
    .start-hint {
      display: none;
    }
    .empty-mobile {
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      text-align: center;
      min-height: 186px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
    }
    .empty-mobile > :global(svg) {
      box-sizing: content-box;
      background: var(--wash);
      border-radius: 50%;
      padding: 10px;
    }
    .empty-mobile p {
      margin: 0;
      color: var(--muted);
      font-size: 0.88rem;
    }
    .mobile-board,
    .related-suggestions.initial {
      display: block;
    }
    .related-suggestions > div {
      grid-template-columns: 1fr;
    }
    .card-editor .ev-title {
      font-size: 1.35rem;
    }
    .expanded .empty-canvas,
    .expanded .board-pane {
      display: block;
    }
    .expanded .focus-toggle {
      display: flex;
    }
  }
  @media (pointer: coarse) {
    .board-select,
    .board-identity,
    .board-tools button,
    .board-tools .ask,
    .zoom-tools button {
      min-height: 44px;
    }
    .zoom-tools button {
      min-width: 44px;
    }
  }
</style>
