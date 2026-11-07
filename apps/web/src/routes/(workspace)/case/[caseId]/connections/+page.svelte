<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { write } from '$lib/client';
  import {
    Search,
    Plus,
    Minus,
    Maximize,
    Network,
    Link as LinkIcon,
    Check,
    Trash2,
    ArrowUpRight,
    X
  } from '@lucide/svelte';
  import type { PageData } from './$types';
  import type { Connection, InspectTarget, Relation } from '@jude/core/domain';
  import {
    apiPath,
    boardPath,
    casePath,
    evidenceKey,
    local,
    nodeKey,
    relations
  } from '$lib/evidence/records';
  import { connector, graphOf, groupOf, place, type Pairing } from '$lib/evidence/graph';
  import Inspector from '$lib/evidence/Inspector.svelte';
  import '$lib/evidence/evidence.css';
  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace),
    lang = $derived(data.lang),
    id = $derived(lang === 'id'),
    base = $derived(casePath(w) + '/connections');
  let graph = $derived(graphOf(w, lang)),
    raw = $derived(page.url.searchParams.get('of') || page.url.searchParams.get('start') || '');
  let selected = $derived(graph.vertices.get(raw)),
    selectedDoc = $derived(
      raw.startsWith('document:') ? w.documents.find((d) => 'document:' + d.id === raw) : undefined
    );
  let group = $derived(!!(selected || selectedDoc));
  let members = $derived(
    groupOf(
      selected
        ? [selected.key]
        : selectedDoc
          ? w.passages.filter((p) => p.docId === selectedDoc?.id).map((p) => 'passage:' + p.id)
          : [],
      graph.adjacent
    )
  );
  let related = $derived(graph.pairs.filter((p) => !group || (members.has(p.from) && members.has(p.to))));
  let scene = $derived(place(graph.nodes, members, group, graph.adjacent));
  let disabled = $state<Relation[]>([]),
    zoom = $state(0.82),
    query = $state(''),
    finding = $state(false),
    pairMode = $state(false),
    focused = $state(''),
    pairFrom = $state(''),
    pairTo = $state(''),
    relation = $state<Relation>('related'),
    busy = $state(false),
    problem = $state(''),
    undo = $state<Connection | null>(null);
  let pane = $state<HTMLDivElement>(),
    inspect = $state<InspectTarget | null>(null);
  let options = $derived(graph.nodes.filter((n) => n.ref.kind !== 'finding'));
  let optionsTo = $derived(
    options.filter(
      (n) =>
        n.key !== pairFrom &&
        !graph.pairs.some(
          (p) =>
            p.connectionId &&
            ((p.from === pairFrom && p.to === n.key) || (p.to === pairFrom && p.from === n.key))
        )
    )
  );
  let hits = $derived(
    graph.nodes.filter(
      (n) =>
        !query.trim() ||
        (n.source.text + ' ' + n.source.label).toLowerCase().includes(query.trim().toLowerCase())
    )
  );
  let activePairs = $derived(related.filter((p) => !disabled.includes(p.relation)));
  function choose(key: string) {
    finding = false;
    pairMode = false;
    focused = '';
    zoom = key ? 0.96 : 0.82;
    goto(key ? base + '?of=' + encodeURIComponent(key) : base, { noScroll: true });
    pane?.scrollTo(0, 0);
  }
  function fit() {
    if (pane)
      zoom = Math.max(0.27, Math.min(1.12, pane.clientWidth / scene.width, pane.clientHeight / scene.height));
    pane?.scrollTo(0, 0);
  }
  function label(column: string) {
    if (column === 'statement') return id ? 'Pernyataan' : 'Statements';
    if (column === 'passage') return id ? 'Kutipan' : 'Passages';
    if (column === 'finding' || column === 'findings') return id ? 'Temuan' : 'Findings';
    const [kind, key] = column.split(':');
    if (kind === 'hearing')
      return (id ? 'Sidang ' : 'Hearing ') + (w.hearings.find((h) => h.id === key)?.number ?? '');
    return w.documents.find((d) => d.id === key)?.title ?? column;
  }
  function toggle(r: Relation) {
    disabled = disabled.includes(r) ? disabled.filter((s) => s !== r) : [...disabled, r];
  }
  async function mutate(method: string, path: string, body?: unknown) {
    if (busy) return false;
    busy = true;
    problem = '';
    try {
      await write(apiPath(w, path), method, body);
      return true;
    } catch (e) {
      problem = e instanceof Error ? e.message : id ? 'Perubahan gagal.' : 'Change failed.';
      return false;
    } finally {
      busy = false;
    }
  }
  async function pair() {
    const from = nodeKey(pairFrom),
      to = nodeKey(pairTo);
    if (!from || !to) return;
    if (await mutate('POST', 'connections', { from, to, relation })) {
      pairMode = false;
      choose(evidenceKey(from));
    }
  }
  async function remove(p: Pairing) {
    const old = w.connections.find((c) => c.id === p.connectionId);
    if (old && (await mutate('DELETE', 'connections/' + encodeURIComponent(old.id)))) undo = old;
  }
  let pan: { x: number; y: number; left: number; top: number } | null = null;
  function startPan(e: PointerEvent) {
    if (
      !pane ||
      e.button !== 0 ||
      e.pointerType === 'touch' ||
      (e.target instanceof Element && e.target.closest('button'))
    )
      return;
    pan = { x: e.clientX, y: e.clientY, left: pane.scrollLeft, top: pane.scrollTop };
    pane.setPointerCapture(e.pointerId);
  }
  function movePan(e: PointerEvent) {
    if (pan) pane?.scrollTo(pan.left + pan.x - e.clientX, pan.top + pan.y - e.clientY);
  }
</script>

<svelte:head><title>{id ? 'Keterkaitan' : 'Connections'} · Jude</title></svelte:head>
<div class="ev-page">
  <header class="ev-head">
    <div>
      <h1>{id ? 'Keterkaitan' : 'Connections'}</h1>
      <p>
        {id
          ? 'Telusuri hubungan antara pernyataan, kutipan, dan temuan.'
          : 'Trace how statements, passages and findings relate to each other.'}
      </p>
    </div>
    <button
      class="ev-button primary"
      disabled={options.length < 2}
      onclick={() => {
        pairMode = !pairMode;
        pairFrom = selected?.ref.kind !== 'finding' && selected ? selected.key : (options[0]?.key ?? '');
        pairTo = '';
      }}><LinkIcon size={16} />{id ? 'Pasangkan bukti' : 'Pair evidence'}</button
    >
  </header>
  {#if problem}<p role="alert" class="ev-error">{problem}</p>{/if}
  {#if undo}<div class="ev-notice ev-inline" role="status">
      {id ? 'Pasangan dipisahkan.' : 'Pairing removed.'}<button
        class="ev-button"
        onclick={async () => {
          if (undo && (await mutate('POST', 'connections/' + encodeURIComponent(undo.id) + '/restore')))
            undo = null;
        }}>{id ? 'Urungkan' : 'Undo'}</button
      >
    </div>{/if}
  {#if pairMode}<form
      class="ev-notice pair-form"
      onsubmit={(e) => {
        e.preventDefault();
        pair();
      }}
    >
      <h2 class="ev-title">{id ? 'Buat pasangan' : 'Create a pairing'}</h2>
      <label class="ev-field-label"
        >{id ? 'Bukti pertama' : 'First piece'}<select
          class="ev-select"
          bind:value={pairFrom}
          onchange={() => (pairTo = '')}
          >{#each options as n (n.key)}<option value={n.key}
              >{n.source.label} · {n.source.text.slice(0, 65)}</option
            >{/each}</select
        ></label
      >
      <label class="ev-field-label"
        >{id ? 'Bukti kedua' : 'Second piece'}<select class="ev-select" bind:value={pairTo} required
          ><option value="">{id ? 'Pilih bukti' : 'Choose evidence'}</option
          >{#each optionsTo as n (n.key)}<option value={n.key}
              >{n.source.label} · {n.source.text.slice(0, 65)}</option
            >{/each}</select
        ></label
      >
      <label class="ev-field-label"
        >{id ? 'Hubungan' : 'Relation'}<select class="ev-select" bind:value={relation}
          >{#each Object.entries(relations) as [r, t]}<option value={r}>{t[lang]}</option>{/each}</select
        ></label
      >
      <div class="ev-actions">
        <button type="button" class="ev-button" onclick={() => (pairMode = false)}
          >{id ? 'Batal' : 'Cancel'}</button
        ><button class="ev-button primary" disabled={busy || !pairTo}
          >{id ? 'Simpan pasangan' : 'Save pairing'}</button
        >
      </div>
    </form>{/if}
  {#if graph.nodes.length}
    <div class="ev-tools map-tools" data-tour="connections-bar">
      <div class="ev-actions">
        {#if group}<a class="ev-button" href={base}><X size={15} />{id ? 'Semua bukti' : 'All evidence'}</a
          >{/if}<button class="ev-button" aria-expanded={finding} onclick={() => (finding = !finding)}
          ><Search size={16} />{id ? 'Cari bukti' : 'Find evidence'}</button
        >
      </div>
      <div class="ev-actions">
        <button
          class="ev-icon"
          disabled={zoom <= 0.27}
          aria-label={id ? 'Perkecil' : 'Zoom out'}
          onclick={() => (zoom = Math.max(0.27, zoom - 0.1))}><Minus size={16} /></button
        ><span class="ev-meta">{Math.round(zoom * 100)}%</span><button
          class="ev-icon"
          disabled={zoom >= 1.6}
          aria-label={id ? 'Perbesar' : 'Zoom in'}
          onclick={() => (zoom = Math.min(1.6, zoom + 0.1))}><Plus size={16} /></button
        ><button class="ev-icon" aria-label={id ? 'Tampilkan semua' : 'Fit all'} onclick={fit}
          ><Maximize size={16} /></button
        >
      </div>
    </div>
    {#if finding}<section class="picker ev-notice">
        <label class="ev-search"
          ><Search size={15} /><input
            type="search"
            bind:value={query}
            aria-label={id ? 'Cari bukti' : 'Find evidence'}
            placeholder={id ? 'Cari pernyataan atau kutipan…' : 'Find a statement or passage…'}
          /></label
        >
        <ul class="ev-list">
          {#each hits as n (n.key)}<li>
              <button class="ev-pick" onclick={() => choose(n.key)}
                ><strong>{n.source.label}</strong><span>{n.source.text}</span></button
              >
            </li>{:else}<li>{id ? 'Tidak ada hasil.' : 'No results.'}</li>{/each}
        </ul>
      </section>{/if}
    <div class="filters" aria-label={id ? 'Filter hubungan' : 'Relation filters'}>
      {#each Object.entries(relations) as [r, t]}{@const rel = r as Relation}<button
          class="filter"
          aria-pressed={!disabled.includes(rel)}
          onclick={() => toggle(rel)}
          ><i data-relation={r}></i>{t[lang]}
          <span>{related.filter((p) => p.relation === r).length}</span></button
        >{/each}
    </div>
    <div class="map-layout" class:with-panel={group}>
      <div>
        <div
          class="map"
          role="region"
          aria-label={id ? 'Peta bukti' : 'Evidence map'}
          data-tour="connections-map"
          bind:this={pane}
          onpointerdown={startPan}
          onpointermove={movePan}
          onpointerup={() => (pan = null)}
          onpointercancel={() => (pan = null)}
        >
          <div style:width={scene.width * zoom + 'px'} style:height={scene.height * zoom + 'px'}>
            <div
              class="world"
              style:width={scene.width + 'px'}
              style:height={scene.height + 'px'}
              style:transform={'scale(' + zoom + ')'}
            >
              <svg width={scene.width} height={scene.height} aria-hidden="true"
                >{#each activePairs as p, i (p.key)}{@const a = scene.positions[p.from]}{@const b =
                    scene.positions[p.to]}{#if a && b}<path
                      d={connector(a, b, i)}
                      data-relation={p.relation}
                      stroke-dasharray={p.reviewed ? undefined : '6 5'}
                      opacity={focused && focused !== p.from && focused !== p.to ? 0.2 : 1}
                    />{/if}{/each}</svg
              >
              {#each scene.columns as c (c.key)}<div
                  class="column"
                  style:left={c.x + 'px'}
                  style:width={c.w + 'px'}
                >
                  {#if c.key.startsWith('document:')}<button
                      title={label(c.key)}
                      onclick={() => choose(c.key)}>{label(c.key)}</button
                    >{:else}<strong>{label(c.key)}</strong>{/if}<span>{c.count}</span>
                </div>{/each}
              {#each graph.nodes.filter((n) => scene.positions[n.key]) as n (n.key)}{@const p =
                  scene.positions[n.key]}
                <button
                  class="piece"
                  class:current={selected?.key === n.key}
                  class:quiet={p.h < 40}
                  class:book={n.ref.kind === 'passage'}
                  aria-pressed={selected?.key === n.key}
                  title={n.source.label + ' · ' + n.source.text}
                  style:left={p.x + 'px'}
                  style:top={p.y + 'px'}
                  style:width={p.w + 'px'}
                  style:height={p.h + 'px'}
                  onclick={() => choose(n.key)}
                  onmouseenter={() => (focused = n.key)}
                  onmouseleave={() => (focused = '')}
                  onfocus={() => (focused = n.key)}
                  onblur={() => (focused = '')}
                  ><strong>{n.source.label}</strong>{#if zoom >= 0.65}<span>{n.source.text}</span
                    >{/if}</button
                >
              {/each}
            </div>
          </div>
        </div>
        <p class="legend ev-meta">
          <i></i>{id ? 'Dikonfirmasi' : 'Confirmed'} <i class="dashed"></i>{id ? 'Disarankan' : 'Suggested'} · {activePairs.length}
          {id ? 'pasangan ditampilkan' : 'visible pairings'}
        </p>
      </div>
      {#if group}<aside class="group" data-tour="connections-group">
          <h2 class="ev-title">{selected?.source.label || selectedDoc?.title}</h2>
          <p class="ev-meta">{members.size} {id ? 'bukti dalam kelompok' : 'pieces in this group'}</p>
          {#if selected}<p class:ev-record={selected.ref.kind === 'passage'}>{selected.source.text}</p>
            <div class="ev-actions">
              {#if selected.ref.kind === 'finding'}<a class="ev-button" href={selected.source.href}
                  >{id ? 'Buka di Temuan' : 'Open in Findings'}<ArrowUpRight size={14} /></a
                >{:else}<button class="ev-button" onclick={() => selected && (inspect = selected.ref)}
                  >{id ? 'Periksa sumber' : 'Inspect source'}</button
                >{/if}<a class="ev-button" href={boardPath(w, selected.ref)}
                >{id ? 'Taruh di papan' : 'Put on board'}</a
              >
            </div>{/if}
          <h3>{id ? 'Pasangan dalam kelompok' : 'Pairings in group'}</h3>
          <ul class="ev-list">
            {#each activePairs as p (p.key)}<li>
                <span class="ev-cap"
                  ><i data-relation={p.relation}></i>{relations[p.relation][lang]} · {p.reviewed
                    ? id
                      ? 'Dikonfirmasi'
                      : 'Confirmed'
                    : id
                      ? 'Disarankan'
                      : 'Suggested'}</span
                >
                <button class="side-link" onclick={() => choose(p.from)}
                  >{graph.vertices.get(p.from)?.source.label}</button
                ><button class="side-link" onclick={() => choose(p.to)}
                  >{graph.vertices.get(p.to)?.source.label}</button
                >
                {#if p.connectionId}{@const c = w.connections.find((c) => c.id === p.connectionId)}{#if c}<p
                      class="ev-meta"
                    >
                      {local(c.why, lang)}
                    </p>{/if}
                  <div class="ev-actions">
                    <select
                      class="ev-select"
                      disabled={busy}
                      value={p.relation}
                      aria-label={id ? 'Jenis hubungan' : 'Relation type'}
                      onchange={(e) =>
                        mutate('PATCH', 'connections/' + encodeURIComponent(p.connectionId!), {
                          relation: e.currentTarget.value
                        })}
                      >{#each Object.entries(relations) as [r, t]}<option value={r}>{t[lang]}</option
                        >{/each}</select
                    ><button
                      class="ev-button"
                      disabled={busy}
                      onclick={() =>
                        mutate('PATCH', 'connections/' + encodeURIComponent(p.connectionId!), {
                          reviewed: !p.reviewed
                        })}
                      ><Check size={14} />{p.reviewed
                        ? id
                          ? 'Buka kembali'
                          : 'Reopen'
                        : id
                          ? 'Konfirmasi'
                          : 'Confirm'}</button
                    ><button
                      class="ev-icon"
                      disabled={busy}
                      aria-label={id ? 'Pisahkan pasangan' : 'Remove pairing'}
                      onclick={() => remove(p)}><Trash2 size={14} /></button
                    >
                  </div>
                {:else if p.findingId}<a
                    class="ev-link"
                    href={casePath(w) + '/findings/' + encodeURIComponent(p.findingId)}
                    >{id ? 'Atur di Temuan' : 'Manage in Findings'}</a
                  >{/if}
              </li>{:else}<li class="ev-sub">
                {id ? 'Tidak ada pasangan yang ditampilkan.' : 'No pairings are visible.'}
              </li>{/each}
          </ul>
        </aside>{/if}
    </div>
  {:else}<div class="ev-empty">
      <Network size={26} />
      <h2 class="ev-title">{id ? 'Belum ada bukti untuk dipetakan' : 'No evidence to map yet'}</h2>
      <p>
        {id ? 'Tambahkan dokumen atau transkrip sidang.' : 'Add a document or a hearing transcript to begin.'}
      </p>
    </div>{/if}
</div>
{#if inspect}<Inspector workspace={w} {lang} target={inspect} close={() => (inspect = null)} />{/if}

<style>
  .filters {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    overflow: auto;
    padding: 0.12rem 0.1rem 0.7rem;
  }
  .filter {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 1.5rem;
    padding: 0.45rem 0.7rem;
    min-height: 44px;
    color: var(--ink);
    cursor: pointer;
    font: 600 0.78rem var(--sans);
  }
  .filter[aria-pressed='false'] {
    background: transparent;
    color: var(--muted);
    text-decoration: line-through;
  }
  .filter span {
    color: var(--muted);
  }
  i[data-relation] {
    display: inline-block;
    width: 0.8rem;
    height: 0.2rem;
    border-radius: 2px;
  }
  .ev-page [data-relation='conflicts'] {
    --tone: var(--ev-conflicts);
  }
  .ev-page [data-relation='supports'] {
    --tone: var(--ev-supports);
  }
  .ev-page [data-relation='context'] {
    --tone: var(--ev-context);
  }
  .ev-page [data-relation='related'] {
    --tone: var(--muted);
  }
  i[data-relation] {
    background: var(--tone);
  }
  .map {
    min-height: 24rem;
    height: min(64vh, 45rem);
    overflow: auto;
    overscroll-behavior: contain;
    position: relative;
    background: var(--paper);
    background-image: radial-gradient(var(--line) 1px, transparent 1px);
    background-size: 18px 18px;
    border: 1px solid var(--line);
    border-radius: 0.65rem;
    cursor: grab;
  }
  .world {
    position: relative;
    transform-origin: top left;
  }
  .world svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .world path {
    fill: none;
    stroke: var(--tone);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .column {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    position: absolute;
    top: 8px;
    height: 40px;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .column button,
  .column strong {
    flex: 1;
    min-width: 0;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    text-align: left;
    border: 0;
    background: var(--paper);
    color: var(--ink);
    font: 600 0.85rem var(--sans);
    padding: 0;
  }
  .column button {
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    min-height: 40px;
  }
  .piece {
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.4rem 0.55rem;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    gap: 0.2rem;
  }
  .piece.current,
  .piece:hover {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .piece strong {
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    font: 600 0.76rem/1.4 var(--sans);
  }
  .piece span,
  .picker li span {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.8rem;
    line-height: 1.32;
  }
  .piece.book span {
    font-family: var(--mono);
  }
  .piece.quiet span {
    display: none;
  }
  .map-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .map-layout > div { min-width:0; }
  .map-layout.with-panel {
    grid-template-columns: minmax(0, 1fr) minmax(17rem, 30%);
  }
  .group {
    padding: 1rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.6rem;
    max-height: 74vh;
    overflow: auto;
  }
  .group h2 {
    font-size: 1.55rem;
  }
  .group h3 {
    font-size: 1rem;
    margin-top: 1.2rem;
  }
  .group li {
    padding: 0.7rem 0;
  }
  .side-link {
    display: block;
    min-height: 34px;
    text-align: start;
    color: var(--ink);
    background: transparent;
    border: 0;
    font: 600 0.8rem/1.45 var(--sans);
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .legend i {
    width: 1.8rem;
    border-bottom: 2px solid var(--muted);
  }
  .legend i.dashed {
    border-bottom-style: dashed;
  }
  .picker ul {
    max-height: 16rem;
    overflow: auto;
  }
  .picker li strong {
    display: block;
  }
  .pair-form {
    margin-bottom: 0.8rem;
  }
  .pair-form .ev-field-label {
    max-width: 45rem;
  }
  .pair-form select {
    min-width: 0;
  }
  @container (max-width:1000px) {
    .map-layout.with-panel {
      grid-template-columns: minmax(0,1fr);
    }
    .group {
      max-height: none;
    }
    .map {
      height: 53vh;
    }
  }
  @container (max-width:600px) {
    .map {
      min-height: 15rem;
      height: 46vh;
    }
    .map-tools {
      gap: 0.25rem;
    }
    .map-tools .ev-actions {
      gap: 0.17rem;
    }
    .map-tools .ev-icon {
      width: 40px;
    }
  }
</style>
