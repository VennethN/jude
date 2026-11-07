<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { ApiError, write } from '$lib/client';
  import { ArrowLeft, Search, SquarePen, Trash2 } from '@lucide/svelte';
  import type { PageData } from './$types';
  import type { ContextRef, Thread } from '@jude/core/domain';
  import { apiPath, casePath, local } from '$lib/evidence/records';
  import { contextKey, contextLabel, threadContexts } from '$lib/evidence/thread-context';
  import ContextChip from '$lib/evidence/ContextChip.svelte';
  import Assistant from '$lib/evidence/Assistant.svelte';
  import '$lib/evidence/evidence.css';
  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace),
    lang = $derived(data.lang),
    id = $derived(lang === 'id');
  let base = $derived(casePath(w) + '/assistant'),
    active = $derived(page.params.threadId || '');
  let query = $state(''),
    scope = $state(''),
    deleted = $state(''),
    confirmDelete = $state(''),
    busy = $state(false),
    problem = $state('');
  const current = $derived(w.threads.find((thread) => thread.id === active));
  const invalid = $derived(active && active !== 'new' && !current);
  const refs = $derived(new Map(w.threads.map((thread) => [thread.id, threadContexts(w, thread)])));
  const sources = $derived.by(() => {
    const counts = new Map<string, { ref: ContextRef; count: number }>();
    for (const { references } of refs.values())
      for (const ref of references) {
        const key = contextKey(ref),
          item = counts.get(key);
        if (item) item.count++;
        else counts.set(key, { ref, count: 1 });
      }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  });
  const history = $derived(
    w.threads
      .filter((t) => {
        const q = query.trim().toLocaleLowerCase(lang);
        return (
          (!q ||
            [local(t.title, lang), ...t.messages.map((m) => local(m.text, lang))].some((text) =>
              text.toLocaleLowerCase(lang).includes(q),
            )) &&
          (!scope || refs.get(t.id)?.references.some((ref) => contextKey(ref) === scope))
        );
      })
      .toSorted((a, b) => b.updated - a.updated),
  );
  const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(ms);
  function group(thread: Thread) {
    const d = dayKey(thread.updated),
      now = Date.now();
    if (d === dayKey(now)) return id ? 'Hari ini' : 'Today';
    if (d === dayKey(now - 86_400_000)) return id ? 'Kemarin' : 'Yesterday';
    return id ? 'Sebelumnya' : 'Earlier';
  }
  function when(time: number) {
    const options: Intl.DateTimeFormatOptions =
      dayKey(time) === dayKey(Date.now())
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : { day: 'numeric', month: 'short' };
    return new Intl.DateTimeFormat(id ? 'id-ID' : 'en-GB', { ...options, timeZone: 'Asia/Jakarta' }).format(
      time,
    );
  }
  async function remove(threadId: string) {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      await write(apiPath(w, 'threads/' + encodeURIComponent(threadId)), 'DELETE');
      deleted = threadId;
      confirmDelete = '';
      if (active === threadId) await goto(base);
    } catch (e) {
      problem = e instanceof ApiError ? e.message : id ? 'Penghapusan gagal.' : 'Could not delete.';
    } finally {
      busy = false;
    }
  }
  async function restore() {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      await write(apiPath(w, 'threads/' + encodeURIComponent(deleted) + '/restore'), 'POST');
      deleted = '';
    } catch (e) {
      problem = e instanceof ApiError ? e.message : id ? 'Pemulihan gagal.' : 'Could not restore.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{id ? 'Asisten perkara' : 'Case assistant'} · Jude</title></svelte:head>
<div class="ev-page assistant-page">
  <header class="ev-head page-heading" class:in-thread={active && !invalid}>
    <div>
      <h1>{id ? 'Asisten' : 'Assistant'}</h1>
      <p>
        {id
          ? 'Gabungkan konteks sidang, dokumen, dan temuan dalam satu pertanyaan. Setiap percakapan menyimpan sumber yang dipakai.'
          : 'Ask across hearings, documents and findings. Each conversation keeps the sources used to answer it.'}
      </p>
    </div>
  </header>
  {#if problem}<p role="alert" class="ev-error">{problem}</p>{/if}
  {#if deleted}<div class="ev-notice ev-inline" role="status">
      {id ? 'Percakapan dihapus.' : 'Conversation deleted.'}<button
        class="ev-button"
        disabled={busy}
        onclick={restore}>{id ? 'Urungkan' : 'Undo'}</button
      >
    </div>{/if}
  {#if invalid}<p class="ev-notice" role="status">
      {id ? 'Percakapan tidak ditemukan.' : 'Conversation not found.'}
    </p>{/if}
  <div class="workspace" class:opened={!!active && !invalid}>
    <aside
      class="history"
      data-tour="assistant-history"
      aria-label={id ? 'Riwayat percakapan' : 'Conversation history'}
    >
      <a class="button primary new" href={base + '/new'}
        ><SquarePen size={16} />{id ? 'Percakapan baru' : 'New conversation'}</a
      >
      <label class="ev-search"
        ><Search size={15} /><input
          bind:value={query}
          type="search"
          aria-label={id ? 'Cari percakapan' : 'Search conversations'}
          placeholder={id ? 'Cari percakapan…' : 'Search conversations…'}
        /></label
      >
      {#if sources.length > 1}
        <div
          class="filters"
          role="group"
          aria-label={id ? 'Saring menurut konteks atau sumber kutipan' : 'Filter by context or cited source'}
        >
          <button aria-pressed={!scope} onclick={() => (scope = '')}>{id ? 'Semua' : 'All'}</button>
          {#each sources as { ref } (contextKey(ref))}
            <button
              aria-pressed={scope === contextKey(ref)}
              title={contextLabel(w, ref, lang)}
              onclick={() => (scope = scope === contextKey(ref) ? '' : contextKey(ref))}
              >{contextLabel(w, ref, lang)}</button
            >
          {/each}
        </div>
      {/if}
      <ul class="threads">
        {#each history as t, i (t.id)}
          {@const evidence = refs.get(t.id)!}
          {@const firstInDay = !i || group(t) !== group(history[i - 1])}
          <li class="history-row" class:first-in-day={firstInDay}>
            {#if firstInDay}<h2 class="day">{group(t)}</h2>{/if}
            <a
              class="thread"
              href={base + '/' + encodeURIComponent(t.id)}
              aria-current={t.id === active ? 'page' : undefined}
            >
              <span class="thread-heading">
                <strong>{local(t.title, lang) || (id ? 'Percakapan baru' : 'New conversation')}</strong>
                <time datetime={new Date(t.updated).toISOString()}>{when(t.updated)}</time>
              </span>
              <small class="thread-meta">
                <span
                  >{t.messages.length} {id ? 'pesan' : t.messages.length === 1 ? 'message' : 'messages'}</span
                >
                {#if evidence.citationCount}<span
                    >{evidence.citationCount}
                    {id ? 'sumber' : evidence.citationCount === 1 ? 'source' : 'sources'}</span
                  >{/if}
                {#if t.sample}<span>{id ? 'Contoh sintetis' : 'Synthetic example'}</span>{/if}
              </small>
              {#if evidence.used.some((ref) => ref.kind !== 'case')}
                {@const attached = evidence.used.filter((ref) => ref.kind !== 'case')}
                <span class="used">
                  <ContextChip workspace={w} {lang} ref={attached[0]} />
                  {#if attached.length > 1}<small>+{attached.length - 1}</small>{/if}
                </span>
              {/if}
            </a>
          </li>
        {:else}<li class="empty">
            {query || scope
              ? id
                ? 'Tidak ada percakapan yang cocok.'
                : 'No matching conversations.'
              : id
                ? 'Percakapan pertama Anda akan muncul di sini.'
                : 'Your first conversation will appear here.'}
          </li>{/each}
      </ul>
    </aside>
    <section
      class="conversation"
      aria-label={current ? local(current.title, lang) : id ? 'Percakapan baru' : 'New conversation'}
    >
      <header class="conv-head">
        <a class="mobile-back" href={base}
          ><ArrowLeft size={15} />{id ? 'Semua percakapan' : 'All conversations'}</a
        >
        <div class="conv-title">
          <h2>{current ? local(current.title, lang) : id ? 'Percakapan baru' : 'New conversation'}</h2>
          {#if current && refs.get(current.id)?.used.length}<div class="used">
              <small>{id ? 'Konteks yang dipakai' : 'Contexts used'}</small>
              {#each refs.get(current.id)!.used as ref (contextKey(ref))}<ContextChip
                  workspace={w}
                  {lang}
                  {ref}
                  link
                />{/each}
            </div>{/if}
        </div>
        {#if current}{#if current.sample}<span class="sample"
              >{id ? 'Contoh sintetis' : 'Synthetic example'}</span
            >{/if}
          <button
            class="delete"
            aria-label={id ? 'Hapus percakapan' : 'Delete conversation'}
            onclick={() => (confirmDelete = current!.id)}><Trash2 size={16} /></button
          >{/if}
      </header>
      {#if current && confirmDelete === current.id}
        <div
          class="confirm"
          role="group"
          aria-label={id ? 'Hapus percakapan ini?' : 'Delete this conversation?'}
        >
          <span>{id ? 'Hapus percakapan ini?' : 'Delete this conversation?'}</span>
          <button class="ev-button" onclick={() => (confirmDelete = '')}>{id ? 'Batal' : 'Cancel'}</button>
          <button class="ev-button" disabled={busy} onclick={() => remove(current!.id)}
            >{id ? 'Hapus' : 'Delete'}</button
          >
        </div>
      {/if}
      {#key active || 'draft'}<Assistant workspace={w} {lang} threadId={invalid ? undefined : active} />{/key}
    </section>
  </div>
</div>

<style>
  :global(.work:has(.assistant-page)) {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  :global(.work:has(.assistant-page) > .topbar),
  :global(.work:has(.assistant-page) > .session-strip) {
    flex: none;
  }
  :global(#case-main:has(.assistant-page)) {
    display: flex;
    flex: 1;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    padding-bottom: 24px;
  }
  :global(#case-main:has(.assistant-page) > .invite-wrap) {
    flex: none;
  }
  .assistant-page {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    max-width: 1400px;
  }
  .assistant-page > :not(.workspace) {
    flex: none;
  }
  .page-heading {
    margin-bottom: 24px;
  }
  .workspace {
    flex: 1;
    min-height: 0;
    max-height: 900px;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
    align-items: start;
    gap: 16px;
  }
  .history {
    display: grid;
    align-content: start;
    gap: 10px;
    min-width: 0;
    max-height: 100%;
    overflow: auto;
    padding: 2px 4px 2px 0;
  }
  .new {
    justify-self: start;
  }
  .history .ev-search {
    min-width: 0;
    background: var(--surface);
  }
  .filters {
    min-width: 0;
    display: flex;
    overflow-x: auto;
    gap: 6px;
    padding: 2px;
    scrollbar-width: thin;
  }
  .filters button,
  .delete {
    appearance: none;
    font-family: var(--sans);
    cursor: pointer;
  }
  .filters button {
    flex: none;
    max-width: 23ch;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    padding: 4px 10px;
    min-height: 30px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
  }
  .filters button[aria-pressed='true'] {
    background: var(--selected);
    border-color: var(--selected-line);
  }
  .threads {
    display: grid;
    gap: 0;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .day,
  .conv-head small,
  .sample,
  .thread small {
    color: var(--muted);
    font: 500 12px/1.45 var(--sans);
  }
  .day {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 2px;
    padding: 0 8px;
    color: var(--ink-strong);
    font-weight: 650;
  }
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line-strong);
  }
  .history-row {
    min-width: 0;
  }
  .history-row + .history-row:not(.first-in-day) {
    border-top: 1px solid var(--line-strong);
  }
  .thread {
    display: grid;
    gap: 5px;
    margin: 3px 0;
    padding: 10px 11px;
    border: 1px solid transparent;
    border-radius: 8px;
    text-decoration: none;
    min-width: 0;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .thread:hover {
    background: var(--sunken);
  }
  .thread[aria-current] {
    border-color: var(--selected-line);
    background: var(--selected);
  }
  .thread[aria-current] small,
  .thread[aria-current] time {
    color: color-mix(in srgb, var(--muted) 70%, var(--ink-strong));
  }
  .thread strong {
    color: var(--ink-strong);
    font: 600 14px/1.35 var(--sans);
    overflow-wrap: anywhere;
  }
  .thread-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
  }
  .thread-heading time {
    white-space: nowrap;
    color: var(--muted);
    font: 500 11.5px/1.4 var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .thread-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 6px;
  }
  .thread-meta span + span::before {
    content: '·';
    margin-right: 6px;
  }
  .used,
  .confirm {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }
  .empty {
    padding: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .conversation {
    min-width: 0;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
  }
  .conv-head {
    flex: none;
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px 10px;
    padding: 14px 14px 12px 18px;
    border-bottom: 1px solid var(--line);
  }
  .conv-title {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 6px;
  }
  .conv-title h2 {
    font: 400 23px/1.2 var(--display);
    color: var(--ink-strong);
    overflow-wrap: anywhere;
    letter-spacing: -0.005em;
  }
  .sample {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .delete {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 6px;
    color: var(--muted);
    display: grid;
    place-items: center;
    background: transparent;
  }
  .delete:hover {
    background: var(--sunken);
    color: var(--ink);
  }
  .confirm {
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
  }
  .confirm span {
    flex: 1;
  }
  .mobile-back {
    display: none;
  }
  @container (max-width:879px) {
    .workspace {
      display: block;
    }
    .history {
      max-height: 100%;
      overflow: auto;
      padding: 0;
    }
    .page-heading.in-thread,
    .workspace.opened .history,
    .workspace:not(.opened) .conversation {
      display: none;
    }
    .conv-title .used {
      flex-wrap: nowrap;
      overflow: auto;
      scrollbar-width: thin;
    }
    .conv-title .used > :global(*) {
      flex: none;
    }
    .mobile-back {
      display: inline-flex;
      flex-basis: 100%;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--muted);
      text-decoration: none;
    }
  }
  @container (max-width:479px) {
    .conv-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 5px 8px;
      padding: 8px 12px 10px;
    }
    .mobile-back {
      grid-row: 1;
      grid-column: 1;
      min-height: 32px;
    }
    .conv-head .sample {
      grid-row: 1;
      grid-column: 2;
    }
    .conv-head .delete {
      grid-row: 1;
      grid-column: 3;
    }
    .conv-title {
      grid-column: 1/-1;
      grid-row: 2;
    }
    .conv-title h2 {
      font-size: 21px;
    }
  }
  @media (max-width: 719px) {
    :global(#case-main:has(.assistant-page)) {
      padding-bottom: calc(78px + env(safe-area-inset-bottom));
    }
    :global(.desk.has-live #case-main:has(.assistant-page)) {
      padding-bottom: calc(134px + env(safe-area-inset-bottom));
    }
  }
  @media (max-height: 560px) {
    .workspace {
      min-height: 340px;
    }
  }
</style>
