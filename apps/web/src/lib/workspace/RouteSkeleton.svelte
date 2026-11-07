<script lang="ts">
  import type { LoadingView } from './loading-view';

  let { view, title, en }: { view: LoadingView; title: string; en: boolean } = $props();
</script>

{#snippet writing()}
  <div class="writing"><i></i><i></i><i></i></div>
{/snippet}

{#snippet rows(count: number, mark = '')}
  <div class="rules">
    {#each Array(count) as _}
      <div class="entry">
        {#if mark}<b class={'mark ' + mark}></b>{/if}
        <div class="entry-text"><i></i><i></i></div>
        {#if view === 'hearings'}<div class="row-action"></div>{/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet tools()}
  <div class="tools"><div class="search"></div><div class="filter"></div></div>
{/snippet}

{#snippet folio()}
  <div class="folio"><i class="caption"></i>{@render writing()}<div class="rule"></div>{@render writing()}</div>
{/snippet}

<div class="skeleton" aria-hidden="true" data-loading-view={view}>
  <div class="head">
    <div class="title" class:cover={view === 'overview'}>{title}</div>
    <div class="status">{en ? 'Loading…' : 'Memuat…'}</div>
  </div>
  <div class="geometry">
    {#if view === 'cases'}
      {@render tools()}
      <div class="case-files">{#each [1, 2, 3] as _}{@render folio()}{/each}</div>
    {:else if view === 'overview'}
      <div class="facts">{@render writing()}</div>
      <div class="brief">{@render rows(1, 'disc')}</div>
      <div class="folios">{@render folio()}{@render folio()}</div>
    {:else if view === 'documents'}
      {@render tools()}
      <div class="document-files">
        {#each [1, 2, 3, 4] as _}<div class="document-file"><b class="mark file"></b>{@render writing()}</div>{/each}
      </div>
    {:else if view === 'hearings' || view === 'findings'}
      {@render tools()}
      {@render rows(5, view === 'hearings' ? 'disc' : 'review')}
    {:else if view === 'hearing'}
      <div class="transport"><b class="mark disc"></b><i></i></div>
      <div class="transcript spread">
        <div class="paper">{@render rows(5, 'disc')}</div>
        <div class="margin">{@render folio()}</div>
      </div>
    {:else if view === 'document'}
      {@render tools()}
      <div class="reader spread">
        <div class="index">{@render rows(3, 'file')}</div>
        <div class="leaf">{@render writing()}{@render writing()}{@render writing()}</div>
      </div>
    {:else if view === 'finding'}
      {@render tools()}
      <div class="finding spread">
        <div class="queue">{@render rows(4, 'review')}</div>
        <div class="excerpt">{@render folio()}</div>
      </div>
    {:else if view === 'assistant' || view === 'thread'}
      <div class="assistant spread" class:open-thread={view === 'thread'}>
        <div class="history">{@render tools()}{@render rows(4)}</div>
        <div class="conversation">
          <div class="question">{@render writing()}</div>
          {@render writing()}
          <div class="composer"></div>
        </div>
      </div>
    {:else}
      {@render tools()}
      <div class="canvas" class:board={view === 'board'}>
        <div class="map-note">{@render writing()}</div>
        <div class="map-note">{@render writing()}</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .skeleton {
    --silhouette: color-mix(in srgb, var(--muted) 19%, var(--paper));
    --light-silhouette: color-mix(in srgb, var(--muted) 11%, var(--paper));
    container-type: inline-size;
    width: 100%;
    max-height: calc(100dvh - var(--loading-top, 72px) - 12px);
    overflow: clip;
    background: var(--paper);
  }
  .head { display: grid; gap: 8px; margin-bottom: 26px; }
  .title {
    color: var(--ink-strong);
    font: 400 clamp(30px, 4cqi, 40px)/1.08 var(--display);
    letter-spacing: -0.012em;
  }
  .title.cover { font-family: Rufina, Georgia, serif; }
  .status { color: var(--muted); font: 400 14px/1.55 var(--sans); }
  .skeleton i {
    display: block;
    height: 9px;
    border-radius: 2px;
    background: var(--silhouette);
  }
  .geometry { min-width: 0; }
  .tools, .transport, .entry { display: flex; align-items: center; gap: 14px; }
  .tools { margin-bottom: 17px; }
  .search, .filter, .composer {
    height: 36px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
  }
  .search { width: min(560px, 70%); }
  .filter { width: min(115px, 25%); border-radius: 30px; }
  .entry { position: relative; min-height: 73px; padding: 14px 0; }
  .entry::after { content: ''; position: absolute; inset: auto 0 0; height: 1px; background: var(--line); }
  .entry:has(.mark)::after { left: 50px; }
  .entry:last-child::after { left: 0; }
  .entry-text, .writing { display: grid; gap: 9px; min-width: 0; }
  .entry-text { flex: 1; }
  .entry-text i:first-child { width: min(64%, 305px); height: 13px; }
  .entry:nth-child(even) .entry-text i:first-child { width: min(52%, 252px); }
  .entry-text i:last-child { width: min(83%, 389px); background: var(--light-silhouette); }
  .row-action { width: 90px; height: 30px; border: 1px solid var(--line); border-radius: 5px; }
  .mark { display: block; width: 36px; height: 36px; flex: none; background: var(--silhouette); }
  .disc { border-radius: 50%; }
  .file { width: 27px; height: 33px; margin-inline: 4.5px; border-radius: 2px 6px 2px 2px; }
  .review { width: 20px; height: 20px; margin-inline: 8px; border-radius: 50%; }
  .writing i:nth-child(2) { width: 83%; }
  .writing i:last-child { width: 59%; background: var(--light-silhouette); }
  .caption { width: min(150px, 49%); margin-bottom: 23px; }
  .rule { height: 1px; margin: 20px 0; background: var(--line); }
  .case-files, .folios, .spread, .canvas { display: grid; gap: 16px; }
  .case-files { grid-template-columns: repeat(auto-fit, minmax(min(100%, 315px), 1fr)); }
  .document-files { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
  .document-file { display: grid; grid-template-columns: 42px 1fr; gap: 12px; align-items: start; min-height: 112px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .folios, .finding { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .folio, .leaf, .conversation, .map-note {
    min-width: 0;
    padding: 22px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
  }
  .facts { max-width: 480px; margin-bottom: 24px; }
  .brief { padding: 0 16px; margin-bottom: 16px; border-block: 1px solid var(--line); }
  .brief .entry::after { content: none; }
  .transport { padding: 10px 0; margin-bottom: 14px; border-block: 1px solid var(--line); }
  .transport i { width: 68%; height: 4px; }
  .transcript { grid-template-columns: minmax(0, 2fr) minmax(190px, 0.85fr); }
  .reader, .assistant { grid-template-columns: minmax(180px, 27%) minmax(0, 1fr); }
  .leaf { display: grid; align-content: start; gap: 27px; min-height: 310px; padding: 30px 9% 38px; }
  .conversation { display: flex; flex-direction: column; gap: 24px; min-height: 325px; }
  .question { align-self: end; width: 56%; padding: 16px; border-radius: 9px; background: var(--selected); }
  .composer { margin-top: auto; }
  .canvas { min-height: 310px; padding: 9% 7%; align-items: start; grid-template-columns: 1fr 1fr; border: 1px solid var(--line); }
  .canvas.board { background-color: var(--surface); background-image: radial-gradient(var(--line) 1px, transparent 1px); background-size: 16px 16px; }
  .map-note { padding: 18px; max-width: 220px; }
  .map-note + .map-note { align-self: end; }
  @container (max-width: 710px) {
    .transcript, .reader, .finding, .assistant { grid-template-columns: minmax(0, 1fr); }
    .margin, .queue, .assistant:not(.open-thread) .conversation, .open-thread .history { display: none; }
    .index .entry:not(:first-child) { display: none; }
    .index .entry { min-height: 44px; padding-block: 4px; }
    .leaf { min-height: 235px; }
  }
  @container (max-width: 480px) {
    .head { margin-bottom: 21px; }
    .folios { grid-template-columns: minmax(0, 1fr); }
    .tools { gap: 8px; }
    .entry { min-height: 75px; }
    .case-files .folio { padding: 18px; }
    .skeleton[data-loading-view='hearings'] .tools { flex-wrap: wrap; }
    .skeleton[data-loading-view='hearings'] .search { width: 100%; height: 44px; }
    .skeleton[data-loading-view='hearings'] .entry { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 10px 14px; min-height: 115px; }
    .row-action { grid-column: 2; }
    .canvas { padding: 24px 14px; gap: 12px; }
    .map-note { padding: 12px; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .geometry { animation: settling-paper 1.35s ease-in-out 2 alternate; }
    @keyframes settling-paper { from { opacity: 0.65; } to { opacity: 1; } }
  }
</style>
