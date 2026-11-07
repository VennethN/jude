<script lang="ts">
  import { tick, untrack } from 'svelte';
  import {
    ArrowDown,
    ArrowRight,
    ArrowUpRight,
    Bookmark,
    MessageSquareReply,
    Play,
    Search,
    UserRoundPen,
    X
  } from '@lucide/svelte';
  import type { Finding, Lang, Reply, Speaker, Statement, Workspace } from '@jude/core/domain';
  import { write } from '$lib/client';
  import { needsReview } from '@jude/core/domain';
  import ReviewMark from '$lib/evidence/ReviewMark.svelte';
  import FindingLink from '$lib/evidence/FindingLink.svelte';
  import { apiPath, casePath } from '$lib/evidence/records';
  import Match from '$lib/evidence/Match.svelte';
  import { timecode } from '../format';
  import type { LiveTranscriptTurn } from '../microphone';
  import { initials } from '../format';
  import { roles, voice } from './people';
  let {
    workspace: w,
    lang,
    lines,
    findings,
    replies,
    live,
    partial,
    speaking,
    partialStatus,
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
    partial?: LiveTranscriptTurn;
    speaking: boolean;
    partialStatus: string;
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
    dismissed = $state(false),
    query = $state(''),
    saved = $state(false),
    follow = $state(true),
    pending = $state(0),
    notice = $state(''),
    bookBusy = $state<string[]>([]);
  let panel = $state<HTMLElement>();
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
  const draft = $derived(live && !q && !saved && partial?.text && !lines.some(line => line.id === partial.id) ? partial : undefined);
  const log = $derived<Statement[]>(draft ? [...shown, {id:draft.id, hearingId:lines[0]?.hearingId ?? '',
    text:draft.text, speakerId:draft.speakerId ?? '', t:draft.t ?? 0}] : shown);
  let announced = $state('');
  $effect(() => {
    if (!draft?.text) return;
    untrack(() => {
      if (follow && !anchored) void tick().then(() => { if (pane) pane.scrollTop = pane.scrollHeight; });
    });
  });
  $effect(() => {
    if (!live || !panel) return;
    const node = panel;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = matchMedia('(max-width:719px)').matches ? 92 : 28;
        const top = node.getBoundingClientRect().top;
        if (top >= 0) node.style.setProperty('--log-height', Math.max(260, innerHeight - top - bottom) + 'px');
      });
    };
    const resizes = new ResizeObserver(fit);
    const watch = () => {
      const detail = node.closest('.hearing-detail');
      detail?.querySelectorAll('.back,.hearing-heading,.turn,[data-tour="live-attention"]').forEach(el => resizes.observe(el));
      fit();
    };
    const changes = new MutationObserver(watch);
    if (node.parentElement) changes.observe(node.parentElement, {childList:true});
    if (node.closest('.hearing-detail')) changes.observe(node.closest('.hearing-detail')!, {childList:true});
    watch();
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(frame); resizes.disconnect(); changes.disconnect(); window.removeEventListener('resize', fit); };
  });
  const remaining = $derived(findings.filter(needsReview).length);
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
      if (!initial && lines.at(-1)) {
        const last = lines.at(-1)!;
        announced = voice(w.speakers, last.speakerId, lang).name + ' · ' + last.text;
      }
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
      if (node && !live) {
        node.scrollIntoView({ block:'center', behavior:'instant' });
      } else if (node && pane) {
        const top = node.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
        pane.scrollTop = Math.max(0, top - pane.clientHeight * 0.25);
      }
    });
  }
  export async function openSearch() {
    searching = true;
    dismissed = false;
    await tick();
    input?.focus();
  }
  function closeSearch() {
    searching = false;
    dismissed = true;
    query = '';
    void tick().then(() => searchButton?.focus({preventScroll:true}));
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
</script>

<section
  class="transcript-panel" class:review={!live} bind:this={panel}
  aria-labelledby="transcript-title"
  data-tour="hearing transcript"
  style:--live-size={textSize + 'px'}
>
  {#if !live}
    <header class="review-tools">
      <h2 id="transcript-title" class="sr-only">{en ? 'Transcript' : 'Transkrip'}</h2>
      <div class="review-search">
        <button class="icon-button" bind:this={searchButton} aria-label={en ? 'Search transcript' : 'Cari transkrip'} onclick={openSearch}><Search size={16}/></button>
        {#if !dismissed}<input type="search" bind:this={input} bind:value={query} aria-label={en ? 'Search words or speakers' : 'Cari kata atau pembicara'}
          placeholder={en ? 'Search words in this hearing…' : 'Cari kata dalam sidang ini…'}
          onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeSearch(); } }} />{/if}
      </div>
      {#if kept || saved}<button class="index-filter" aria-pressed={saved}
        aria-label={en ? 'Show bookmarked statements only' : 'Tampilkan pernyataan ditandai saja'}
        onclick={() => (saved = !saved)}><Bookmark size={14}/>{kept}</button>{/if}
      {#if remaining}
        <a class="review-count" href={casePath(w) + '/findings?hearing=' + encodeURIComponent(lines[0]?.hearingId ?? '')}>
          <ReviewMark status={findings.find(needsReview)!.status} size={18}/><strong>{remaining} {en ? 'to review' : 'perlu dicek'}</strong><span>{en ? 'See all in Findings' : 'Lihat semua di Temuan'}</span><ArrowRight size={13}/>
        </a>
      {/if}
    </header>
  {:else}<header class="panel-head">
    <div>
      <h2 id="transcript-title">{en ? 'Transcript' : 'Transkrip'}</h2>
      <span class="count">{lines.length} {en ? (lines.length === 1 ? 'statement' : 'statements') : 'pernyataan'}</span>
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
        onclick={chooseCounsel}>
        {#if ourSide[0]}<span class="counsel-avatar">{initials(ourSide[0].label)}</span><span class="you-label">{en ? 'You' : 'Anda'}</span>
        {:else}<UserRoundPen size={16} />{/if}</button
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
  {/if}
  {#if live && searching}<div class="searchline" id="transcript-search">
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
    tabindex={live ? 0 : undefined}
    bind:this={pane}
    onscroll={scrolled}
  >
    {#each log as s (s.id)}
      {@const typing = draft?.id === s.id}
      {@const person = voice(w.speakers, s.speakerId, lang)}{@const related = findings.filter(
        (f) => f.statementId === s.id
      )}{@const response = replies.find((r) => r.statementId === s.id)}
      <article id={'line-' + s.id} data-sid={typing ? undefined : s.id} data-partial-id={typing ? s.id : undefined} class:typing class:speaking={typing && speaking} data-tone={person.role} class:chosen={s.id === selected}>
        <div class="disc" aria-hidden="true">{person.letters}</div>
        <div class="spoken">
          <div class="meta">
            {#if typing}<span class="name">{s.speakerId ? person.name : (en ? 'Current speaker' : 'Pembicara saat ini')}</span>
              {#if person.role === 'counsel'}<small class="ours">{en ? 'You' : 'Anda'}</small>{/if}
              <span class="listening-label">{speaking ? (en ? 'speaking…' : 'berbicara…') : partialStatus}</span>
            {:else}<button
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
            {/if}
          </div>
          <p class="words">{#if typing}{#each s.text.match(/\S+\s*/gu) ?? [] as word,index (index)}<span class="word">{word}</span>{/each}<i class="caret" aria-hidden="true"></i>{:else}<Match text={s.text} term={q || related[0]?.said} />{/if}</p>
          {#if related.length || response || s.legal?.length}<div class="sources">
              {#each related as f (f.id)}<FindingLink workspace={w} finding={f} {lang} variant="pill"
                onPreview={(finding) => showFinding(finding.id)} />{/each}
              {#if response}<button onclick={() => showReply(response.id)}
                  ><MessageSquareReply size={12} />{en ? 'Response' : 'Tanggapan'} · {response.suggestions
                    .length}</button
                >{/if}
              {#each s.legal ?? [] as lawId}{@const l = w.legal.find((l) => l.id === lawId)}{#if l}<button
                    onclick={() => inspect('legal', lawId)}>{l.article}<ArrowUpRight size={11} /></button
                  >{/if}{/each}
            </div>{/if}
        </div>
        {#if !typing}<button
          class="flag icon-button"
          aria-pressed={!!s.flagged}
          aria-label={(en ? 'Bookmark statement at ' : 'Tandai pernyataan pada ') + timecode(s.t)}
          disabled={bookBusy.includes(s.id)}
          onclick={() => bookmark(s)}
          ><Bookmark size={16} fill={s.flagged ? 'currentColor' : 'none'} /></button
        >{/if}
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
  {#if live}<span class="ev-only" aria-live="polite" aria-atomic="true">{announced}</span>{/if}
</section>

<style>
  .review-tools { display:flex; align-items:center; gap:10px; padding:12px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .review-search { flex:1 1 240px; display:flex; align-items:center; min-width:0; min-height:36px; background:var(--surface); border:1px solid var(--line); border-radius:6px; }
  .review-search:focus-within { outline:2px solid var(--focus,var(--accent)); outline-offset:2px; }
  .review-search input { min-height:32px; flex:1; min-width:0; border:0; padding:4px 8px 4px 0; background:none; color:var(--ink); font:400 13.5px/1.45 var(--sans); outline:none; }
  .review-search button { min-height:32px; width:34px; min-width:34px; }
  .review-count,.index-filter { display:inline-flex; align-items:center; min-height:32px; gap:4px; padding:4px 8px; background:var(--st-inconsistency-bg,var(--wash)); color:var(--st-inconsistency-ink,var(--ink)); border:0; border-radius:6px; font:600 12px var(--sans); text-decoration:none; }
  .index-filter { background:var(--wash); color:var(--ink); }
  .index-filter[aria-pressed=true] { background:var(--forest); color:var(--on-forest); }
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
  .sources button {
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
  .sources button:hover {
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

  .review .lines { max-height:none; overflow:visible; scrollbar-gutter:auto; }
  .lines article { grid-template-columns:20px 32px minmax(0,1fr); grid-template-rows:auto; align-items:start; gap:9px; padding:10px 0; border-bottom:0; }
  .lines .flag { grid-column:1; grid-row:1; justify-self:center; width:22px; min-width:22px; min-height:28px; height:28px; padding:2px; color:var(--muted); }
  .lines .flag[aria-pressed=true] { color:var(--st-inconsistency-ink,var(--accent)); }
  .lines .disc { grid-column:2; grid-row:1; width:32px; height:32px; background:var(--tone); color:white; font:600 10px var(--sans); }
  .lines article > :nth-child(2) { grid-column:3; grid-row:1; min-width:0; }
  .review .words { font:400 13.3px/1.5 var(--sans); text-wrap:pretty; }
  .review .name { font:600 12.5px/1.5 var(--sans); }
  .review .when { font:400 11.5px/1.5 var(--sans); font-variant-numeric:tabular-nums; min-height:24px; }
  @media(max-width:719px) { .review-search { min-height:44px; } .lines article { grid-template-columns:20px 32px minmax(0,1fr); } }
  .typing .name { cursor:default; }
  .typing .listening-label { color:var(--alert,var(--accent)); font:600 11.5px/1.5 var(--sans); }
  .typing .words { color:var(--muted); }
  .typing.speaking .disc { outline:2px solid color-mix(in srgb,var(--tone) 55%,transparent); outline-offset:2px; }
  .caret { display:inline-block; width:1.5px; height:1em; margin-left:2px; vertical-align:-.1em; background:var(--tone); }
  @media(prefers-reduced-motion:no-preference) {
    .typing .word { animation:word-in 140ms ease-out; }
    .typing.speaking .caret { animation:blink 1s steps(2,start) infinite; }
    .lines .words,.lines .disc { transition:color 170ms ease-out,background-color 170ms ease-out; }
    @keyframes word-in { from { opacity:.35; } to { opacity:1; } }
    @keyframes blink { 50% { opacity:.2; } }
  }
  .transcript-panel:not(.review) { display:flex; flex-direction:column; height:var(--log-height,calc(100dvh - 270px)); border-radius:12px; }
  .transcript-panel:not(.review) .lines { flex:1; min-height:0; max-height:none; }
  .panel-head { flex:none; min-height:52px; padding:6px 12px 6px 16px; }
  .panel-head h2 { font:600 15px/1.55 var(--sans); }
  .panel-head .count { margin-left:5px; color:var(--muted); font:400 12px/1.5 var(--sans); }
  .panel-head .icon-button { width:auto; min-width:32px; padding-inline:4px; background:none; gap:5px; }
  .counsel-avatar { display:inline-grid; place-items:center; width:23px; height:23px; border-radius:50%; color:white; background:var(--role-counsel); font:600 9px var(--sans); }
  .you-label { font:600 12px var(--sans); }
  @media(max-width:719px) { .you-label { display:none; } }
  .review-count { gap:6px; background:none; color:var(--ink-strong,var(--ink)); }
  .review-count span { margin-left:5px; color:var(--muted); font-weight:400; }
  .review-count:hover span { text-decoration:underline; }
</style>
