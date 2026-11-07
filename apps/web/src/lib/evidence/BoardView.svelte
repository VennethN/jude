<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import {
    Plus,
    Minus,
    ClipboardList,
    FileText,
    MessageSquare,
    Grip,
    Move,
    Search,
    PanelsTopLeft,
    Pencil,
    Link as LinkIcon,
    Trash2,
    ArrowUpRight,
    Maximize,
    X
  } from '@lucide/svelte';
  import type { Board, BoardCard, BoardRef, Excerpt, Lang, Relation, Workspace } from '@jude/core/domain';
  import { api, ApiError } from '$lib/client';
  import { apiPath, assistantPath, casePath, evidenceKey, relations, sourceOf } from './records';

  let { workspace: w, lang }: { workspace: Workspace; lang: Lang } = $props();
  let id = $derived(lang === 'id');
  let requested = $derived(page.url.searchParams.get('board'));
  let dataBoard = $derived(w.boards.find((b) => b.id === requested) || w.boards[0]);
  let recent = $state<Board>();
  let board = $derived(
    recent && recent.id === dataBoard?.id && recent.version >= dataBoard.version ? recent : dataBoard
  );
  let selected = $state(''),
    query = $state(''),
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
  let pickedExcerpt = $derived((page.state as {judeExcerpt?: Excerpt}).judeExcerpt);
  let excerpt = $derived(pickedExcerpt?.text), docId = $derived(pickedExcerpt?.docId || ''), pageNumber = $derived(pickedExcerpt?.page || 1);
  let candidates = $derived.by(() => {
    const list: BoardRef[] = [
      ...w.findings.map((f) => ({ kind: 'finding' as const, id: f.id })),
      ...w.documents.map((d) => ({ kind: 'document' as const, id: d.id })),
      ...w.passages.map((p) => ({ kind: 'passage' as const, id: p.id })),
      ...w.statements.map((s) => ({ kind: 'statement' as const, id: s.id }))
    ];
    return list
      .map((ref) => ({ ref, source: sourceOf(w, ref, lang), key: evidenceKey(ref) }))
      .filter((entry) => entry.source);
  });
  let choices = $derived(
    candidates.filter(
      (c) =>
        !board?.cards.some((card) => card.key === c.key) &&
        (!query.trim() ||
          (c.source!.label + ' ' + c.source!.text).toLowerCase().includes(query.trim().toLowerCase()))
    )
  );
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
    return candidates
      .filter((c) => keys.has(c.key) && !present.has(c.key) && !board?.dismissed.includes(c.key))
      .slice(0, 4);
  });
  let width = $derived(
    Math.max(780, ...(board?.cards.map((c) => c.x + 275) ?? []), drag ? drag.nx + 275 : 0)
  );
  let height = $derived(
    Math.max(380, ...(board?.cards.map((c) => c.y + 165) ?? []), drag ? drag.ny + 165 : 0)
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
      excerpt: id ? 'Pilihan teks' : 'Excerpt'
    }[kind];
  }
  function select(card: BoardCard) {
    selected = card.key;
    note = card.note || '';
    linkTo = '';
    linkName = '';
    editor = false;
  }
  async function persist(change: (draft: Board) => void, create = false) {
    if (busy || (!board && !create)) return;
    busy = true;
    problem = '';
    feedback = '';
    try {
      const current =
        board ??
        (await api<Board>(apiPath(w, 'boards'), 'POST', { name: id ? 'Papan perkara' : 'Case board' }));
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
          await api(apiPath(w, 'boards/' + encodeURIComponent(board.id)), 'DELETE');
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
  async function add(ref: BoardRef, custom?: string) {
    await persist((b) => {
      const key = evidenceKey(ref);
      if (!b.cards.some((c) => c.key === key)) {
        const i = b.cards.length;
        const card = { ...ref, key, x: 22 + (i % 3) * 258, y: 24 + Math.floor(i / 3) * 160 };
        if (custom) b.excerpts[ref.id] = { docId, page: pageNumber, text: custom, passageId: pickedExcerpt?.passageId };
        b.cards.push(card);
        select(card);
      }
    }, true);
    if (!problem) {
      picker = false;
      query = '';
    }
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
      ArrowDown: [0, 1]
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
          label: linkName.trim()
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

<div class="ev-tools board-tools">
  <div class="ev-inline">
    {#if w.boards.length}<select
        class="ev-select"
        aria-label={id ? 'Pilih papan' : 'Choose board'}
        value={board?.id}
        onchange={(e) => {
          selected = '';
          goto(url(e.currentTarget.value));
        }}
        >{#each w.boards as b}<option value={b.id}>{b.name}</option>{/each}</select
      >{/if}
    <button
      class="ev-button"
      onclick={() => {
        mode = 'new';
        name = '';
      }}><Plus size={15} />{id ? 'Papan baru' : 'New board'}</button
    >{#if board}<button
        class="ev-icon"
        aria-label={id ? 'Ganti nama papan' : 'Rename board'}
        onclick={() => {
          mode = 'rename';
          name = board!.name;
        }}><Pencil size={15} /></button
      ><button
        class="ev-icon"
        aria-label={id ? 'Hapus papan' : 'Delete board'}
        onclick={() => (mode = 'delete')}><Trash2 size={15} /></button
      >{/if}
  </div>
  <button
    class="ev-button primary"
    data-tour="board-add"
    aria-expanded={picker}
    onclick={() => (picker = !picker)}><Plus size={16} />{id ? 'Tambahkan bukti' : 'Add evidence'}</button
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
      <button class="ev-button" type="button" onclick={() => (mode = null)}>{id ? 'Batal' : 'Cancel'}</button
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
{#if picker}<section class="picker ev-notice">
    <h2 class="ev-title">{id ? 'Pilih bukti' : 'Choose evidence'}</h2>
    <label class="ev-search"
      ><Search size={15} /><input
        type="search"
        bind:value={query}
        aria-label={id ? 'Cari bukti' : 'Find evidence'}
        placeholder={id ? 'Cari pernyataan, dokumen, atau temuan…' : 'Find testimony, documents or findings…'}
      /></label
    >
    <ul class="ev-list">
      {#each choices as c (c.key)}<li>
          <button class="ev-pick" disabled={busy} onclick={() => add(c.ref)}
            ><span class="ev-meta">{kindName(c.ref.kind)}</span><strong>{c.source?.label}</strong><span
              class:ev-record={c.ref.kind === 'passage'}>{c.source?.text}</span
            ></button
          >
        </li>{:else}<li>{id ? 'Tidak ada hasil.' : 'No results.'}</li>{/each}
    </ul>
  </section>{/if}
{#if problem}<p class="ev-error" role="alert">{problem}</p>{/if}
<p class="ev-meta save-state" role="status">{busy ? (id ? 'Menyimpan…' : 'Saving…') : feedback}</p>
{#if board?.cards.length}
  <div class="ev-tools navig">
    <span class="ev-cap"
      ><PanelsTopLeft size={15} />{board.cards.length}
      {id ? 'kartu' : 'cards'} · {board.links.length}
      {id ? 'garis' : 'links'}</span
    >
    <div class="ev-inline">
      <button
        class="ev-icon"
        disabled={zoom <= 0.3}
        aria-label={id ? 'Perkecil' : 'Zoom out'}
        onclick={() => (zoom = Math.max(0.3, zoom - 0.1))}><Minus size={15} /></button
      ><span class="ev-meta">{Math.round(zoom * 100)}%</span><button
        class="ev-icon"
        disabled={zoom >= 1.6}
        aria-label={id ? 'Perbesar' : 'Zoom in'}
        onclick={() => (zoom = Math.min(1.6, zoom + 0.1))}><Plus size={15} /></button
      ><button class="ev-button" onclick={fit}><Maximize size={15} />{id ? 'Sesuaikan' : 'Fit'}</button>
    </div>
  </div>
  <div class="board-pane" data-tour="board-canvas" bind:this={pane}>
    <div class="board-space" style:width={width * zoom + 'px'} style:height={height * zoom + 'px'}>
      <div
        class="board-scene"
        style:width={width + 'px'}
        style:height={height + 'px'}
        style:transform={'scale(' + zoom + ')'}
      >
        <svg class="lines" {width} {height} aria-hidden="true"
          >{#each board.links as l (l.id)}{@const a = position(l.from)}{@const b = position(l.to)}<line
              x1={a.x + 117}
              y1={a.y + 62}
              x2={b.x + 117}
              y2={b.y + 62}
              data-relation={l.relation}
            />{/each}</svg
        >
        {#each board.cards as card (card.key)}{@const src = sourceOf(w, card, lang, board)}{@const pos =
            position(card.key)}
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
{:else}<section class="ev-empty empty-board">
    <PanelsTopLeft size={28} />
    <h2 class="ev-title">{id ? 'Papan masih kosong' : 'Your board is empty'}</h2>
    <p>
      {id
        ? 'Pilih kutipan atau pernyataan untuk mulai membandingkan bukti.'
        : 'Choose a passage or a statement to start comparing evidence.'}
    </p>
  </section>{/if}
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
      <a class="ev-button" href={item.href}>{id ? 'Buka sumber' : 'Open source'}<ArrowUpRight size={14} /></a
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
              >{#each Object.entries(relations) as [r, l]}<option value={r}>{l[lang]}</option>{/each}</select
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
            (c) => c.key === l.to
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
  <div class="ev-tools">
    <label class="ev-cap"
      ><input
        type="checkbox"
        checked={board.suggest}
        disabled={busy}
        onchange={(e) => {
          const value = e.currentTarget.checked;
          persist((b) => {
            b.suggest = value;
          });
        }}
      />{id ? 'Tampilkan saran sumber' : 'Show suggested sources'}</label
    ><a class="ev-link" href={assistantPath(w, { kind: 'board', id: board.id })}
      ><MessageSquare size={15} />{id ? 'Tanya tentang papan' : 'Ask about this board'}</a
    >
  </div>
  {#if suggested.length}<ul class="ev-list suggestions">
      {#each suggested as c (c.key)}<li class="ev-row">
          <div>
            <span class="ev-meta">{id ? 'Sumber terkait' : 'Related source'}</span><strong
              >{c.source?.label}</strong
            >
          </div>
          <div class="ev-actions">
            <button class="ev-button" disabled={busy} onclick={() => add(c.ref)}
              >{id ? 'Tambahkan' : 'Add'}</button
            ><button
              class="ev-button"
              disabled={busy}
              onclick={() =>
                persist((b) => {
                  b.dismissed.push(c.key);
                })}>{id ? 'Sisihkan' : 'Set aside'}</button
            >
          </div>
        </li>{/each}
    </ul>{/if}
{/if}

<style>
  .board-tools {
    margin-bottom: 0.5rem;
  }
  .picker {
    display: grid;
    gap: 0.75rem;
    margin: 1rem 0;
  }
  .picker ul {
    max-height: 20rem;
    overflow: auto;
  }
  .picker strong,
  .mobile-board strong,
  .suggestions strong {
    display: block;
  }
  .picker .ev-pick > span:last-child,
  .mobile-board .ev-pick > span:last-child {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .save-state {
    margin: 0.3rem 0;
    min-height: 1.1rem;
  }
  .navig {
    border: 0;
    margin: 0.3rem 0;
    padding: 0.25rem 0;
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
  .empty-board {
    min-height: 15rem;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 0.4rem;
  }
  .mobile-board {
    display: none;
  }
  @container (max-width:650px) {
    .board-pane,
    .navig {
      display: none;
    }
    .mobile-board {
      display: block;
    }
    .card-editor .ev-title {
      font-size: 1.35rem;
    }
    .suggestions .ev-row {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
