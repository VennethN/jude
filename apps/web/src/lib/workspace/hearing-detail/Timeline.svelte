<script lang="ts">
  import { onMount } from 'svelte';
  import { AudioLines, FileClock } from '@lucide/svelte';
  import type { Finding, Hearing, Lang, Speaker, Statement } from '@jude/core/domain';
  import { needsReview } from '@jude/core/domain';
  import { timecode } from '../format';
  import { voice } from './people';
  let {
    hearing,
    lines,
    speakers,
    findings,
    lang,
    current,
    seek,
    openFinding
  }: {
    hearing: Hearing;
    lines: Statement[];
    speakers: Speaker[];
    findings: Finding[];
    lang: Lang;
    current: number;
    seek: (time: number) => void;
    openFinding: (id: string) => void;
  } = $props();
  let en = $derived(lang === 'en'),
    length = $derived(Math.max(hearing.duration ?? 0, lines.at(-1)?.t ?? 0, 1)),
    position = $derived(Math.min(current, length));
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  let turns = $derived(
    lines.map((line, i) => {
      const person = voice(speakers, line.speakerId, lang);
      const end = Math.min(lines[i + 1]?.t ?? length, length, line.t + Math.max(5, line.text.length / 11));
      return { line, person, span: Math.max(0, end - line.t) };
    })
  );
  let people = $derived(
    turns
      .map((turn) => turn.person)
      .filter((p, i, all) => all.findIndex((o) => o.person?.id === p.person?.id) === i)
  );
  let markerWidth = $state(0);
  let marked = $derived.by(() => {
    const ends: number[] = [];
    const times = new Map(lines.map(line => [line.id, line.t]));
    const result = findings.filter(f => needsReview(f) && times.has(f.statementId)).map(f => ({ f, time: times.get(f.statementId)! }));
    return result.sort((a, b) => a.time - b.time).map(item => {
      const x = Math.max(13, Math.min(markerWidth - 13, item.time / length * markerWidth));
      const nextFree = ends.findIndex(end => end + 26 <= x);
      const row = nextFree < 0 ? ends.length : nextFree;
      ends[row] = x;
      return { ...item, x, row };
    });
  });
  let markRows = $derived(markerWidth ? Math.max(1, ...marked.map(mark => mark.row + 1)) : 1);
  function arrow(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seek(Math.max(0, Math.min(length, position + (event.key === 'ArrowRight' ? 10 : -10))));
    }
  }
</script>

<section class="timeline" aria-labelledby="clock-index" data-tour="review-timeline">
  <header>
    <h2 id="clock-index">
      {#if hearing.audio}<AudioLines size={17} />{:else}<FileClock size={17} />{/if}{en
        ? 'Who spoke when'
        : 'Linimasa pembicara'}
    </h2>
    <span>{timecode(position)} <i>/</i> {timecode(length)}</span>
  </header>
  {#if marked.length}<div class="mark-row">
      <small>{en ? 'Findings' : 'Temuan'}</small>
      <div bind:clientWidth={markerWidth} style:height={markRows * 26 + 'px'}>
        {#each marked as item (item.f.id)}<button
            title={item.f.title[lang]}
            aria-label={item.f.title[lang] + ' · ' + timecode(item.time)}
            style:left={markerWidth ? item.x + 'px' : (100 * item.time) / length + '%'}
            style:top={(markerWidth ? item.row : 0) * 26 + 'px'}
            onclick={() => openFinding(item.f.id)}><b></b></button
          >{/each}
      </div>
    </div>{/if}
  <div class="lanes">
    {#each people as p (p.person?.id ?? p.name)}<div class="lane">
        <span class="name" data-tone={p.role}><i></i>{p.name}</span>
        <div class="track" aria-hidden="true">
          {#each turns.filter((t) => t.person.person?.id === p.person?.id) as t (t.line.id)}<b
              data-tone={p.role}
              style:left={(100 * t.line.t) / length + '%'}
              style:width={(100 * t.span) / length + '%'}
            ></b>{/each}
        </div>
      </div>{/each}
    <div class="compact-track" aria-hidden="true">
      {#each turns as t (t.line.id)}<b
          data-tone={t.person.role}
          style:left={(100 * t.line.t) / length + '%'}
          style:width={(100 * t.span) / length + '%'}
        ></b>{/each}
    </div>
    <div class="playhead" aria-hidden="true"><i style:left={(100 * position) / length + '%'}></i></div>
    <input
      type="range"
      min="0"
      max={length}
      step="1"
      value={position}
      disabled={!ready}
      aria-label={en ? 'Seek transcript timeline' : 'Geser linimasa transkrip'}
      aria-valuetext={timecode(position)}
      onkeydown={arrow}
      oninput={(e) => seek(Number(e.currentTarget.value))}
    />
  </div>
  <div class="ruler" aria-hidden="true">
    <span>00:00</span><span>{timecode(Math.floor(length / 2))}</span><span>{timecode(length)}</span>
  </div>
  <div class="legend">
    {#each people as p (p.person?.id ?? p.name)}<span data-tone={p.role}><i></i>{p.name}</span>{/each}
  </div>
</section>

<style>
  .timeline {
    --gutter: clamp(6.6rem, 11vw, 9rem);
    padding: 0.9rem 1.1rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    container-type: inline-size;
  }
  header,
  .legend,
  .legend span,
  h2,
  .ruler,
  .name,
  .mark-row {
    display: flex;
    align-items: center;
  }
  .timeline header {
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
  }
  .timeline h2 {
    font: 650 0.88rem/1.3 var(--sans);
    gap: 0.45rem;
  }
  .timeline header > span,
  .ruler,
  .mark-row small {
    font: 400 0.7rem/1.18 var(--mono);
    color: var(--muted);
  }
  header i {
    font-style: normal;
    margin: 0 0.1rem;
  }

  .mark-row small {
    width: var(--gutter);
    color: var(--accent);
  }
  .mark-row > div {
    flex: 1;
    height: 100%;
    position: relative;
  }
  .mark-row button {
    position: absolute;
    top: 0;
    height: 26px;
    width: 26px;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .mark-row b {
    background: var(--accent);
    width: 7px;
    height: 7px;
    transform: rotate(45deg);
  }
  .lanes {
    position: relative;
    display: grid;
    gap: 3px;
  }
  .lane {
    display: grid;
    grid-template-columns: var(--gutter) 1fr;
    align-items: center;
  }
  .name,
  .legend span {
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.7rem;
    line-height: 1.3;
  }
  .name {
    padding-right: 0.35rem;
  }
  .name i,
  .legend i {
    display: block;
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--tone);
  }
  .track,
  .compact-track {
    height: 7px;
    background: color-mix(in srgb, var(--line) 60%, var(--surface));
    position: relative;
    overflow: hidden;
    border-radius: 2px;
  }
  .track b,
  .compact-track b {
    position: absolute;
    inset-block: 0;
    background: var(--tone);
    min-width: 2px;
    border-radius: 1px;
  }
  .lanes input,
  .playhead {
    position: absolute;
    inset: 0 0 0 var(--gutter);
    width: calc(100% - var(--gutter));
    height: 100%;
    margin: 0;
  }
  .lanes input {
    opacity: 0;
    cursor: pointer;
  }
  .playhead i {
    position: absolute;
    inset-block: 0;
    width: 2px;
    background: var(--ink);
    pointer-events: none;
    box-shadow: 0 0 0 1px var(--surface);
  }
  .lanes:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: 2px;
  }
  .ruler {
    justify-content: space-between;
    margin: 0.4rem 0 0 var(--gutter);
    font-size: 0.65rem;
  }
  .legend,
  .compact-track {
    display: none;
  }
  @container (max-width:500px) {
    .lanes,
    .mark-row,
    .ruler {
      --gutter: 0px;
    }
    .lane,
    .mark-row small {
      display: none;
    }
    .compact-track {
      display: block;
      height: 12px;
      margin-block: 9px;
    }
    .legend {
      display: flex;
      gap: 4px 0.65rem;
      flex-wrap: wrap;
      margin-top: 0.55rem;
    }
    .legend span {
      font-size: 0.68rem;
    }
    .ruler {
      margin-top: 0.12rem;
    }
  }
</style>
