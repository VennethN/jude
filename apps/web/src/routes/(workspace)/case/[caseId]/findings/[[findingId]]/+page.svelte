<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Bookmark, CheckCheck, ClipboardList, PanelsTopLeft, List, Search, X } from '@lucide/svelte';
  import type { PageData } from './$types';
  import type { Finding } from '@jude/core/domain';
  import { casePath, local, meaningful } from '$lib/evidence/records';
  import FindingPager from '$lib/evidence/FindingPager.svelte';
  import FindingQueue from '$lib/evidence/FindingQueue.svelte';
  import ReviewMark from '$lib/evidence/ReviewMark.svelte';
  import FindingDetail from '$lib/evidence/FindingDetail.svelte';
  import SavedLines from '$lib/evidence/SavedLines.svelte';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import BoardView from '$lib/evidence/BoardView.svelte';
  import '$lib/evidence/evidence.css';

  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace),
    lang = $derived(data.lang),
    id = $derived(lang === 'id');
  let base = $derived(casePath(w) + '/findings');
  let opened = $derived(page.params.findingId);
  let requested = $derived(opened ? w.findings.find((f) => f.id === opened) : undefined);
  let tab = $derived(
    requested
      ? meaningful(requested.status)
        ? requested.reviewed
          ? 'checked'
          : 'attention'
        : 'others'
      : page.url.searchParams.get('tab') || 'attention'
  );
  let board = $derived(page.url.searchParams.get('view') === 'board');
  let byH = $derived(page.url.searchParams.get('hearing') || ''),
    byD = $derived(page.url.searchParams.get('doc') || '');
  let query = $state('');
  let times = $derived(new Map(w.statements.map((s) => [s.id, s])));
  let hearingNumbers = $derived(new Map(w.hearings.map((h) => [h.id, h.number])));
  let filtered = $derived(
    w.findings
      .filter(
        (f) =>
          (!byH || f.hearingId === byH) &&
          (!byD || f.sources.some((s) => w.passages.find((p) => p.id === s.passageId)?.docId === byD))
      )
      .sort(
        (a, b) =>
          (hearingNumbers.get(a.hearingId) ?? 0) - (hearingNumbers.get(b.hearingId) ?? 0) ||
          (times.get(a.statementId)?.t ?? 0) - (times.get(b.statementId)?.t ?? 0)
      )
  );
  let checked = $derived(filtered.filter((f) => f.reviewed && meaningful(f.status)));
  let attention = $derived(filtered.filter((f) => !f.reviewed && meaningful(f.status)));
  let others = $derived(filtered.filter((f) => !meaningful(f.status)));
  let list = $derived(
    (tab === 'checked' ? checked : tab === 'others' ? others : attention).filter(
      (f) =>
        !query.trim() ||
        (local(f.title, lang) + ' ' + (times.get(f.statementId)?.text ?? '') + ' ' + f.note + ' ' + f.question)
          .toLowerCase()
          .includes(query.trim().toLowerCase())
    )
  );
  let width = $state(0);
  let narrow = $derived(width > 0 && width < 760);
  let active = $derived(requested || (!opened ? list[0] : undefined));
  function href(changes: Record<string, string | null>, f?: Finding) {
    const qp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(changes)) v === null ? qp.delete(k) : qp.set(k, v);
    return base + (f ? '/' + encodeURIComponent(f.id) : '') + (qp.size ? '?' + qp : '');
  }
  let position = $derived(list.findIndex((f) => f.id === active?.id));
  let pager = $derived(position >= 0 ? { index: position, total: list.length, step } : undefined);
  function step(delta: number) {
    const next = list[position + delta];
    if (next)
      void goto(href({ tab }, next), {
        replaceState: !!opened,
        noScroll: true,
        keepFocus: true,
        state: { ...page.state }
      });
  }
  function pick(event: MouseEvent, f: Finding) {
    if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void goto(href({ tab }, f), {
      noScroll: true,
      keepFocus: true,
      state: { ...page.state, judeFindingsQueue: page.url.pathname === base ? base : undefined }
    });
  }
  function closeSheet() {
    if ((page.state as { judeFindingsQueue?: string }).judeFindingsQueue === base) history.back();
    else void goto(href({ tab }), { replaceState: true, noScroll: true });
  }
  let tabs = $derived([
    { code: 'attention', text: id ? 'Perlu dicek' : 'Worth a look', count: attention.length },
    { code: 'checked', text: id ? 'Sudah dicek' : 'Checked', count: checked.length },
    { code: 'others', text: id ? 'Lainnya' : 'Others', count: others.length },
    {
      code: 'saved',
      text: id ? 'Ditandai' : 'Bookmarked',
      count: w.statements.filter((s) => s.flagged && (!byH || s.hearingId === byH)).length
    }
  ]);
</script>

<svelte:head
  ><title>{board ? (id ? 'Papan temuan' : 'Case board') : id ? 'Temuan' : 'Findings'} · Jude</title></svelte:head
>
<div class="ev-page findings-page" class:board bind:clientWidth={width}>
  <header class="ev-head">
    <div>
      <h1>{board ? (id ? 'Papan temuan' : 'Case board') : id ? 'Temuan' : 'Findings'}</h1>
      <p>
        {board
          ? id
            ? 'Susun bukti dan catatan untuk pemeriksaan Anda.'
            : 'Arrange the evidence and your review notes.'
          : id
            ? 'Hal yang perlu Anda cek dari setiap sidang. Temuan yang sesuai sumber ada di Lainnya.'
            : 'What to check from every hearing. Findings that match their source are under Others.'}
      </p>
    </div>
    <nav class="finding-views" aria-label={id ? 'Tampilan temuan' : 'Findings view'} data-tour="board-open">
      <a href={base} aria-current={!board ? 'page' : undefined}><List size={15} />{id ? 'Daftar' : 'List'}</a>
      <a
        href={base + '?view=board'}
        aria-label={id ? 'Buka papan' : 'Open board'}
        aria-current={board ? 'page' : undefined}
      >
        <PanelsTopLeft size={15} />{id ? 'Papan' : 'Board'}
      </a>
    </nav>
  </header>
  {#if board}
    <BoardView workspace={w} {lang} />
  {:else}
    <div class="filters">
      <nav class="queue-tabs" aria-label={id ? 'Filter temuan' : 'Findings filters'} data-tour="findings-tabs">
        {#each tabs as t}
          <a href={href({ tab: t.code })} aria-current={tab === t.code ? 'page' : undefined}>
            {#if t.code === 'attention'}<span class="filter-icon"
                ><ReviewMark status="potential_inconsistency" size={17} /></span
              >
            {:else if t.code === 'saved'}<Bookmark
                class="filter-icon"
                size={13}
                fill="currentColor"
                aria-hidden="true"
              />{/if}
            {t.text}<span class="count" class:attention={t.code === 'attention' && t.count > 0}>{t.count}</span>
          </a>
        {/each}
      </nav>
      <label class="queue-search"
        ><Search size={16} aria-hidden="true" /><input
          type="search"
          bind:value={query}
          aria-label={tab === 'saved'
            ? id
              ? 'Cari pernyataan ditandai'
              : 'Search bookmarked lines'
            : id
              ? 'Cari temuan'
              : 'Search findings'}
          placeholder={tab === 'saved'
            ? id
              ? 'Cari pernyataan…'
              : 'Search lines…'
            : id
              ? 'Cari temuan…'
              : 'Search findings…'}
        /></label
      >
      {#if byD}<a
          class="filter-doc"
          href={href({ doc: null })}
          aria-label={id ? 'Hapus filter dokumen' : 'Clear document filter'}
        >
          <span>{w.documents.find((d) => d.id === byD)?.title ?? (id ? 'Dokumen' : 'Document')}</span><X
            size={14}
          /></a
        >{/if}
      <select
        class="hearing-select"
        aria-label={id ? 'Filter sidang' : 'Filter by hearing'}
        value={byH}
        onchange={(e) => goto(href({ hearing: e.currentTarget.value || null }))}
      >
        <option value="">{id ? 'Semua sidang' : 'All hearings'}</option>
        {#each w.hearings as h}<option value={h.id}
            >{id ? 'Sidang' : 'Hearing'} {h.number} · {local(h.title, lang)}</option
          >{/each}
      </select>
    </div>
    {#if tab === 'others'}<p class="others-hint">
        {id
          ? 'Sesuai sumber atau buktinya belum cukup. Tidak perlu tindakan.'
          : 'Matches the source or lacks evidence. No action needed.'}
      </p>{/if}
    {#if tab === 'saved'}<SavedLines
        workspace={w}
        {lang}
        hearing={byH}
        {query}
        selected={page.url.searchParams.get('s') ?? ''}
      />
    {:else if opened && !requested}<div class="ev-empty">
        <h2 class="ev-title">{id ? 'Temuan tidak ditemukan' : 'Finding not found'}</h2>
        <a class="ev-link" href={base}>{id ? 'Kembali ke temuan' : 'Back to findings'}</a>
      </div>
    {:else if list.length || requested}
      <div class="review-grid" class:detail-open={!!opened}>
        <FindingQueue
          workspace={w}
          {lang}
          {list}
          selected={width >= 760 ? active?.id : undefined}
          href={(f) => href({ tab }, f)}
          {pick}
        />
        {#if active}
          {#if narrow && requested}
            <Dialog sheet title={id ? 'Temuan' : 'Finding'} {lang} close={closeSheet}>
              {#snippet headerActions()}{#if pager}<FindingPager
                    navigation={pager}
                    {lang}
                    vertical
                  />{/if}{/snippet}
              {#key active.id}<FindingDetail
                  workspace={w}
                  {lang}
                  finding={active}
                  navigation={pager}
                  internalPager={false}
                />{/key}
            </Dialog>
          {:else if !narrow && (width || opened)}
            <div class="detail-pane">
              {#key active.id}<FindingDetail workspace={w} {lang} finding={active} navigation={pager} />{/key}
            </div>
          {/if}
        {/if}
      </div>
    {:else}<div class="ev-empty">
        {#if tab === 'checked'}<CheckCheck size={25} />{:else if tab === 'others'}<Bookmark
            size={25}
          />{:else}<ClipboardList size={25} />{/if}
        <h2 class="ev-title">
          {query
            ? id
              ? 'Tidak ada hasil'
              : 'No results'
            : tab === 'attention'
              ? id
                ? 'Tidak ada temuan yang perlu dicek'
                : 'Nothing needs a look'
              : tab === 'checked'
                ? id
                  ? 'Belum ada temuan yang diperiksa'
                  : 'No checked findings yet'
                : id
                  ? 'Belum ada temuan lain'
                  : 'No other findings'}
        </h2>
      </div>{/if}
  {/if}
</div>

<style>
  .ev-head {
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 28px;
  }
  .ev-head h1 {
    color: var(--ink-strong);
    font: 400 30px/1.08 var(--display);
    letter-spacing: -0.012em;
  }
  .ev-head p {
    max-width: 62ch;
    margin-top: 8px;
    color: var(--muted);
    font: 400 14.5px/1.55 var(--sans);
  }
  .finding-views,
  .queue-tabs {
    display: flex;
    align-items: center;
    padding: 3px;
    border-radius: 8px;
    background: var(--sunken);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .finding-views a,
  .queue-tabs a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    min-height: 30px;
    border-radius: 6px;
    text-decoration: none;
    white-space: nowrap;
    color: var(--muted);
    font: 500 13px/1.3 var(--sans);
  }
  .finding-views a,
  .queue-tabs a {
    color: var(--muted-on-fill);
  }
  .finding-views a:hover,
  .queue-tabs a:hover {
    color: var(--ink-strong);
  }
  .finding-views a[aria-current],
  .queue-tabs a[aria-current] {
    background: var(--surface);
    color: var(--ink-strong);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--ink) 18%, transparent);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    margin-bottom: 16px;
  }
  .filter-icon {
    display: inline-grid;
    place-items: center;
    color: var(--focus);
  }
  .queue-tabs .count {
    display: inline-grid;
    min-width: 18px;
    padding: 2px 5px;
    place-items: center;
    border-radius: 20px;
    font: 600 11px/1.45 var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .count.attention {
    background: var(--st-inconsistency-bg);
    color: var(--st-inconsistency-ink);
  }
  .queue-search,
  .hearing-select {
    min-height: 36px;
    min-width: 0;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
  }
  .queue-search {
    flex: 1 1 220px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding-inline: 11px;
    color: var(--muted);
  }
  .queue-search input {
    width: 100%;
    min-width: 0;
    min-height: 34px;
    outline: 0;
    border: 0;
    padding: 5px 0;
    background: none;
    color: var(--ink);
    font: 400 14px/1.4 var(--sans);
  }
  .queue-search:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .queue-search input:focus-visible {
    outline: 0;
  }
  .hearing-select {
    flex: 0 1 280px;
    padding: 5px 11px;
    font: 400 14px/1.4 var(--sans);
  }
  .filter-doc {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: min(340px, 100%);
    padding: 4px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 24px;
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
    font-size: 12px;
  }
  .filter-doc span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .review-grid {
    display: grid;
    grid-template-columns: clamp(240px, 34%, 380px) minmax(0, 1fr);
    align-items: start;
    gap: 14px;
  }
  .review-grid :global(.queue) {
    padding: 3px;
    margin: -3px;
  }
  .detail-pane,
  .review-grid :global(.queue) {
    min-width: 0;
    position: sticky;
    top: calc(var(--bar-height, 56px) + 12px);
    max-height: calc(100dvh - var(--bar-height, 56px) - 24px);
    overflow-y: auto;
  }
  :global(.has-live) .detail-pane,
  :global(.has-live) .review-grid :global(.queue) {
    top: calc(var(--bar-height, 56px) + 63px);
    max-height: calc(100dvh - var(--bar-height, 56px) - 75px);
  }
  .others-hint {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--sunken);
    color: var(--muted);
    font: 400 12px/1.5 var(--sans);
  }
  @container (min-width:640px) {
    .ev-head h1 {
      font-size: 36px;
    }
  }
  @container (min-width:1000px) {
    .ev-head h1 {
      font-size: 40px;
    }
  }
  @container (max-width:759px) {
    .review-grid {
      display: block;
    }
    .review-grid :global(.queue) {
      position: static;
      max-height: none;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
  }
  @container (max-width:560px) {
    .ev-head {
      flex-wrap: nowrap;
      align-items: center;
      margin-bottom: 18px;
      gap: 8px;
    }
    .ev-head p {
      display: none;
    }
    .queue-tabs {
      width: 100%;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .queue-tabs a {
      flex: 1 0 auto;
      gap: 4px;
      padding: 0 5px;
      min-width: 0;
      font-size: 12px;
    }
    .queue-tabs :global(.filter-icon) {
      display: none;
    }
    .queue-search {
      flex: 1 1 48%;
    }
    .hearing-select {
      flex: 1 1 40%;
      width: 0;
    }
  }
  @container (max-width:335px) {
    .queue-tabs {
      padding-inline: 2px;
    }
    .queue-tabs .count {
      min-width: 14px;
      padding-inline: 2px;
    }
    .queue-tabs a {
      padding-inline: 1px;
      font-size: 11px;
      gap: 1px;
    }
  }
  @media (pointer: coarse) {
    .finding-views a,
    .queue-tabs a,
    .queue-search,
    .hearing-select {
      min-height: 40px;
    }
    .queue-search input {
      min-height: 38px;
    }
  }
</style>
