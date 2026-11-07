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
  const lead = $derived.by(() => {
    if (!lines.length) return undefined;
    if (h.mode === 'live') return voice(w.speakers, lines.at(-1)!.speakerId, lang);
    const talk = new Map<string, number>();
    for (const line of lines) talk.set(line.speakerId, (talk.get(line.speakerId) ?? 0) + line.text.length);
    const ranked = [...talk.keys()].sort((a,b) => talk.get(b)! - talk.get(a)!).map(id => voice(w.speakers,id,lang));
    return ranked.find(person => !['judge','judge_member'].includes(person.role)) ?? ranked[0];
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

<article class="hearing-row" class:library-row={!compact} class:compact class:live={h.mode === 'live'}>
  <div class="mode-mark" data-role={!compact ? lead?.role : undefined} aria-hidden="true">
    {#if !compact && lead}{lead.letters}
    {:else if h.mode === 'live'}<Radio size={19} />
    {:else if h.mode === 'scheduled'}<CalendarClock size={18} />
    {:else if cast[0]}{cast[0].letters}
    {:else}<Speech size={18} />{/if}
  </div>
  <div class="details">
    {#if compact}<div class="row-label">
      <span>{en ? 'Hearing' : 'Sidang'} {String(h.number).padStart(2, '0')}</span><i></i><span
        class:live-ink={h.mode === 'live'}>{mode}</span
      >
    </div>{/if}
    <h3><a {href}>{#if !compact}<span class="hearing-number">{en ? 'Hearing' : 'Sidang'} {h.number}</span> {/if}<Match text={h.title[lang]} {term} /></a></h3>
    <div class="row-meta">
      <time datetime={h.date}>{formatDate(h.date, lang, true)}{h.time ? ' · ' + h.time + ' WIB' : ''}</time>
      {#if !compact}<span class:live-ink={h.mode === 'live'}>{mode}</span>{/if}
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
        {#each cast.slice(0, 5) as p}<span data-role={p.role} title={p.name} aria-hidden="true">{p.letters}</span>{/each}
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
  .library-row { position:relative; grid-template-columns:36px minmax(0,1fr) auto; gap:14px; margin:0 -12px; padding:14px 12px; border:0; border-radius:7px; }
  .library-row::after { content:''; position:absolute; left:62px; right:12px; bottom:0; height:1px; background:var(--line); pointer-events:none; }
  .library-row:last-child::after { left:12px; }
  .library-row:hover { background:color-mix(in srgb,var(--ink) 4%,transparent); }
  .library-row:has(h3 a:focus-visible) { outline:2px solid var(--focus); outline-offset:-2px; }
  .library-row h3 { margin:0 0 3px; font:400 19px/1.25 var(--display); }
  .library-row h3 a::before { content:''; position:absolute; inset:0; border-radius:7px; }
  .library-row .hearing-number { display:inline-block; margin-right:6px; vertical-align:middle; color:var(--muted); font:600 12px/1.5 var(--sans); white-space:nowrap; }
  .library-row .mode-mark { width:36px; height:36px; font:600 11px var(--sans); }
  .library-row .row-meta { font:400 12px/1.55 var(--sans); gap:0 5px; }
  .library-row .row-end,.library-row .match-line { position:relative; z-index:1; }
  .library-row .attention { border-radius:999px; padding:3px 10px 3px 5px; min-height:26px; color:var(--ink-strong,var(--ink)); }
  .library-row .cast { padding-left:6px; }
  .library-row .cast span { width:28px; height:28px; margin-left:-6px; font-size:9px; }
  .library-row [data-role] { color:white; background:var(--role-unknown); }
  .library-row [data-role=judge],.library-row [data-role=judge_member] { background:var(--role-judge); }
  .library-row [data-role=counsel] { background:var(--role-counsel); }
  .library-row [data-role=opposing] { background:var(--role-opposing); }
  .library-row [data-role=witness] { background:var(--role-witness); }
  .library-row [data-role=party] { background:var(--role-party); }
  @container(max-width:520px) { .library-row { grid-template-columns:36px minmax(0,1fr); } .library-row .row-end { grid-column:2; justify-content:flex-start; } }
</style>
