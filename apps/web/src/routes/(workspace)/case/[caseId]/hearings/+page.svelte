<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { Mic, Plus, Search, ShieldCheck, Speech, Trash2, Undo2, X } from '@lucide/svelte';
  import { needsReview, type Hearing } from '@jude/core/domain';
  import { api } from '$lib/client';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import HearingForm from '$lib/workspace/HearingForm.svelte';
  import HearingRow from '$lib/workspace/HearingRow.svelte';
  import { formatDate } from '$lib/workspace/format';
  let { data } = $props();
  const w = $derived(data.workspace),
    en = $derived(data.lang === 'en'),
    base = $derived('/case/' + w.caseRecord.id + '/hearings');
  const live = $derived(w.hearings.find((h) => h.mode === 'live'));
  let query = $state(''),
    reviewOnly = $state(false),
    create = $state(false),
    flow = $state(''),
    scheduled = $state<Hearing>();
  let manage = $state(false),
    removing = $state<Hearing>(),
    removed = $state<Hearing>(),
    busy = $state(false),
    error = $state('');
  const initial = $derived(page.url.searchParams.get('new') || '');
  const filtered = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase();
    return [...w.hearings]
      .sort((a, b) => b.number - a.number)
      .flatMap((h) => {
        if (reviewOnly && !w.findings.some((f) => f.hearingId === h.id && needsReview(f))) return [];
        const match = term
          ? w.statements.find((s) => s.hearingId === h.id && s.text.toLocaleLowerCase().includes(term))
          : undefined;
        const fields = [
          h.title.id,
          h.title.en,
          h.date,
          formatDate(h.date, data.lang, true),
          formatDate(h.date, data.lang),
          String(h.number),
        ];
        return !term || match || fields.some((value) => value.toLocaleLowerCase().includes(term))
          ? [{ h, match }]
          : [];
      });
  });
  function open(selected = '', hearing?: Hearing) {
    flow = selected;
    scheduled = hearing;
    create = true;
  }
  function close() {
    create = false;
    scheduled = undefined;
    flow = '';
    if (initial) void goto(base, { replaceState: true, keepFocus: true, noScroll: true });
  }
  async function change(h: Hearing, restore = false) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await api(
        '/api/cases/' + w.caseRecord.id + '/hearings/' + h.id + (restore ? '/restore' : ''),
        restore ? 'POST' : 'DELETE',
      );
      removing = undefined;
      removed = restore ? undefined : h;
      await invalidateAll();
    } catch (e) {
      error =
        e instanceof Error ? e.message : en ? 'Could not save the change.' : 'Perubahan belum tersimpan.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{en ? 'Hearings' : 'Sidang'} · Jude</title></svelte:head>
<div class="library">
  <header class="library-head">
    <div>
      <h1>{en ? 'Hearings' : 'Sidang'}</h1>
      <p>
        {en
          ? 'A complete record of every examination. Record live, upload audio or import a transcript.'
          : 'Catatan lengkap setiap pemeriksaan. Rekam langsung, unggah audio, atau impor transkrip.'}
      </p>
    </div>
    {#if !w.caseRecord.archived}<div class="toolbar" data-tour="hearings-new">
        {#if live}<a class="button" href={base + '/' + live.id}
            ><Mic size={16} />{en ? 'Open live hearing' : 'Buka sidang langsung'}</a
          >{:else if data.transcription || w.caseRecord.label === 'synthetic'}<button
            class="button"
            onclick={() => open('live')}><Mic size={16} />{en ? 'Record live' : 'Rekam langsung'}</button
          >{/if}<button class="button primary" onclick={() => open()}
          ><Plus size={16} />{en ? 'New hearing' : 'Sidang baru'}</button
        >
      </div>{/if}
  </header>
  {#if w.hearings.length}<div class="filters">
      <label class="search"
        ><Search size={16} /><input
          type="search"
          bind:value={query}
          placeholder={en ? 'Find a hearing or transcript phrase…' : 'Cari sidang atau frasa transkrip…'}
          aria-label={en ? 'Search hearings' : 'Cari sidang'}
        /></label
      ><button class="filter" aria-pressed={reviewOnly} onclick={() => (reviewOnly = !reviewOnly)}
        ><ShieldCheck size={14} />{en ? 'Needs review' : 'Perlu ditinjau'}</button
      ><span class="result" role="status"
        >{filtered.length} {en ? 'of' : 'dari'} {w.hearings.length} {en ? 'hearings' : 'sidang'}</span
      >
    </div>
    <div class="rows" data-tour="hearings-list">
      {#each filtered as { h, match } (h.id)}<HearingRow
          {w}
          {h}
          lang={data.lang}
          {match}
          term={query.trim()}
          onstart={w.caseRecord.archived ? undefined : () => open('live', h)}
        />
        {#if manage && h.mode !== 'live'}<button
            class="remove"
            onclick={() => {
              removing = h;
              error = '';
            }}><Trash2 size={14} />{en ? 'Remove' : 'Hapus'} · {h.title[data.lang]}</button
          >{/if}
      {:else}<div class="empty">
          <p>{en ? 'No hearings match these filters.' : 'Tidak ada sidang yang cocok dengan filter ini.'}</p>
          <button
            class="button"
            onclick={() => {
              query = '';
              reviewOnly = false;
            }}>{en ? 'Clear filters' : 'Hapus filter'}</button
          >
        </div>{/each}
    </div>
    {#if !w.caseRecord.archived && w.hearings.some((h) => h.mode !== 'live')}<button
        class="manage"
        aria-pressed={manage}
        onclick={() => (manage = !manage)}
        >{manage ? (en ? 'Done' : 'Selesai') : en ? 'Manage hearings' : 'Kelola sidang'}</button
      >{/if}
  {:else}<section class="empty">
      <span class="empty-icon"><Speech size={22} aria-hidden="true" /></span>
      <h2>{en ? 'Your first hearing starts here.' : 'Sidang pertama Anda dimulai di sini.'}</h2>
      <p>
        {en
          ? 'Schedule an examination, record a hearing or bring in a transcript.'
          : 'Jadwalkan pemeriksaan, rekam sidang, atau impor transkrip.'}
      </p>
      {#if !w.caseRecord.archived}<button class="button" onclick={() => open()}
          >{en ? 'Add a hearing' : 'Tambahkan sidang'}</button
        >{/if}
    </section>{/if}
  {#if removed}<div class="notice" role="status">
      {en ? 'Hearing removed.' : 'Sidang dihapus.'}<button
        disabled={busy}
        onclick={() => change(removed!, true)}><Undo2 size={14} />{en ? 'Undo' : 'Urungkan'}</button
      ><button aria-label={en ? 'Dismiss' : 'Tutup'} onclick={() => (removed = undefined)}
        ><X size={14} /></button
      >
    </div>{/if}
  {#if error && !removing}<p class="error-text" role="alert">{error}</p>{/if}
</div>
{#if create || initial}<HearingForm
    workspace={w}
    lang={data.lang}
    initial={flow || initial}
    {scheduled}
    {close}
    transcription={data.transcription}
    guest={data.account.user.guest}
  />{/if}
{#if removing}<Dialog
    title={en ? 'Remove this hearing?' : 'Hapus sidang ini?'}
    lang={data.lang}
    close={() => (removing = undefined)}
    ><div class="stack">
      <p>{removing.title[data.lang]}</p>
      <p class="small">
        {en
          ? 'Its transcript and recording will leave the active case. You can undo this change.'
          : 'Transkrip dan rekamannya akan dihapus dari perkara aktif. Anda dapat mengurungkan perubahan ini.'}
      </p>
      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      <div class="actions">
        <button class="button danger" disabled={busy} onclick={() => change(removing!)}
          >{en ? 'Remove hearing' : 'Hapus sidang'}</button
        ><button class="button" onclick={() => (removing = undefined)}>{en ? 'Cancel' : 'Batal'}</button>
      </div>
    </div></Dialog
  >{/if}

<style>
  .library {
    container-type: inline-size;
    --library-control-height: 36px;
  }
  .library-head,
  .toolbar,
  .filters,
  .search,
  .filter,
  .notice,
  .notice button,
  .remove {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .library-head {
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px 28px;
    flex-wrap: wrap;
    padding-top: 1px;
    margin-bottom: 28px;
  }
  .library-head h1 {
    font: 400 40px/1.08 var(--display);
    letter-spacing: -0.012em;
    color: var(--ink-strong);
  }
  .library-head p {
    max-width: 62ch;
    margin-top: 8px;
    font: 400 14.5px/1.55 var(--sans);
    text-wrap: pretty;
    color: var(--muted);
  }
  .empty p {
    max-width: 46ch;
    color: var(--muted);
  }
  .toolbar,
  .filters {
    flex-wrap: wrap;
  }
  .toolbar {
    max-width: 100%;
    gap: 8px;
  }
  .toolbar .button {
    gap: 7px;
    min-height: var(--library-control-height);
    padding: 0 14px;
    border-radius: 6px;
    font: 500 13px/1.2 var(--sans);
    box-shadow: 0 1px 1px rgb(16 33 25 / 4%);
  }
  .toolbar .button:not(.primary) {
    color: var(--ink-strong);
    border-color: var(--line-strong);
  }
  .toolbar :global(.lucide-mic) {
    color: var(--live);
  }
  .filters {
    gap: 10px 12px;
    margin-bottom: 10px;
  }
  .search {
    flex: 1 1 280px;
    gap: 8px;
    padding: 0 11px;
    min-height: var(--library-control-height);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--muted);
  }
  .search > :global(svg) {
    flex: none;
  }
  .search input {
    width: 100%;
    min-width: 0;
    min-height: calc(var(--library-control-height) - 2px);
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--ink);
    font: 400 14px/1.4 var(--sans);
  }
  .search input::placeholder {
    color: var(--muted);
  }
  .search:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .search input:focus-visible {
    outline: none;
  }
  .manage,
  .notice button,
  .remove {
    min-height: 40px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    font-size: 0.85rem;
    padding: 5px 10px;
  }
  .filter {
    min-height: var(--library-control-height);
    gap: 7px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    font: 500 12px/1.55 var(--sans);
  }
  .filter:hover {
    background: var(--sunken);
  }
  .filter[aria-pressed='true'] {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .result {
    font: 400 13px/1.55 var(--sans);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: 12px;
    padding: 30px 0;
  }
  section.empty {
    justify-items: center;
    gap: 10px;
    text-align: center;
    padding: 56px 20px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--selected);
    color: var(--ink-strong);
  }
  .empty h2 {
    font-size: 26px;
    color: var(--ink-strong);
  }
  .manage {
    display: block;
    margin: 8px 0 0 auto;
    min-height: var(--library-control-height);
    padding: 0 2px;
    color: var(--muted);
    border-color: transparent;
    background: transparent;
    text-decoration: underline;
    text-underline-offset: 0.22em;
  }
  .manage:hover,
  .manage[aria-pressed='true'] {
    color: var(--ink-strong);
  }
  .remove {
    color: var(--accent);
    margin-top: 7px;
  }
  .notice {
    margin: 13px 0 0;
    padding: 9px 13px;
    background: var(--wash);
    border-radius: 6px;
  }
  .notice button:first-of-type {
    margin-left: auto;
  }
  @container (max-width: 932px) {
    .library-head h1 { font-size: 36px; }
  }
  @container (max-width: 596px) {
    .library-head { padding-top: 3px; }
    .library-head h1 { font-size: 30px; }
  }
  @media (pointer: coarse), (max-width: 640px) {
    .library { --library-control-height: 44px; }
  }
</style>
