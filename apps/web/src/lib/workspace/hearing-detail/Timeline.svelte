<script lang="ts">
  import { onMount } from 'svelte';
  import type { Finding, Lang, Speaker, Statement } from '@jude/core/domain';
  import { needsReview } from '@jude/core/domain';
  import { timecode } from '../format';
  import { speakerTurns, speakerShares } from './people';
  let {
    lines,
    speakers,
    findings,
    lang,
    current,
    duration,
    seek,
    openFinding
  }: {
    lines: Statement[];
    speakers: Speaker[];
    findings: Finding[];
    lang: Lang;
    current: number;
    duration: number;
    seek: (time: number) => void;
    openFinding: (id: string) => void;
  } = $props();
  let en = $derived(lang === 'en'),
    length = $derived(Math.max(duration, 1)),
    position = $derived(Math.min(current, length));
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  const turns = $derived(speakerTurns(lines, speakers, lang, length));
  const courtOrder = ['judge', 'judge_member', 'opposing', 'witness', 'counsel', 'party', 'unknown'];
  const people = $derived(speakerShares(turns).sort((a, b) => courtOrder.indexOf(a.role) - courtOrder.indexOf(b.role)));
  const active = $derived(turns.find(turn => position >= turn.line.t && position < turn.line.t + turn.span));
  let markerWidth = $state(0);
  let marked = $derived.by(() => {
    const ends: number[] = [];
    const times = new Map(lines.map(line => [line.id, line.t]));
    const result = findings.filter(f => needsReview(f) && times.has(f.statementId)).map(f => ({ f, time: times.get(f.statementId)! }));
    return result.sort((a, b) => a.time - b.time).map(item => {
      const x = Math.max(13, Math.min(markerWidth - 13, item.time / length * markerWidth));
      const row = ends.findIndex(end => Math.max(x, end + 19) <= Math.min(markerWidth - 10, x + 18));
      const lane = row < 0 ? ends.length : row;
      const point = ends[lane] === undefined ? x : Math.max(x, ends[lane] + 19);
      ends[lane] = point;
      return { ...item, x: point, row:lane };
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

<section class="timeline" aria-label={en ? 'Who spoke when' : 'Linimasa pembicara'} data-tour="review-timeline">
  {#if marked.length}<div class="mark-row">
      <span class="pin-gutter" aria-hidden="true"></span>
      <div bind:clientWidth={markerWidth} style:height={markRows * 23 + 'px'}>
        {#each marked as item (item.f.id)}<button
            disabled={!ready}
            title={item.f.title[lang]}
            aria-label={item.f.title[lang] + ' · ' + timecode(item.time)}
            style:left={markerWidth ? item.x + 'px' : (100 * item.time) / length + '%'}
            style:top={(markerWidth ? item.row : 0) * 23 + 'px'}
            onclick={() => openFinding(item.f.id)}><b class:conflict={item.f.status === 'potential_inconsistency'} aria-hidden="true"><i>!</i></b></button
          >{/each}
      </div>
    </div>{/if}
  <div class="lanes" style:--cursor={(100 * position) / length + '%'}>
    {#each people as p (p.id)}
      {@const caption = p.name.match(/^(?:Saksi|Terdakwa|Ahli)\s+(\S+)/i)?.[1] ?? p.name}
      <div class="lane" data-tone={p.role} class:active={active?.person.person?.id === p.id}>
        <span class="name" title={p.name}><i aria-hidden="true">{p.role === 'witness' || p.role === 'party' ? p.letters.slice(0, 1) : p.letters}</i><b>{caption}</b><small>{p.share}%</small></span>
        <div class="track" aria-hidden="true">
          {#each turns.filter((t) => (t.person.person?.id ?? t.line.speakerId) === p.id) as t (t.line.id)}<b
              class:on={active?.line.id === t.line.id}
              style:left={(100 * t.line.t) / length + '%'}
              style:width={(100 * t.span) / length + '%'}
            ></b>{/each}
        </div>
      </div>{/each}
    <div class="compact-track" aria-hidden="true">
      {#each turns as t (t.line.id)}<b
          data-tone={t.person.role} class:on={active?.line.id === t.line.id}
          style:left={(100 * t.line.t) / length + '%'}
          style:width={(100 * t.span) / length + '%'}
        ></b>{/each}
    </div>
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
</section>

<style>
  .timeline { --gutter:146px; display:grid; gap:2px; min-width:0; container-type:inline-size; }
  .mark-row,.lane { display:grid; grid-template-columns:var(--gutter) minmax(0,1fr); align-items:center; }
  .mark-row > div { position:relative; }
  .mark-row button { position:absolute; width:21px; height:23px; display:grid; place-items:center; padding:0; transform:translateX(-50%); background:transparent; border:0; }
  .mark-row b { display:grid; place-items:center; width:17px; height:17px; border-radius:50% 50% 50% 1px; transform:rotate(-45deg); background:var(--st-context-dot); }
  .mark-row b.conflict { background:var(--alert); }
  .mark-row b i { transform:rotate(45deg); color:var(--primary-ink); font:800 10px/1 var(--sans); }
  .mark-row button:is(:hover,:focus-visible) b { box-shadow:0 0 0 2px var(--ink-strong); }
  .lanes { position:relative; display:grid; gap:3px; }
  .lane { min-height:22px; }
  .name { display:flex; align-items:center; gap:6px; min-width:0; padding-right:8px; }
  .name i { display:grid; place-items:center; width:22px; height:22px; flex:none; border-radius:50%; color:var(--on-accent); background:var(--review-role-ink); font:600 8px/1 var(--sans); }
  .name b { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 11.5px/1.5 var(--sans); color:var(--ink); }
  .name small { color:var(--muted); font:400 10.5px/1.5 var(--sans); font-variant-numeric:tabular-nums; }
  .active .name b { color:var(--review-role-ink); }
  .track,.compact-track { position:relative; height:14px; background:var(--sunken); border-radius:4px; }
  .track b,.compact-track b { position:absolute; inset-block:2px; min-width:2px; border-radius:2px; background:color-mix(in srgb,var(--tone) 55%,transparent); }
  .track b.on,.compact-track b.on { inset-block:0; background:var(--tone); }
  .track::after,.compact-track::after { content:''; position:absolute; top:-2px; bottom:-2px; left:clamp(0px,var(--cursor),calc(100% - 2px)); width:2px; background:var(--ink-strong); pointer-events:none; }
  .lanes input { position:absolute; inset:0 0 0 var(--gutter); width:calc(100% - var(--gutter)); height:100%; margin:0; opacity:0; cursor:pointer; }
  .lanes:focus-within { outline:2px solid var(--focus); outline-offset:3px; border-radius:4px; }
  .compact-track { display:none; }
  :global([data-theme='night']) .name i { color:var(--review-role-ink); background:var(--review-role-paper); box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tone) 38%,transparent); }
  @container(min-width:900px) { .mark-row,.lanes { --gutter:184px; } }
  @container(max-width:550px) {
    .mark-row,.lanes { --gutter:0px; }
    .lane { display:none; }
    .compact-track { display:block; height:22px; }
  }
</style>
