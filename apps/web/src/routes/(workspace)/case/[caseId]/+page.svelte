<script lang="ts">
  import { displayCourt, displayTitle, formatDate, timecode } from '$lib/workspace/format';
  import PageHeading from '$lib/workspace/PageHeading.svelte';
  import { page } from '$app/state';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import {
    ArrowDownToLine,
    ArrowRight,
    ArrowUpRight,
    ArrowUp,
    CalendarDays,
    ChevronRight,
    CircleAlert,
    FilePlus2,
    FileText,
    GitFork,
    MessageSquareText,
    Mic,
    Radio,
    Speech,
    Upload,
    Settings2,
    Archive,
    Trash2,
  } from '@lucide/svelte';
  import { ApiError, api } from '$lib/client';
  import { needsReview } from '@jude/core/domain';
  import FindingLink from '$lib/evidence/FindingLink.svelte';
  import CaseForm from '$lib/workspace/CaseForm.svelte';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import HearingRow from '$lib/workspace/HearingRow.svelte';
  import { voice } from '$lib/workspace/hearing-detail/people';
  import { casePrompts } from '$lib/workspace/case-prompts';
  let { data } = $props();
  const w = $derived(data.workspace),
    c = $derived(w.caseRecord),
    base = $derived('/case/' + c.id),
    en = $derived(data.lang === 'en');
  const review = $derived(w.findings.filter(needsReview));
  const empty = $derived(!w.hearings.length && !w.documents.length);
  const live = $derived(w.hearings.find((h) => h.mode === 'live'));
  const today = $derived(
    c.label === 'synthetic' && live
      ? live.date
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
  );
  const next = $derived(
    [...w.hearings]
      .filter((h) => h.mode === 'scheduled' && h.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))[0],
  );
  const latest = $derived(w.statements.filter((s) => s.hearingId === live?.id).sort((a, b) => b.t - a.t)[0]);
  const pending = $derived(w.connections.filter((link) => !link.reviewed).length);
  let now = $state(0),
    question = $state('');
  $effect(() => {
    if (!live?.startedAt || c.label === 'synthetic') return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const elapsed = $derived(
    live?.startedAt && now ? Math.max(0, (now - Date.parse(live.startedAt)) / 1000) : (latest?.t ?? 0),
  );
  function ask(text: string) {
    const query = text.trim();
    if (!query) return;
    question = '';
    replaceState('', { ...page.state, judePanelQuestion: { caseId: c.id, text: query } });
  }
  let dialog = $state<null | 'menu' | 'edit' | 'remove'>(null),
    message = $state('');
  $effect(() => {
    const { judeCaseMenu, ...rest } = page.state as { judeCaseMenu?: boolean };
    if (judeCaseMenu) {
      replaceState(page.url, rest);
      dialog = 'menu';
    }
  });
  async function action(path: string, method: string) {
    try {
      await api('/api/cases/' + c.id + path, method);
      dialog = null;
      await invalidateAll();
      await goto('/cases');
    } catch (e) {
      message = e instanceof ApiError ? e.message : en ? 'Please try again.' : 'Coba lagi.';
    }
  }
</script>

<svelte:head><title>{displayTitle(c, data.lang)} · Jude</title></svelte:head>
<div class="overview">
  <header class="file-head">
    <div class="file-id" data-tour="case-file">
      <span class="case-type"
        >{c.label === 'synthetic'
          ? en
            ? 'Synthetic material'
            : 'Materi sintetis'
          : en
            ? 'Private case'
            : 'Perkara privat'}</span
      >{#if c.reference}<span>{c.reference}</span>{/if}
    </div>
    <PageHeading art="folder">
      <h1>{displayTitle(c, data.lang)}</h1>
      {#if c.summary[data.lang]}<p class="summary">{c.summary[data.lang]}</p>{/if}
    </PageHeading>
    <dl class="facts">
      <div>
        <dt>{en ? 'Client' : 'Klien'}</dt>
        <dd>{c.client || '—'}</dd>
      </div>
      <div>
        <dt>{en ? 'Court' : 'Pengadilan'}</dt>
        <dd>{displayCourt(c, data.lang) || '—'}</dd>
      </div>
    </dl>
    {#if !empty && !c.archived}<div class="case-actions">
        {#if live}<a class="button" href={base + '/hearings/' + live.id}
            ><Radio size={16} />{en ? 'Open live hearing' : 'Buka sidang langsung'}</a
          >
        {:else if c.label === 'synthetic' || data.canTranscribe}<a
            class="button primary"
            href={base + '/hearings?new=live'}><Mic size={16} />{en ? 'Record a hearing' : 'Rekam sidang'}</a
          >{/if}
        {#if data.canTranscribe}<a class="button" href={base + '/hearings?new=audio'}
            ><Upload size={16} />{en ? 'Upload audio' : 'Unggah audio'}</a
          >{/if}
        <a class="button" href={base + '/documents'}
          ><FilePlus2 size={16} />{en ? 'Add documents' : 'Tambah dokumen'}</a
        >
      </div>{/if}
  </header>
  {#if empty}
    <section class="empty-file">
      <h2>{en ? 'Start with your case material.' : 'Mulai dari materi perkara Anda.'}</h2>
      <p>
        {en
          ? 'Documents hold the sources. Hearings hold the testimony.'
          : 'Dokumen menyimpan sumber. Sidang menyimpan keterangan.'}
      </p>
      <a href={base + '/documents'}
        ><FilePlus2 size={20} /><span
          ><strong>{en ? 'Add the first document' : 'Tambahkan dokumen pertama'}</strong><small
            >{en
              ? 'File a brief, a witness statement or an exhibit.'
              : 'Simpan dakwaan, BAP, atau barang bukti.'}</small
          ></span
        ><ArrowRight size={16} /></a
      >
      <a href={base + '/hearings?new=1'}
        ><Speech size={20} /><span
          ><strong>{en ? 'Add a hearing' : 'Tambahkan sidang'}</strong><small
            >{en
              ? 'Schedule an examination or import an existing transcript.'
              : 'Jadwalkan pemeriksaan atau impor transkrip yang sudah ada.'}</small
          ></span
        ><ArrowRight size={16} /></a
      >
    </section>
  {:else}
    {#if live}<section class="live-brief" aria-label={en ? 'Current hearing' : 'Sidang berlangsung'}>
        <div class="live-meta">
          <Radio size={16} /><b
            >{c.label === 'synthetic'
              ? en
                ? 'Example hearing'
                : 'Sidang contoh'
              : en
                ? 'Live hearing'
                : 'Sidang langsung'}</b
          ><time>{timecode(elapsed)}</time>
        </div>
        <div class="live-heading">
          <h2>{live.title[data.lang]}</h2>
          <a href={base + '/hearings/' + live.id}
            >{en ? 'Open hearing' : 'Buka sidang'}<ArrowRight size={15} /></a
          >
        </div>
        {#if latest}<a class="latest-line" href={base + '/hearings/' + live.id + '?s=' + latest.id}
            ><span class="initial" aria-hidden="true"
              >{voice(w.speakers, latest.speakerId, data.lang).letters}</span
            ><span
              ><small>{voice(w.speakers, latest.speakerId, data.lang).name}</small><q>{latest.text}</q></span
            ></a
          >
        {:else}<p>
            {en ? 'Waiting for the first transcript line.' : 'Menunggu baris transkrip pertama.'}
          </p>{/if}
      </section>{/if}
    <div class="columns">
      <div class="column">
        <section class="folio review">
          <div class="heading">
            <h2><CircleAlert size={16} />{en ? 'Worth a look' : 'Perlu dicek'}</h2>
            {#if review.length}<span class="count">{review.length}</span>{/if}
          </div>
          {#if review.length}
            <ul class="review-list">
              {#each review.slice(0, 3) as finding (finding.id)}
                <li><FindingLink workspace={w} {finding} lang={data.lang} showHearing /></li>
              {/each}
            </ul>
            <a class="button primary start-review" href={base + '/findings'}>
              {en ? 'Start reviewing' : 'Mulai meninjau'}<ArrowRight size={16}/>
            </a>
          {:else}<p class="muted">
              {w.findings.length
                ? en
                  ? 'Every finding has been reviewed.'
                  : 'Semua temuan sudah ditinjau.'
                : en
                  ? 'No findings in this case yet.'
                  : 'Belum ada temuan di perkara ini.'}
            </p>{/if}
        </section>
        <section class="folio">
          <div class="heading">
            <h2><Speech size={18} />{en ? 'Hearings' : 'Sidang'}</h2>
            <a href={base + '/hearings'}>{en ? 'View all' : 'Lihat semua'}<ArrowRight size={14} /></a>
          </div>
          {#each [...w.hearings].sort((a, b) => a.number - b.number) as h (h.id)}<HearingRow
              {w}
              {h}
              lang={data.lang}
              compact
            />{:else}<p class="muted">
              {en
                ? 'Record, upload audio or import an existing transcript.'
                : 'Rekam sidang, unggah audio, atau impor transkrip yang sudah ada.'}
            </p>{/each}
        </section>
      </div>
      <div class="column">
        <section class="folio">
          <div class="heading">
            <h2><CalendarDays size={17} />{en ? 'Next hearing' : 'Sidang berikutnya'}</h2>
          </div>
          {#if next}<div class="calendar-entry">
              <span class="leaf" aria-hidden="true"
                ><small
                  >{new Intl.DateTimeFormat(data.lang === 'id' ? 'id-ID' : 'en-GB', {
                    month: 'short',
                    timeZone: 'Asia/Jakarta',
                  }).format(new Date(next.date))}</small
                ><b>{Number(next.date.slice(8))}</b></span
              >
              <div>
                <a href={base + '/hearings/' + next.id}>{next.title[data.lang]}</a><small
                  >{formatDate(next.date, data.lang, true)}{next.time
                    ? ' · ' + next.time + ' WIB'
                    : ''}</small
                >
              </div>
            </div>
            <button class="text-action" onclick={() => ask(casePrompts[data.lang][2])}
              >{en ? 'Prepare questions' : 'Siapkan pertanyaan'}<ArrowRight size={15} /></button
            >
          {:else}<p class="muted">{en ? 'No upcoming hearings.' : 'Belum ada jadwal sidang.'}</p>{/if}
        </section>
        <section class="folio ask">
          <div class="heading">
            <h2><MessageSquareText size={17} />{en ? 'Ask about this case' : 'Tanya perkara ini'}</h2>
          </div>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label class="sr-only" for="overview-question"
              >{en ? 'Question about this case' : 'Pertanyaan tentang perkara'}</label
            ><input
              id="overview-question"
              bind:value={question}
              placeholder={en ? 'Ask about the case…' : 'Tulis pertanyaan perkara…'}
            /><button
              class="icon-button"
              type="submit"
              disabled={!question.trim()}
              aria-label={en ? 'Send question' : 'Kirim pertanyaan'}><ArrowUp size={17} /></button
            >
          </form>
          <div class="suggestions">
            {#each casePrompts[data.lang] as prompt}<button onclick={() => ask(prompt)}
                >{prompt}<ArrowUpRight size={13} /></button
              >{/each}
          </div>
        </section>
        <section class="folio">
          <div class="heading">
            <h2><FileText size={17} />{en ? 'Documents' : 'Dokumen'}</h2>
            <a href={base + '/documents'}>{en ? 'View all' : 'Lihat semua'}<ArrowRight size={14} /></a>
          </div>
          <p class="muted doc-count">
            {w.documents.length}
            {en ? 'documents' : 'dokumen'} · {w.passages.length}
            {en ? 'passages' : 'kutipan'} · {w.connections.length}
            {en ? 'connections' : 'keterkaitan'}
          </p>
          {#if pending}<a class="pending" href={base + '/connections'}
              ><GitFork size={13} />{pending} {en ? 'suggested connections' : 'keterkaitan disarankan'}</a
            >{/if}
          {#each w.documents.slice(0, 4) as doc (doc.id)}<a
              class="doc-row"
              href={base + '/documents/' + doc.id}
              ><FileText size={15} /><span>{displayTitle(doc, data.lang)}</span><small>{doc.pages} {en ? 'pp.' : 'hlm.'}</small
              ></a
            >{/each}
          {#if w.documents.length > 4}<a class="text-action" href={base + '/documents'}
              >+{w.documents.length - 4}
              {en ? 'more documents' : 'dokumen lainnya'}<ArrowRight size={13} /></a
            >{/if}
        </section>
      </div>
    </div>
  {/if}
</div>
{#if dialog === 'edit'}<CaseForm record={c} lang={data.lang} close={() => (dialog = null)} />{/if}
{#if dialog === 'menu' || dialog === 'remove'}<Dialog
    title={dialog === 'menu'
      ? en
        ? 'Case menu'
        : 'Menu perkara'
      : en
        ? 'Delete this case?'
        : 'Hapus perkara ini?'}
    lang={data.lang}
    close={() => (dialog = null)}
  >
    {#if dialog === 'menu'}<div class="stack">
        <button class="button" onclick={() => (dialog = 'edit')}
          ><Settings2 size={17} />{en ? 'Case settings' : 'Pengaturan perkara'}</button
        ><a class="button" href={'/api/cases/' + c.id + '/export'} download
          ><ArrowDownToLine size={17} />{en ? 'Export .jude archive' : 'Ekspor arsip .jude'}</a
        ><button class="button" onclick={() => action(c.archived ? '/unarchive' : '/archive', 'POST')}
          ><Archive size={17} />{c.archived
            ? en
              ? 'Unarchive'
              : 'Buka arsip'
            : en
              ? 'Archive case'
              : 'Arsipkan perkara'}</button
        ><button class="button danger" onclick={() => (dialog = 'remove')}
          ><Trash2 size={17} />{en ? 'Delete case' : 'Hapus perkara'}</button
        >
      </div>
    {:else}<div class="stack">
        <p>
          {en
            ? 'Remove this case and its records from your workspace?'
            : 'Hapus perkara dan catatannya dari ruang kerja Anda?'}
        </p>
        <div class="actions">
          <button class="button danger" onclick={() => action('', 'DELETE')}
            >{en ? 'Delete case' : 'Hapus perkara'}</button
          ><button class="button" onclick={() => (dialog = null)}>{en ? 'Cancel' : 'Batal'}</button>
        </div>
      </div>{/if}{#if message}<p class="error-text" role="alert">{message}</p>{/if}</Dialog
  >{/if}

<style>
  .overview {
    container-type: inline-size;
  }
  .file-head {
    max-width: 76rem;
    margin: 0 0 25px;
  }
  .file-id,
  .case-actions,
  .facts,
  .facts div,
  .heading,
  .heading h2,
  .heading a,
  .live-meta,
  .live-heading,
  .live-heading a,
  .latest-line,
  .calendar-entry,
  .text-action,
  .doc-row,
  .pending {
    display: flex;
    align-items: center;
  }
  .file-id {
    margin-bottom: 10px;
    gap: 12px;
    color: var(--muted);
    font-size: 0.83rem;
    font-variant-numeric: tabular-nums;
  }

  .case-type {
    padding: 2px 8px;
    background: var(--wash);
    color: var(--ink);
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .file-head h1 {
    font:
      400 clamp(2rem, 3.7cqi, 3rem)/1.1 Rufina,
      Georgia,
      serif;
    letter-spacing: -0.035em;
    margin: 0;
  }
  .summary {
    margin-top: 8px;
    max-width: 75ch;
  }
  .facts {
    margin: 11px 0 0;
    gap: 4px 25px;
    flex-wrap: wrap;
    font-size: 0.87rem;
  }
  .facts div {
    gap: 7px;
  }
  .facts dt,
  .calendar-entry small,
  .heading a,
  .doc-row small {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    font-weight: 600;
  }
  .case-actions {
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 15px;
  }
  .case-actions .button {
    min-height: 38px;
    font-size: 0.84rem;
  }
  .live-brief,
  .folio,
  .empty-file {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    padding: clamp(17px, 2.2cqi, 25px);
    min-width: 0;
  }
  .live-brief {
    margin-bottom: 16px;
    background: linear-gradient(
      105deg,
      color-mix(in srgb, var(--accent) 7%, var(--surface)),
      var(--surface) 75%
    );
    border-color: color-mix(in srgb, var(--accent) 30%, var(--line));
  }
  .live-meta {
    gap: 8px;
    color: var(--accent);
    font-size: 0.8rem;
  }
  .live-meta time {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .live-heading {
    justify-content: space-between;
    gap: 16px;
    margin: 5px 0 13px;
  }
  .live-heading h2 {
    font-size: clamp(1.5rem, 2.6cqi, 2rem);
  }
  .live-heading a,
  .heading a,
  .text-action {
    gap: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    text-decoration: none;
  }
  .live-heading a {
    white-space: nowrap;
  }
  .overview a:hover,
  .overview button.text-action:hover {
    text-decoration: underline;
  }
  .latest-line {
    gap: 11px;
    text-decoration: none;
    width: fit-content;
    max-width: 100%;
  }
  .latest-line span:last-child {
    min-width: 0;
  }
  .initial {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 50%;
    background: var(--wash);
    color: var(--ink);
    font-size: 0.74rem;
    font-weight: 600;
  }
  .latest-line small {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .latest-line q {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-size: 1rem;
  }
  .columns {
    display: grid;
    gap: 16px;
    align-items: start;
  }
  .column {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  @container (min-width:860px) {
    .columns {
      grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr);
    }
  }
  .heading {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .heading h2 {
    font: 600 1.03rem/1.4 var(--sans);
    letter-spacing: -0.02em;
    gap: 9px;
  }
  .heading h2 :global(svg) {
    color: var(--muted);
  }
  .heading a {
    min-height: 28px;
  }
  .count {
    background: var(--st-inconsistency-bg);
    color: var(--st-inconsistency-ink);
    min-width: 24px;
    text-align: center;
    border-radius: 25px;
    font-weight: 600;
    font-size: 0.83rem;
  }
  .review-list { list-style: none; display: grid; margin: 0 -10px 12px; padding: 0; }
  .start-review { width: fit-content; }
  .doc-row {
    gap: 9px;
    min-height: 43px;
    padding: 8px 0;
    text-decoration: none;
    border-bottom: 1px solid var(--line);
    font-size: 0.87rem;
  }
  .doc-row span {
    flex: 1;
  }
  .text-action {
    color: var(--ink);
    background: transparent;
    padding: 0;
    border: 0;
    min-height: 36px;
    margin-top: 6px;
  }
  .calendar-entry {
    gap: 13px;
  }
  .calendar-entry div:last-child {
    min-width: 0;
  }
  .calendar-entry a {
    font-weight: 600;
    text-decoration: none;
    line-height: 1.4;
  }
  .calendar-entry small {
    display: block;
    margin-top: 3px;
    font-size: 0.8rem;
  }
  .leaf {
    display: grid;
    min-width: 49px;
    text-align: center;
    border: 1px solid var(--line);
    border-radius: 7px;
    overflow: hidden;
  }
  .leaf small {
    margin: 0;
    background: var(--forest);
    color: var(--on-forest);
    font: 600 0.73rem/1.6 var(--sans);
    text-transform: uppercase;
  }
  .leaf b {
    padding: 0 8px;
    font: 500 1.7rem/1.4 var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .ask form {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 7px;
    align-items: center;
    background: var(--paper);
  }
  .ask input {
    padding: 8px 9px;
    flex: 1;
    width: 0;
    min-height: 44px;
    border: 0;
    background: transparent;
  }
  .ask form .icon-button {
    margin-right: 4px;
    width: 34px;
    min-width: 34px;
    height: 34px;
    min-height: 34px;
  }
  .suggestions {
    margin-top: 8px;
  }
  .suggestions button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
    width: 100%;
    text-align: left;
    min-height: 36px;
    padding: 7px 0;
    color: var(--muted);
    font-size: 0.81rem;
  }
  .suggestions button:hover {
    color: var(--ink);
  }
  .doc-count,
  .folio > p,
  .live-brief > p,
  .empty-file p {
    font-size: 0.86rem;
    color: var(--muted);
  }
  .pending {
    gap: 6px;
    color: var(--accent);
    width: fit-content;
    font-size: 0.79rem;
    text-decoration: none;
    margin: 7px 0;
  }
  .empty-file {
    max-width: 49rem;
  }
  .empty-file h2 {
    font-size: 2rem;
  }
  .empty-file p {
    margin: 7px 0 22px;
  }
  .empty-file > a {
    display: flex;
    align-items: center;
    gap: 14px;
    text-decoration: none;
    border-top: 1px solid var(--line);
    min-height: 76px;
  }
  .empty-file > a > span {
    flex: 1;
  }
  .empty-file small {
    display: block;
    color: var(--muted);
  }
  @container (max-width:480px) {
    .live-heading {
      align-items: flex-start;
    }
    .live-heading a {
      white-space: normal;
      text-align: right;
    }
    .facts {
      display: grid;
      gap: 4px;
    }
    .file-id {
      gap: 8px;
      flex-wrap: wrap;
    }
  }
  @media (pointer: coarse) {
    .suggestions button,
    .heading a,
    .text-action,
    .live-heading a,
    .case-actions .button {
      min-height: 44px;
    }
  }
</style>
