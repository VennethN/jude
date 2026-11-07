<script lang="ts">
  import { Pause, Play, RotateCcw, RotateCw } from '@lucide/svelte';
  import type { Finding, Hearing, Lang, Speaker, Statement } from '@jude/core/domain';
  import Timeline from './Timeline.svelte';
  import Match from '$lib/evidence/Match.svelte';
  import './recorded-review.css';
  import { timecode } from '../format';
  import { roles, voice } from './people';

  let { hearing, lines, speakers, findings, lang, current, duration, playing, rate, error, ready,
    seek, toggle, setRate, openFinding }: {
    hearing: Hearing; lines: Statement[]; speakers: Speaker[]; findings: Finding[]; lang: Lang;
    current: number; duration: number; playing: boolean; rate: number; error: boolean; ready: boolean;
    seek: (time: number) => void; toggle: () => void; setRate: (rate: number) => void;
    openFinding: (id: string) => void;
  } = $props();
  const en = $derived(lang === 'en');
  const currentLine = $derived(lines.findLast((line) => line.t <= current));
  const finding = $derived(findings.find(item => item.statementId === currentLine?.id));
  const label = $derived(hearing.audio ? (en ? 'Hearing audio' : 'Rekaman sidang') :
    (en ? 'Transcript replay · no original audio' : 'Transkrip contoh · tanpa rekaman audio'));
</script>

<section class="player" aria-label={label} data-tour="hearing player">
  <div class="controls">
    <button class="transport" aria-label={en ? 'Back 10 seconds' : 'Mundur 10 detik'} disabled={!ready} onclick={() => seek(Math.max(0, current - 10))}><RotateCcw size={17}/></button>
    <button class="transport play" aria-label={playing ? (en ? 'Pause' : 'Jeda') : (en ? 'Play' : 'Putar')} disabled={!ready || error} onclick={toggle}>{#if playing}<Pause size={18}/>{:else}<Play size={18}/>{/if}</button>
    <button class="transport" aria-label={en ? 'Forward 10 seconds' : 'Maju 10 detik'} disabled={!ready} onclick={() => seek(Math.min(duration, current + 10))}><RotateCw size={17}/></button>
    <span class="clock">{timecode(current)} / {timecode(duration)}</span>
    <select disabled={!ready} aria-label={en ? 'Playback speed' : 'Kecepatan putar'} value={String(rate)} onchange={(event) => setRate(Number(event.currentTarget.value))}>
      <option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option>
    </select>
    <span class="kind">{label}</span>
  </div>
  <Timeline {duration} {lines} {findings} {speakers} {lang} {current} {seek} {openFinding} />
  {#if playing || current > 0}
    {#if currentLine}
      {@const person = voice(speakers, currentLine.speakerId, lang)}
      {@const role = roles[person.role][en ? 1 : 0]}
      <div class="current" data-tone={person.role} data-status={finding?.status} aria-label={en ? 'At the playhead' : 'Pada posisi putar'}>
        <span class="portrait" aria-hidden="true">{person.role === 'witness' || person.role === 'party' ? person.letters.slice(0, 1) : person.letters}</span>
        <div class="current-text">
          <div class="plate"><b>{person.name}</b>
            {#if person.role !== 'unknown' && role.toLocaleLowerCase() !== person.name.toLocaleLowerCase()}<span>{role}</span>{/if}
            <time>{timecode(currentLine.t)}</time>
          </div>
          <p><Match text={currentLine.text} term={finding?.said}/></p>
        </div>
      </div>
    {:else if lines[0]}
      <p class="before-first">{en ? 'First statement at ' : 'Pernyataan pertama pada '}{timecode(lines[0].t)}.</p>
    {/if}
  {/if}
  {#if error}<p class="failed" role="alert">{en ? 'The audio could not be played. The transcript is available below.' : 'Audio belum dapat diputar. Transkrip tersedia di bawah.'}</p>{/if}
</section>

<style>
  .player {
    display:grid; gap:10px; min-width:0; margin:0 0 16px; padding:10px 14px 12px;
    border:1px solid var(--hairline); border-radius:12px; background:var(--material-raised);
    box-shadow:var(--shadow-raise),inset 0 1px 0 var(--edge-light);
  }
  .controls,.plate { display:flex; flex-wrap:wrap; align-items:center; }
  .controls { gap:6px 8px; }
  .transport {
    width:36px; height:36px; display:grid; place-items:center;
    border:1px solid transparent; border-radius:6px; color:var(--ink-strong); background:transparent;
  }
  .transport:hover { background:var(--sunken); }
  .transport.play { border-radius:50%; color:var(--primary-ink); background:var(--primary); box-shadow:var(--shadow-raise); }
  .clock { margin-right:4px; color:var(--ink); font:400 13px/1.5 var(--sans); font-variant-numeric:tabular-nums; white-space:nowrap; }
  select { min-height:30px; width:auto; padding:2px 9px 2px 10px; border:1px solid var(--line-strong); border-radius:6px; color:var(--ink); background:var(--surface); font:500 12px var(--sans); }
  .kind { margin-left:auto; padding:2px 8px; border-radius:4px; background:var(--sunken); color:var(--muted); font:600 12px/1.5 var(--sans); }
  .current { display:flex; align-items:flex-start; gap:12px; min-width:0; padding:12px 14px; border:1px solid color-mix(in srgb,var(--tone) 24%,var(--line)); border-radius:12px; background:var(--surface); }
  .portrait { display:grid; flex:none; place-items:center; width:40px; height:40px; border-radius:50%; color:var(--on-accent); background:var(--review-role-ink); font:600 16px/1 var(--sans); }
  .current-text { display:grid; gap:6px; min-width:0; }
  .plate { gap:4px 10px; align-items:baseline; color:var(--muted); font:400 12px/1.55 var(--sans); }
  .plate b { font:600 14px/1.55 var(--sans); color:var(--review-role-ink); }
  .plate time { font-variant-numeric:tabular-nums; }
  .current p { margin:0; color:var(--ink-strong); font:500 15px/1.42 var(--sans); letter-spacing:-.012em; overflow-wrap:anywhere; }
  .before-first,.failed { margin:0; padding:12px 16px; color:var(--muted); font:400 13px/1.5 var(--sans); }
  .before-first { display:flex; min-height:64px; align-items:center; border:1px solid var(--line); border-radius:12px; background:var(--surface); }
  .failed { color:var(--alert); }
  :global([data-theme='night']) .portrait { color:var(--review-role-ink); background:var(--review-role-paper); box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tone) 38%,transparent); }
  @media(max-width:719px) {
    .controls { display:grid; grid-template-columns:44px 44px 44px minmax(0,1fr); gap:6px 8px; }
    .transport { width:44px; height:44px; }
    .controls select { grid-column:1/span 2; justify-self:start; min-width:58px; min-height:38px; }
    .kind { grid-column:3/span 2; text-align:right; font-size:11px; }
  }
</style>
