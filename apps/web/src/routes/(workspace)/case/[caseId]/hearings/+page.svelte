<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { ListChecks, Mic, Plus, Search, Speech, Trash2, Undo2, X } from '@lucide/svelte';
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
            ><Mic size={15} />{en ? 'Open live hearing' : 'Buka sidang langsung'}</a
          >{:else if data.transcription || w.caseRecord.label === 'synthetic'}<button
            class="button"
            onclick={() => open('live')}><Mic size={15} />{en ? 'Record live' : 'Rekam langsung'}</button
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
        ><ListChecks size={15} />{en ? 'Needs review' : 'Perlu ditinjau'}</button
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
      <Speech size={24} />
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
  }
  .library-head,
  .toolbar,
  .filters,
  .search,
  .filter,
  .result,
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
    gap: 18px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .library-head h1 {
    font:400 40px/1.16 var(--display);
    letter-spacing: -0.035em;
  }
  .library-head p,
  .empty p,
  .result {
    font-size: 0.9rem;
    color: var(--muted);
    margin-top: 7px;
  }
  .toolbar,
  .filters {
    flex-wrap: wrap;
  }
  .filters {
    gap:10px 12px; margin-bottom:10px;
  }
  .search {
    flex: 1 1 250px;
    min-height: 42px;
    padding: 0 11px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    color: var(--muted);
  }
  .search input {
    width: 100%;
    min-width: 0;
    min-height: 42px;
    background: transparent;
    border: 0;
  }
  .filter,
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
  .filter[aria-pressed='true'] {
    background: var(--forest);
    color: var(--on-forest);
  }
  .result {
    margin: 0;
    font-size: 0.8rem;
  }
  .toolbar :global(svg.lucide-mic) { color:var(--alert,var(--accent)); }
  .empty {
    display: grid;
    justify-items: start;
    gap: 12px;
    padding: 30px 0;
  }
  .manage {
    margin-top: 17px;
    background: transparent;
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
  .filter { border-radius:999px; }
  .search,.search input,.filter { min-height:36px; }
  .library-head { align-items:center; }
  .library-head p { max-width:66ch; font-size:14px; }
  section.empty { justify-items:center; text-align:center; padding:56px 20px; background:var(--surface); border:1px solid var(--line); border-radius:12px; }
  @container (max-width:500px) {
    .library-head h1 { font-size:30px; }
    .search,.search input,.filter { min-height:44px; }
    .toolbar {
      width: 100%;
    }
    .search {
      flex-basis: 100%;
    }
    .result {
      margin-left: auto;
    }
    .library-head {
      align-items: start;
      gap: 14px;
    }
  }
</style>
