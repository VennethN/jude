<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Bookmark, CheckCheck, ClipboardList, PanelsTopLeft, Search } from '@lucide/svelte';
  import type { PageData } from './$types';
  import type { Finding } from '@jude/core/domain';
  import { casePath, clock, local, meaningful, statuses } from '$lib/evidence/records';
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
    page.url.searchParams.get('tab') ||
      (requested
        ? requested.reviewed
          ? 'checked'
          : meaningful(requested.status)
            ? 'attention'
            : 'others'
        : 'attention')
  );
  let board = $derived(page.url.searchParams.get('view') === 'board');
  let byH = $derived(page.url.searchParams.get('hearing') || ''),
    byD = $derived(page.url.searchParams.get('doc') || '');
  let query = $state('');
  let filtered = $derived(
    w.findings.filter(
      (f) =>
        (!byH || f.hearingId === byH) &&
        (!byD || f.sources.some((s) => w.passages.find((p) => p.id === s.passageId)?.docId === byD))
    )
  );
  let checked = $derived(filtered.filter((f) => f.reviewed));
  let attention = $derived(filtered.filter((f) => !f.reviewed && meaningful(f.status)));
  let others = $derived(filtered.filter((f) => !f.reviewed && !meaningful(f.status)));
  let list = $derived(
    (tab === 'checked' ? checked : tab === 'others' ? others : attention).filter(
      (f) =>
        !query.trim() ||
        (local(f.title, lang) + ' ' + f.said + ' ' + f.question)
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
  let position = $derived(list.findIndex(f => f.id === active?.id));
  let pager = $derived(position >= 0 ? { index: position, total: list.length, step } : undefined);
  function step(delta: number) {
    const next = list[position + delta];
    if (next) void goto(href({ tab }, next), {
      replaceState: !!opened, noScroll: true, keepFocus: true, state: { ...page.state },
    });
  }
  function pick(event: MouseEvent, f: Finding) {
    if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void goto(href({ tab }, f), {
      noScroll: true, keepFocus: true,
      state: { ...page.state, judeFindingsQueue: page.url.pathname === base ? base : undefined },
    });
  }
  function closeSheet() {
    if ((page.state as { judeFindingsQueue?: string }).judeFindingsQueue === base) history.back();
    else void goto(href({ tab }), { replaceState:true, noScroll:true });
  }
  let tabs = $derived([
    { code: 'attention', text: id ? 'Perlu dicek' : 'Needs a look', count: attention.length },
    { code: 'checked', text: id ? 'Diperiksa' : 'Checked', count: checked.length },
    { code: 'others', text: id ? 'Lainnya' : 'Others', count: others.length },
    {
      code: 'saved',
      text: id ? 'Tersimpan' : 'Bookmarked',
      count: w.statements.filter((s) => s.flagged && (!byH || s.hearingId === byH)).length
    }
  ]);
</script>

<svelte:head
  ><title>{board ? (id ? 'Papan temuan' : 'Case board') : id ? 'Temuan' : 'Findings'} · Jude</title
  ></svelte:head
>
<div class="ev-page" class:board bind:clientWidth={width}>
  <header class="ev-head">
    <div>
      <h1>{board ? (id ? 'Papan temuan' : 'Case board') : id ? 'Temuan' : 'Findings'}</h1>
      <p>
        {board
          ? id
            ? 'Susun bukti dan catatan untuk pemeriksaan Anda.'
            : 'Arrange the evidence and your review notes.'
          : id
            ? 'Bandingkan keterangan dengan berkas, lalu catat hasil pemeriksaan.'
            : 'Compare testimony with the record and keep your review notes together.'}
      </p>
    </div>
    <nav class="finding-views" aria-label={id ? 'Tampilan temuan' : 'Findings view'} data-tour="board-open">
      <a href={base} aria-current={!board ? 'page' : undefined}><ClipboardList size={15}/>{id ? 'Daftar' : 'List'}</a>
      <a href={base+'?view=board'} aria-label={id ? 'Buka papan' : 'Open board'} aria-current={board ? 'page' : undefined}>
        <PanelsTopLeft size={15}/>{id ? 'Papan' : 'Board'}
      </a>
    </nav>
  </header>
  {#if board}
    <BoardView workspace={w} {lang} />
  {:else}
    <nav class="ev-tabs" aria-label={id ? 'Filter temuan' : 'Findings filters'} data-tour="findings-tabs">
      {#each tabs as t}<a href={href({ tab: t.code })} aria-current={tab === t.code ? 'page' : undefined}
          >{t.text} <span>{t.count}</span></a
        >{/each}
    </nav>
    <div class="ev-inline filters">
      {#if tab !== 'saved'}<label class="ev-search"
          ><Search size={16} /><input
            type="search"
            bind:value={query}
            aria-label={id ? 'Cari temuan' : 'Search findings'}
            placeholder={id ? 'Cari temuan…' : 'Find a finding…'}
          /></label
        >{/if}
      <select
        class="ev-select"
        aria-label={id ? 'Filter sidang' : 'Filter by hearing'}
        value={byH}
        onchange={(e) => goto(href({ hearing: e.currentTarget.value || null }))}
        ><option value="">{id ? 'Semua sidang' : 'All hearings'}</option>{#each w.hearings as h}<option
            value={h.id}>{id ? 'Sidang' : 'Hearing'} {h.number}</option
          >{/each}</select
      >
      {#if byD}<a class="ev-link" href={href({ doc: null })}
          >{id ? 'Hapus filter dokumen' : 'Clear document filter'}</a
        >{/if}
    </div>
    {#if tab === 'saved'}<SavedLines
        workspace={w}
        {lang}
        hearing={byH}
        selected={page.url.searchParams.get('s') ?? ''}
      />
    {:else if opened && !requested}<div class="ev-empty">
        <h2 class="ev-title">{id ? 'Temuan tidak ditemukan' : 'Finding not found'}</h2>
        <a class="ev-link" href={base}>{id ? 'Kembali ke temuan' : 'Back to findings'}</a>
      </div>
    {:else if list.length || requested}
      <div class="review-grid" class:detail-open={!!opened}>
        <div class="queue" data-tour="findings-queue">
          <ul class="ev-list">
            {#each list as f (f.id)}
              {@const h = w.hearings.find((h) => h.id === f.hearingId)}{@const s = w.statements.find(
                (s) => s.id === f.statementId
              )}
              <li>
                <a
                  class="ev-pick"
                  href={href({ tab }, f)} onclick={(e) => pick(e,f)}
                  aria-current={active?.id === f.id ? 'page' : undefined}
                  ><span class="ev-cap status" data-status={f.status}
                    >{#if f.reviewed}<CheckCheck size={14} />{/if}{statuses[f.status][lang]}</span
                  ><strong>{local(f.title, lang)}</strong><span class="ev-meta"
                    >{id ? 'Sidang' : 'Hearing'} {h?.number} · {clock(s?.t ?? 0)}</span
                  ></a
                >
              </li>
            {/each}
          </ul>
        </div>
        {#if active}
          {#if narrow && requested}
            <Dialog sheet title={id ? 'Temuan' : 'Finding'} {lang} close={closeSheet}>
              {#key active.id}<FindingDetail workspace={w} {lang} finding={active} navigation={pager}/>{/key}
            </Dialog>
          {:else if !narrow && (width || opened)}
            <div class="detail-pane">{#key active.id}<FindingDetail workspace={w} {lang} finding={active} navigation={pager}/>{/key}</div>
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
  .filters {
    margin-bottom: 1rem;
  }
  .ev-tabs span {
    font-variant-numeric: tabular-nums;
    margin-left: 0.15rem;
    font-size: 0.73rem;
    color: var(--muted);
  }
  .review-grid {
    display: grid;
    grid-template-columns: minmax(12rem, 31%) minmax(0, 1fr);
    gap: 1.1rem;
    align-items: start;
  }
  .queue .ev-pick {
    padding: 0.9rem 0.7rem;
  }
  .queue strong {
    display: block;
    line-height: 1.45;
    margin: 0.35rem 0 0.4rem;
  }
  .status {
    color: var(--muted);
  }
  .status[data-status='potential_inconsistency'] {
    color: var(--accent);
  }
  .finding-views { display:inline-flex; align-items:center; padding:3px; align-self:flex-start; background:var(--wash); border:1px solid var(--line); border-radius:8px; }
  .finding-views a { display:inline-flex; gap:7px; align-items:center; padding:6px 12px; border-radius:6px; min-height:36px; text-decoration:none; font-size:.92rem; }
  .finding-views a[aria-current] { background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgb(18 35 25 / .14); }
  @media(pointer:coarse) { .finding-views a { min-height:44px; } }
  .detail-pane {
    min-width: 0;
  }
  .queue {
    position: sticky;
    top: 1rem;
    max-height: 75vh;
    overflow: auto;
  }
  @container (max-width:759px) {
    .review-grid { display:block; }
    .review-grid:not(.detail-open) .detail-pane { display:none; }
    .queue { position:static; max-height:none; }
    .board .ev-head p { display:none; }
    .filters .ev-search {
      flex: 1;
      min-width: min(100%, 12rem);
    }
  }
</style>
