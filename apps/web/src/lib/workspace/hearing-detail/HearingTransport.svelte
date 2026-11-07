<script lang="ts">
  import { Pause, Play, RotateCcw, RotateCw } from '@lucide/svelte';
  import type { Finding, Hearing, Lang, Speaker, Statement } from '@jude/core/domain';
  import Timeline from './Timeline.svelte';
  import { timecode } from '../format';
  import { voice } from './people';

  let { hearing, lines, speakers, findings, lang, current, duration, playing, rate, error,
    seek, toggle, setRate, openFinding, height = $bindable(0) }: {
    hearing: Hearing; lines: Statement[]; speakers: Speaker[]; findings: Finding[]; lang: Lang;
    current: number; duration: number; playing: boolean; rate: number; error: boolean;
    seek: (time: number) => void; toggle: () => void; setRate: (rate: number) => void;
    openFinding: (id: string) => void; height?: number;
  } = $props();
  const en = $derived(lang === 'en');
  const currentLine = $derived(lines.findLast((line) => line.t <= current));
  const label = $derived(hearing.audio ? (en ? 'Hearing audio' : 'Rekaman sidang') :
    (en ? 'Transcript replay · no original audio' : 'Transkrip contoh · tanpa rekaman audio'));
</script>

<section class="player" bind:clientHeight={height} aria-label={label} data-tour="hearing player">
  <div class="controls">
    <button class="transport" aria-label={en ? 'Back 10 seconds' : 'Mundur 10 detik'} onclick={() => seek(Math.max(0, current - 10))}><RotateCcw size={17}/></button>
    <button class="transport play" aria-label={playing ? (en ? 'Pause' : 'Jeda') : (en ? 'Play' : 'Putar')} disabled={error} onclick={toggle}>{#if playing}<Pause size={18}/>{:else}<Play size={18}/>{/if}</button>
    <button class="transport" aria-label={en ? 'Forward 10 seconds' : 'Maju 10 detik'} onclick={() => seek(Math.min(duration, current + 10))}><RotateCw size={17}/></button>
    <span class="clock">{timecode(current)} / {timecode(duration)}</span>
    <select aria-label={en ? 'Playback speed' : 'Kecepatan putar'} value={String(rate)} onchange={(event) => setRate(Number(event.currentTarget.value))}>
      <option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option>
    </select>
    <span class="kind">{label}</span>
  </div>
  <Timeline {hearing} {duration} {lines} {findings} {speakers} {lang} {current} {seek} {openFinding} />
  {#if playing || current > 0}
    <div class="current" aria-label={en ? 'At the playhead' : 'Pada posisi putar'}>
      {#if currentLine}
        {@const person = voice(speakers, currentLine.speakerId, lang)}
        <span class="speaker" data-tone={person.role}>{person.letters}</span>
        <div><b>{person.name}</b> <time>{timecode(currentLine.t)}</time><p>{currentLine.text}</p></div>
      {:else if lines[0]}<p>{en ? 'First statement at ' : 'Pernyataan pertama pada '}{timecode(lines[0].t)}.</p>{/if}
    </div>
  {/if}
  {#if error}<p class="failed" role="alert">{en ? 'The audio could not be played. The transcript is available below.' : 'Audio belum dapat diputar. Transkrip tersedia di bawah.'}</p>{/if}
</section>

<style>
  .player { position:sticky; top:var(--hearing-sticky,68px); z-index:4; min-width:0; border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:10px 14px 12px; margin:0 0 16px; }
  .controls,.current { display:flex; align-items:center; gap:6px; }
  .controls { flex-wrap:wrap; margin-bottom:8px; }
  .transport { height:36px; width:36px; display:grid; place-items:center; color:var(--ink); border:1px solid transparent; background:transparent; border-radius:6px; }
  .transport:hover { background:var(--wash); }
  .transport.play { background:var(--forest); color:var(--on-forest); border-radius:50%; }
  .clock { margin:0 6px; font:500 13px/1.5 var(--sans); font-variant-numeric:tabular-nums; }
  select { min-height:32px; padding:2px 6px; border:1px solid var(--line); color:var(--ink); background:var(--surface); border-radius:6px; font-size:13px; }
  .kind { margin-left:auto; color:var(--muted); font-size:12px; }
  .current { margin-top:10px; align-items:flex-start; gap:10px; padding:12px; border-radius:8px; background:var(--surface-2,var(--paper)); font:400 14px/1.5 var(--sans); }
  .current b,.current time { font-size:12px; }
  .current time { margin-left:5px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .current p { margin:2px 0 0; }
  .speaker { flex:none; display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:var(--tone); color:white; font:600 10px var(--sans); }
  .failed { color:var(--accent); padding:8px 0 0; font-size:13px; }
  @media(max-width:719px) { .player { position:static; padding:10px; } .transport { height:42px; width:36px; } .kind { flex-basis:100%; font-size:11px; } }
  @media(max-width:719px) {
    .player { padding:10px 14px 12px; }
    .controls { display:grid; grid-template-columns:44px 44px 44px minmax(0,1fr); gap:6px; }
    .transport { width:44px; height:44px; }
    .controls select { grid-column:1/span 2; justify-self:start; min-width:58px; height:38px; }
    .controls .kind { grid-column:3/span 2; text-align:right; }
    .clock { margin:0; font-size:12.5px; white-space:nowrap; }
  }
</style>
