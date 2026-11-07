<script lang="ts">
  import { Check, Dot } from '@lucide/svelte';
  import type { Status } from '@jude/core/domain';
  import { meaningful } from './records';

  let { status, reviewed = false, size = 24 }: { status: Status; reviewed?: boolean; size?: number } = $props();
</script>

<span
  class="review-mark"
  class:loud={status === 'potential_inconsistency'}
  class:done={reviewed}
  class:quiet={!reviewed && !meaningful(status)}
  style:--mark-size={size + 'px'}
  aria-hidden="true"
>
  {#if reviewed}<Check size={Math.round(size * 0.53)} strokeWidth={2.7} />
  {:else if meaningful(status)}<svg
      width={Math.round(size * 0.5)}
      height={Math.round(size * 0.5)}
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M6 2.1v4.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /><circle
        cx="6"
        cy="9.5"
        r="1.1"
      />
    </svg>
  {:else}<Dot size={Math.round(size * 0.65)} />{/if}
</span>

<style>
  .review-mark {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: var(--mark-size);
    height: var(--mark-size);
    border-radius: 50%;
    background: var(--st-context-dot);
    color: var(--on-accent);
  }
  .loud {
    background: var(--alert);
  }
  .done,
  .quiet {
    background: var(--line-strong);
    color: var(--ink-strong);
  }
  @media (forced-colors: active) {
    .review-mark {
      border: 1px solid CanvasText;
    }
  }
</style>
