<script module lang="ts">
  export interface FindingNavigation {
    index: number;
    total: number;
    step: (delta: number) => void;
  }
</script>

<script lang="ts">
  import { ChevronDown, ChevronUp, ChevronRight, ChevronLeft } from '@lucide/svelte';
  import type { Lang } from '@jude/core/domain';
  let {
    navigation,
    lang,
    vertical = false
  }: { navigation: FindingNavigation; lang: Lang; vertical?: boolean } = $props();
</script>

<nav class="finding-pager" aria-label={lang === 'id' ? 'Urutan temuan' : 'Finding navigation'}>
  <span aria-live="polite">{navigation.index + 1} {lang === 'id' ? 'dari' : 'of'} {navigation.total}</span>
  <button
    type="button"
    aria-label={lang === 'id' ? 'Temuan sebelumnya' : 'Previous finding'}
    disabled={navigation.index === 0}
    onclick={() => navigation.step(-1)}
    >{#if vertical}<ChevronUp size={16} />{:else}<ChevronLeft size={16} />{/if}</button
  >
  <button
    type="button"
    aria-label={lang === 'id' ? 'Temuan berikutnya' : 'Next finding'}
    disabled={navigation.index === navigation.total - 1}
    onclick={() => navigation.step(1)}
    >{#if vertical}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}</button
  >
</nav>

<style>
  .finding-pager {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    font: 400 12px/1.5 var(--sans);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .finding-pager span {
    margin-right: 3px;
    white-space: nowrap;
  }
  button {
    display: inline-grid;
    place-items: center;
    min-width: 30px;
    min-height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink-strong);
  }
  button:disabled {
    opacity: 0.45;
  }
  button:hover:not(:disabled) {
    background: var(--sunken);
  }
  @media (pointer: coarse) {
    button {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
