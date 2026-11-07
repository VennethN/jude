<script lang="ts">
  import type { Lang, Status } from '@jude/core/domain';
  import { statuses } from './records';

  let { status, lang, small = false }: { status: Status; lang: Lang; small?: boolean } = $props();
</script>

<span class="status-chip" class:small data-status={status}>
  <span class="status-shape" aria-hidden="true"></span>{statuses[status][lang]}
</span>

<style>
  .status-chip {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    gap: 6px;
    padding: 3px 9px 3px 7px;
    border-radius: 4px;
    background: var(--chip-bg);
    color: var(--chip-ink);
    font: 600 12px/1.3 var(--sans);
  }
  .small {
    font-size: 11px;
    padding: 2px 7px 2px 6px;
  }
  [data-status='supported'] {
    --chip-bg: var(--st-supported-bg);
    --chip-ink: var(--st-supported-ink);
    --dot: var(--st-supported-dot);
  }
  [data-status='potential_inconsistency'] {
    --chip-bg: var(--st-inconsistency-bg);
    --chip-ink: var(--st-inconsistency-ink);
    --dot: var(--st-inconsistency-dot);
  }
  [data-status='context_needed'] {
    --chip-bg: var(--st-context-bg);
    --chip-ink: var(--st-context-ink);
    --dot: var(--st-context-dot);
  }
  [data-status='insufficient_evidence'] {
    --chip-bg: var(--st-insufficient-bg);
    --chip-ink: var(--st-insufficient-ink);
    --dot: var(--st-insufficient-dot);
  }
  .status-shape {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--dot);
  }
  [data-status='potential_inconsistency'] .status-shape {
    transform: rotate(45deg);
    border-radius: 1px;
  }
  [data-status='context_needed'] .status-shape {
    border: 2px solid var(--dot);
    background: transparent;
  }
  [data-status='insufficient_evidence'] .status-shape {
    height: 2px;
    border-radius: 1px;
  }
  @media (forced-colors: active) {
    .status-shape {
      border: 1px solid CanvasText;
    }
  }
</style>
