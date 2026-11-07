<script lang="ts">
  import { ArrowUpRight, Bookmark, CalendarClock, CircleAlert, Mic, Radio, Speech } from '@lucide/svelte';
  import { needsReview, type Hearing, type Lang, type Statement, type Workspace } from '@jude/core/domain';
  import Match from '$lib/evidence/Match.svelte';
  import { formatDate, timecode } from './format';
  import { voice } from './hearing-detail/people';
  let {
    w,
    h,
    lang,
    compact = false,
    match,
    term = '',
    onstart,
  }: {
    w: Workspace;
    h: Hearing;
    lang: Lang;
    compact?: boolean;
    match?: Statement;
    term?: string;
    onstart?: () => void;
  } = $props();
  const en = $derived(lang === 'en');
  const base = $derived('/case/' + w.caseRecord.id);
  const href = $derived(base + '/hearings/' + h.id);
  const lines = $derived(w.statements.filter((s) => s.hearingId === h.id));
  const bookmarks = $derived(lines.filter((s) => s.flagged).length);
  const review = $derived(w.findings.filter((f) => f.hearingId === h.id && needsReview(f)).length);
  const cast = $derived.by(() => {
    const names = new Map<string, ReturnType<typeof voice>>();
    for (const line of lines) {
      const person = voice(w.speakers, line.speakerId, lang);
      names.set(person.person?.id ?? line.speakerId, person);
    }
    return [...names.values()];
  });
  const mode = $derived(
    {
      live: en ? 'Live' : 'Langsung',
      scheduled: en ? 'Scheduled' : 'Terjadwal',
      imported: en ? 'Imported transcript' : 'Transkrip impor',
      recorded: en ? 'Recorded' : 'Rekaman',
    }[h.mode],
  );
  const duration = $derived(Math.round((h.duration || 0) / 60));
</script>

<article class="hearing-row" class:compact class:live={h.mode === 'live'}>
  <div class="mode-mark" aria-hidden="true">
    {#if h.mode === 'live'}<Radio size={19} />
    {:else if h.mode === 'scheduled'}<CalendarClock size={18} />
    {:else if cast[0]}{cast[0].letters}
    {:else}<Speech size={18} />{/if}
  </div>
  <div class="details">
    <div class="row-label">
      <span>{en ? 'Hearing' : 'Sidang'} {String(h.number).padStart(2, '0')}</span><i></i><span
        class:live-ink={h.mode === 'live'}>{mode}</span
      >
    </div>
    <h3><a {href}><Match text={h.title[lang]} {term} /></a></h3>
    <div class="row-meta">
      <time datetime={h.date}>{formatDate(h.date, lang, true)}{h.time ? ' · ' + h.time + ' WIB' : ''}</time>
      {#if duration}<span
          >{duration >= 60 ? Math.floor(duration / 60) + (en ? ' h ' : ' j ') : ''}{duration % 60}
          {en ? 'min' : 'mnt'}</span
        >{/if}
      {#if lines.length}<span
          >{lines.length} {en ? (lines.length === 1 ? 'statement' : 'statements') : 'pernyataan'}</span
        >{/if}
      {#if bookmarks}<span><Bookmark size={12} />{bookmarks} {en ? 'bookmarked' : 'ditandai'}</span>{/if}
    </div>
    {#if match}<a class="match-line" href={href + '?s=' + encodeURIComponent(match.id)}
        ><span>{timecode(match.t)}</span> “<Match text={match.text} {term} />” <ArrowUpRight size={12} /></a
      >{/if}
  </div>
  <div class="row-end">
    {#if !compact && cast.length}<div class="cast" aria-label={cast.map((p) => p.name).join(', ')}>
        {#each cast.slice(0, 4) as p}<span title={p.name} aria-hidden="true">{p.letters}</span>{/each}
      </div>{/if}
    {#if !compact && h.mode === 'scheduled' && onstart}<button class="action" onclick={onstart}
        ><Mic size={13} />{en ? 'Start recording' : 'Mulai rekam'}</button
      >
    {:else if !compact && h.mode === 'live'}<a class="action" {href}
        >{en ? 'Back to hearing' : 'Kembali ke sidang'}<ArrowUpRight size={14} /></a
      >
    {:else if review}<a class="attention" href={base + '/findings?hearing=' + h.id}
        ><CircleAlert size={13} />{review} {en ? 'to review' : 'perlu dicek'}</a
      >{/if}
  </div>
</article>

<style>
  .hearing-row {
    container-type: normal;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 17px 0;
    border-bottom: 1px solid var(--line);
  }
  .mode-mark,
  .cast span {
    display: grid;
    place-items: center;
    background: var(--wash);
    color: var(--ink);
    border-radius: 50%;
    font-weight: 600;
  }
  .mode-mark {
    width: 34px;
    height: 34px;
    font-size: 0.83rem;
  }
  .live .mode-mark {
    background: color-mix(in srgb, var(--accent) 12%, var(--paper));
    color: var(--accent);
  }
  .details {
    min-width: 0;
  }
  .row-label,
  .row-meta,
  .cast,
  .row-end,
  .action,
  .attention,
  .row-meta span {
    display: flex;
    align-items: center;
  }
  .row-label,
  .row-meta {
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.5;
    flex-wrap: wrap;
    gap: 3px 8px;
  }
  .row-label {
    font-weight: 600;
  }
  .row-label i {
    background: currentColor;
    width: 2px;
    height: 2px;
    border-radius: 50%;
  }
  .live-ink {
    color: var(--accent);
  }
  h3 {
    font: 400 clamp(1.4rem, 2.3vw, 1.85rem)/1.18 var(--display);
    margin: 4px 0 5px;
    overflow-wrap: anywhere;
  }
  h3 a {
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  .row-meta span {
    gap: 5px;
  }
  .row-meta span:before {
    content: '·';
    margin-right: 2px;
  }
  .row-end {
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }
  .row-end:empty {
    display: none;
  }
  .cast {
    padding-left: 4px;
  }
  .cast span {
    width: 26px;
    height: 26px;
    margin-left: -4px;
    border: 2px solid var(--paper);
    font-size: 0.72rem;
  }
  .cast span:nth-child(even) {
    background: color-mix(in srgb, var(--accent) 15%, var(--paper));
  }
  .action,
  .attention {
    justify-content: center;
    gap: 5px;
    min-height: 34px;
    font: 600 0.8rem var(--sans);
    color: var(--ink);
    text-decoration: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 9px;
    background: var(--surface);
  }
  .attention {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 32%, var(--line));
    background: color-mix(in srgb, var(--accent) 6%, var(--paper));
  }
  .match-line {
    display: block;
    width: fit-content;
    line-height: 1.5;
    margin-top: 8px;
    color: var(--ink);
    text-decoration: none;
  }
  .match-line span {
    font: 400 0.8rem var(--mono);
    color: var(--muted);
  }
  .compact {
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 9px 12px;
    padding: 13px 0;
  }
  .compact .row-end {
    grid-column: 2;
    justify-content: flex-start;
  }
  .compact .mode-mark {
    width: 30px;
    height: 30px;
  }
  .compact h3 {
    font-size: 1.35rem;
  }
  @container (max-width:650px) {
    .hearing-row {
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 8px 12px;
    }
    .row-end {
      grid-column: 2;
      justify-content: flex-start;
    }
  }
  @media (pointer: coarse) {
    .action,
    .attention {
      min-height: 42px;
    }
  }
</style>
