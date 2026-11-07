<script lang="ts">
  import { tick, untrack } from 'svelte';
  import {
    ArrowDown,
    ArrowUpRight,
    Bookmark,
    BookOpen,
    ChevronRight,
    MessageSquareReply,
    Play,
    Search,
    UserRoundPen,
    X
  } from '@lucide/svelte';
  import type { Finding, Lang, Reply, Speaker, Statement, Workspace } from '@jude/core/domain';
  import { write } from '$lib/client';
  import { apiPath, casePath, statuses } from '$lib/evidence/records';
  import Match from '$lib/evidence/Match.svelte';
  import { timecode } from '../format';
  import { roles, voice } from './people';
  let {
    workspace: w,
    lang,
    lines,
    findings,
    replies,
    live,
    partial,
    selected,
    audio,
    textSize = 16,
    inspect,
    showFinding,
    showReply,
    editVoice,
    chooseCounsel,
    jump,
    anchored = false
  }: {
    workspace: Workspace;
    lang: Lang;
    lines: Statement[];
    findings: Finding[];
    replies: Reply[];
    live: boolean;
    partial: string;
    selected: string;
    audio: boolean;
    textSize?: number;
    anchored?: boolean;
    inspect: (kind: 'legal' | 'statement', id: string) => void;
    showFinding: (id: string) => void;
    showReply: (id: string) => void;
    editVoice: (p: Speaker) => void;
    chooseCounsel: () => void;
    jump: (s: Statement, play: boolean) => void;
  } = $props();
  let en = $derived(lang === 'en'),
    searching = $state(false),
    query = $state(''),
    saved = $state(false),
    follow = $state(true),
    pending = $state(0),
    notice = $state(''),
    bookBusy = $state<string[]>([]);
  let pane = $state<HTMLElement>(),
    input = $state<HTMLInputElement>(),
    searchButton = $state<HTMLButtonElement>();
  let q = $derived(query.trim().toLocaleLowerCase()),
    kept = $derived(lines.filter((s) => s.flagged).length);
  let shown = $derived(
    lines.filter(
      (s) =>
        (!saved || s.flagged) &&
        (!q || (s.text + ' ' + voice(w.speakers, s.speakerId, lang).name).toLocaleLowerCase().includes(q))
    )
  );
  let ourSide = $derived(w.speakers.filter((p) => !p.alias && p.role === 'counsel'));
  let knownCount = 0;
  $effect(() => {
    const count = lines.length;
    if (!live) {
      knownCount = count;
      return;
    }
    const initial = knownCount === 0,
      diff = count - knownCount;
    knownCount = count;
    if (diff <= 0) return;
    untrack(() => {
      if (!anchored && !saved && !q && follow) {
        void tick().then(() => {
          if (pane) pane.scrollTop = pane.scrollHeight;
        });
      } else if (!initial) pending += diff;
    });
  });
  export function reveal(id: string) {
    searching = false;
    query = '';
    saved = false;
    follow = false;
    void tick().then(() => {
      const node = document.getElementById('line-' + id);
      if (node && pane) {
        const top = node.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
        pane.scrollTop = Math.max(0, top - pane.clientHeight * 0.25);
      }
    });
  }
  export async function openSearch() {
    searching = true;
    await tick();
    input?.focus();
  }
  function closeSearch() {
    searching = false;
    query = '';
    searchButton?.focus();
  }
  function latest() {
    saved = false;
    query = '';
    pending = 0;
    follow = true;
    void tick().then(() => {
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
  }
  function scrolled() {
    if (!live || !pane) return;
    follow = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 48;
    if (follow) pending = 0;
  }
  async function bookmark(s: Statement) {
    if (bookBusy.includes(s.id)) return;
    bookBusy = [...bookBusy, s.id];
    try {
      await write(apiPath(w, 'statements/' + encodeURIComponent(s.id)), 'PATCH', { flagged: !s.flagged });
      notice = s.flagged
        ? en
          ? 'Bookmark removed.'
          : 'Penanda dihapus.'
        : en
          ? 'Statement bookmarked.'
          : 'Pernyataan ditandai.';
    } catch {
      notice = en ? 'Could not update the bookmark.' : 'Penanda belum diperbarui.';
    } finally {
      bookBusy = bookBusy.filter((id) => id !== s.id);
    }
  }
  function peek(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    showFinding(id);
  }
</script>

<section
  class="transcript-panel"
  aria-labelledby="transcript-title"
  data-tour="hearing transcript"
  style:--live-size={textSize + 'px'}
>
  <header class="panel-head">
    <div>
      <h2 id="transcript-title">{en ? 'Transcript' : 'Transkrip'}</h2>
      <span class="count">{lines.length} {en ? 'statements' : 'pernyataan'}</span>
    </div>
    <div>
      <button
        class="icon-button"
        aria-label={ourSide.length
          ? (en ? 'Your counsel: ' : 'Kuasa hukum Anda: ') + ourSide.map((p) => p.label).join(', ')
          : en
            ? 'Who are you in this hearing?'
            : 'Siapa Anda di sidang ini?'}
        title={en ? 'Counsel perspective' : 'Sudut pandang kuasa hukum'}
        onclick={chooseCounsel}><UserRoundPen size={16} /></button
      >
      {#if kept || saved}<button
          class="icon-button"
          aria-pressed={saved}
          aria-label={en ? 'Show bookmarked statements only' : 'Tampilkan pernyataan ditandai saja'}
          title={en ? 'Bookmarks' : 'Ditandai'}
          onclick={() => {
            saved = !saved;
            if (!saved && live) latest();
          }}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /><small>{kept}</small></button
        >{/if}
      <button
        class="icon-button"
        bind:this={searchButton}
        aria-label={en ? 'Search transcript' : 'Cari transkrip'}
        aria-expanded={searching}
        aria-controls="transcript-search"
        onclick={() => (searching ? closeSearch() : void openSearch())}><Search size={16} /></button
      >
    </div>
  </header>
  {#if searching}<div class="searchline" id="transcript-search">
      <Search size={15} /><input
        bind:this={input}
        bind:value={query}
        type="search"
        placeholder={en ? 'A word or speaker…' : 'Kata atau pembicara…'}
        aria-label={en ? 'Search words or speakers' : 'Cari kata atau pembicara'}
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeSearch();
          }
        }}
      /><span>{shown.length}</span><button
        class="icon-button"
        onclick={closeSearch}
        aria-label={en ? 'Close transcript search' : 'Tutup pencarian transkrip'}><X size={15} /></button
      >
    </div>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrolling transcript is a keyboard target for Page Up, Page Down, Home and End.) -->
  <div
    class="lines"
    role="region"
    aria-label={en ? 'Transcript entries' : 'Daftar ucapan'}
    tabindex="0"
    bind:this={pane}
    onscroll={scrolled}
  >
    {#each shown as s (s.id)}
      {@const person = voice(w.speakers, s.speakerId, lang)}{@const related = findings.filter(
        (f) => f.statementId === s.id
      )}{@const response = replies.find((r) => r.statementId === s.id)}
      <article id={'line-' + s.id} data-sid={s.id} data-tone={person.role} class:chosen={s.id === selected}>
        <div class="disc" aria-hidden="true">{person.letters}</div>
        <div class="spoken">
          <div class="meta">
            <button
              class="name"
              title={en ? 'Change speaker label' : 'Ubah label pembicara'}
              onclick={() => person.raw && editVoice(person.raw)}>{person.name}</button
            >
            {#if person.role === 'counsel'}<small class="ours">{en ? 'You' : 'Anda'}</small
              >{:else if person.role === 'unknown' && !person.person?.confirmed}<button
                class="identify"
                onclick={() => person.raw && editVoice(person.raw)}
                >{en ? 'Whose voice?' : 'Suara siapa?'}</button
              >{/if}
            <button
              class="when"
              aria-label={(audio
                ? en
                  ? 'Play from '
                  : 'Putar dari '
                : en
                  ? 'Open statement at '
                  : 'Buka pernyataan pada ') + timecode(s.t)}
              onclick={() => (audio ? jump(s, true) : inspect('statement', s.id))}
              >{#if audio}<Play size={9} />{/if}{timecode(s.t)}</button
            >
          </div>
          <p class="words"><Match text={s.text} term={q || related[0]?.said} /></p>
          {#if related.length || response || s.legal?.length}<div class="sources">
              {#each related as f (f.id)}<a
                  href={casePath(w) + '/findings/' + encodeURIComponent(f.id)}
                  onclick={(e) => peek(e, f.id)}
                  title={f.title[lang]}
                  ><BookOpen size={12} />{statuses[f.status][lang]}<ChevronRight size={12} /></a
                >{/each}
              {#if response}<button onclick={() => showReply(response.id)}
                  ><MessageSquareReply size={12} />{en ? 'Response' : 'Tanggapan'} · {response.suggestions
                    .length}</button
                >{/if}
              {#each s.legal ?? [] as lawId}{@const l = w.legal.find((l) => l.id === lawId)}{#if l}<button
                    onclick={() => inspect('legal', lawId)}>{l.article}<ArrowUpRight size={11} /></button
                  >{/if}{/each}
            </div>{/if}
        </div>
        <button
          class="flag icon-button"
          aria-pressed={!!s.flagged}
          aria-label={(en ? 'Bookmark statement at ' : 'Tandai pernyataan pada ') + timecode(s.t)}
          disabled={bookBusy.includes(s.id)}
          onclick={() => bookmark(s)}
          ><Bookmark size={16} fill={s.flagged ? 'currentColor' : 'none'} /></button
        >
      </article>
    {:else}<div class="empty">
        <h3>
          {q || saved
            ? en
              ? 'No matching statements'
              : 'Tidak ada ucapan yang cocok'
            : en
              ? 'No statements yet'
              : 'Belum ada ucapan'}
        </h3>
        {#if q || saved}<button
            class="button"
            onclick={() => {
              query = '';
              saved = false;
            }}>{en ? 'Clear filters' : 'Hapus filter'}</button
          >{/if}
      </div>{/each}
    {#if partial && !q && !saved}<p class="partial">{partial}<span>…</span></p>{/if}
  </div>
  {#if live && !follow}<div class="latest">
      <button class="button" onclick={latest}
        ><ArrowDown size={14} />{pending
          ? en
            ? pending + ' new statements'
            : pending + ' ucapan baru'
          : en
            ? 'Latest'
            : 'Terbaru'}</button
      >
    </div>{/if}
  <span class="ev-only" role="status">{notice}</span>
</section>

<style>
  .transcript-panel {
    min-width: 0;
    position: relative;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .panel-head,
  .panel-head > div,
  .meta,
  .searchline,
  .sources,
  .sources a,
  .sources button,
  .when,
  .latest {
    display: flex;
    align-items: center;
  }
  .panel-head {
    justify-content: space-between;
    gap: 8px;
    padding: 0.45rem 0.7rem 0.45rem 1.1rem;
    border-bottom: 1px solid var(--line);
  }
  .panel-head > div {
    gap: 0.25rem;
  }
  .panel-head h2 {
    font: 400 1.5rem/1.3 var(--display);
  }
  .count {
    font: 400 0.72rem var(--mono);
    color: var(--muted);
    margin-left: 0.4rem;
  }
  .icon-button {
    border: 0;
    background: transparent;
    min-width: 38px;
    width: auto;
    padding: 0.4rem;
    min-height: 38px;
    gap: 0.15rem;
  }
  .icon-button[aria-pressed='true'] {
    background: var(--wash);
    color: var(--accent);
  }
  .searchline {
    gap: 0.55rem;
    padding: 0.2rem 0.7rem;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
  }
  .searchline input {
    min-width: 0;
    flex: 1;
    border: 0;
    background: transparent;
    min-height: 42px;
    color: var(--ink);
  }
  .searchline span {
    font: 400 0.8rem var(--mono);
  }
  .lines {
    overflow: auto;
    scrollbar-gutter: stable;
    max-height: clamp(24rem, 62dvh, 55rem);
    overscroll-behavior: contain;
    padding: 0 0.9rem;
  }
  .lines article {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    gap: 0.65rem;
    padding: 1rem 0 0.9rem;
    border-bottom: 1px solid var(--line);
    scroll-margin-top: 1rem;
  }
  .lines article:last-child {
    border-bottom: 0;
  }
  .lines .chosen {
    background: color-mix(in srgb, var(--wash) 80%, transparent);
    box-shadow: inset 2px 0 var(--accent);
    padding-left: 0.45rem;
  }
  .disc {
    height: 2rem;
    width: 2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--tone) 15%, var(--surface));
    color: color-mix(in srgb, var(--tone) 48%, var(--ink));
    font: 650 0.7rem var(--sans);
    margin-top: 0.1rem;
  }
  .meta {
    gap: 0.15rem 0.5rem;
    flex-wrap: wrap;
  }
  .name,
  .when,
  .identify {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
  }
  .name {
    font: 700 0.81rem/1.6 var(--sans);
  }
  .name:hover,
  .when:hover {
    text-decoration: underline;
  }
  .when {
    font: 400 0.74rem/1.35 var(--mono);
    color: var(--muted);
    gap: 0.12rem;
    min-height: 25px;
  }
  .ours,
  .identify {
    font-size: 0.68rem;
    background: var(--wash);
    padding: 0.17rem 0.36rem;
    border-radius: 3px;
  }
  .words {
    font: 400 var(--live-size)/1.55 var(--sans);
    margin: 0.15rem 0 0;
    overflow-wrap: anywhere;
  }
  .flag {
    color: var(--muted);
    align-self: start;
  }
  .sources {
    flex-wrap: wrap;
    gap: 0.25rem 0.65rem;
    margin-top: 0.35rem;
  }
  .sources button,
  .sources a {
    gap: 0.3rem;
    min-height: 28px;
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    color: var(--accent);
    font: 650 0.75rem/1.35 var(--sans);
    text-decoration: none;
  }
  .sources button:hover,
  .sources a:hover {
    text-decoration: underline;
  }
  .empty {
    padding: 2rem 0.5rem;
  }
  .empty h3 {
    margin-bottom: 0.75rem;
  }
  .latest {
    justify-content: center;
    position: absolute;
    bottom: 0.45rem;
    width: 100%;
    pointer-events: none;
  }
  .latest button {
    pointer-events: auto;
    min-height: 36px;
  }
  .partial {
    margin: 1rem;
    color: var(--muted);
  }
  .partial span {
    color: var(--accent);
  }
  @media (max-width: 640px) {
    .panel-head {
      padding: 0.3rem 0.35rem 0.3rem 0.65rem;
    }
    .lines {
      max-height: 57dvh;
      padding: 0 0.55rem;
    }
    .lines article {
      grid-template-columns: 1.55rem minmax(0, 1fr) 1.9rem;
      gap: 0.4rem;
      padding: 0.85rem 0;
    }
    .disc {
      width: 1.55rem;
      height: 1.55rem;
      font-size: 0.62rem;
    }
    .count {
      display: none;
    }
    .flag {
      min-width: 28px;
    }
    .words {
      font-size: max(14px, var(--live-size) - 1px);
    }
  }
</style>
