<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import type { Finding, Lang, Workspace } from '@jude/core/domain';
  import { clock, local, statuses } from './records';
  import ReviewMark from './ReviewMark.svelte';

  let {
    workspace,
    lang,
    list,
    selected,
    href,
    pick
  }: {
    workspace: Workspace;
    lang: Lang;
    list: Finding[];
    selected?: string;
    href: (finding: Finding) => string;
    pick: (event: MouseEvent, finding: Finding) => void;
  } = $props();
  let hearings = $derived(new Map(workspace.hearings.map((h) => [h.id, h])));
  let statements = $derived(new Map(workspace.statements.map((s) => [s.id, s])));
</script>

<section class="queue" data-tour="findings-queue" aria-label={lang === 'id' ? 'Daftar temuan' : 'Findings list'}>
  {#each list as finding, i (finding.id)}
    {@const hearing = hearings.get(finding.hearingId)}
    {@const statement = statements.get(finding.statementId)}
    {#if hearing && (!i || finding.hearingId !== list[i - 1].hearingId)}
      <h2 class="hearing-group">
        {lang === 'id' ? 'Sidang' : 'Hearing'}
        {hearing.number} · {local(hearing.title, lang)}
      </h2>
    {/if}
    <a
      class="ev-pick finding-card"
      href={href(finding)}
      onclick={(event) => pick(event, finding)}
      aria-current={selected === finding.id ? 'page' : undefined}
    >
      <ReviewMark status={finding.status} reviewed={finding.reviewed} />
      <span class="body"
        ><strong>{local(finding.title, lang)}</strong>
        <span class="meta">{statuses[finding.status][lang]}{statement ? ' · ' + clock(statement.t) : ''}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </a>
  {/each}
</section>

<style>
  .queue {
    display: grid;
    align-content: start;
    gap: 8px;
    min-width: 0;
  }
  .hearing-group {
    padding: 8px 2px 2px;
    margin: 0;
    color: var(--muted);
    font: 600 12px/1.55 var(--sans);
    letter-spacing: 0;
    text-wrap: pretty;
  }
  .hearing-group:first-child {
    padding-top: 2px;
  }
  .finding-card {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    width: 100%;
    padding: 10px 10px 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink-strong);
    text-decoration: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .finding-card:hover {
    background: var(--surface);
    border-color: var(--line-strong);
    box-shadow: var(--shadow-raise);
  }
  .finding-card[aria-current] {
    border-color: var(--selected-line);
    box-shadow: inset 0 0 0 1px var(--selected-line);
    background: var(--selected);
  }
  .finding-card[aria-current] .meta {
    color: var(--muted-on-fill);
  }
  .finding-card:active {
    transform: scale(0.99);
  }
  .finding-card:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .body strong {
    color:var(--ink-strong);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font: 600 13.5px/1.4 var(--sans);
    letter-spacing: -0.005em;
  }
  .meta {
    color: var(--muted);
    font: 400 12px/1.55 var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .finding-card > :global(svg) {
    flex: none;
    color: var(--muted);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .finding-card:hover > :global(svg) {
    transform: translateX(2px);
  }
  @media (prefers-reduced-motion: reduce) {
    .finding-card:active,
    .finding-card:hover > :global(svg) {
      transform: none;
    }
  }
</style>
