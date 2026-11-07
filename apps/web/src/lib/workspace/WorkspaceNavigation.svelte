<script lang="ts">
  import { navigating, page } from '$app/state';
  import type { Snippet } from 'svelte';
  import { loadingTitles, loadingView } from './loading-view';
  import RouteSkeleton from './RouteSkeleton.svelte';

  let { en, children }: { en: boolean; children: Snippet } = $props();
  let elapsed = $state(false);

  const destination = $derived.by(() => {
    const to = navigating.to;
    if (!to || navigating.willUnload) return;
    const view = loadingView(to);
    if (!view) return;
    if (page.url.pathname === to.url.pathname) {
      // Changing a passage, transcript line, queue filter or search keeps its current controls.
      const boardChanged = (view === 'board' || view === 'findings') &&
        (page.url.searchParams.get('view') === 'board') !== (view === 'board');
      if (!boardChanged) return;
    }
    return { to, view };
  });

  $effect(() => {
    const next = destination;
    if (!next) {
      elapsed = false;
      return;
    }
    const timer = setTimeout(() => {
      if (navigating.to === next.to) elapsed = true;
    }, 200);
    return () => clearTimeout(timer);
  });

  const preview = $derived(elapsed ? destination?.view : undefined);
  const title = $derived(preview ? loadingTitles[preview][en ? 1 : 0] : '');
  const announcement = $derived(title ? (en ? 'Loading ' : 'Memuat ') + title[0].toLowerCase() + title.slice(1) + '…' : '');
</script>

<span class="sr-only" role="status" aria-atomic="true">{announcement}</span>
<div class="stage" aria-busy={Boolean(preview)}>
  {#if preview}
    <div class="position"><RouteSkeleton view={preview} {title} {en} /></div>
  {/if}
  <div class="current-page" class:concealed={!!preview} inert={!!preview}>
    {@render children()}
  </div>
</div>

<style>
  .stage, .current-page { display: contents; }
  /* Keep the outgoing route mounted so an interrupted navigation preserves drafts and recordings. */
  .concealed { visibility: hidden; }
  .position {
    --loading-top: calc(var(--bar-height, 56px) + 16px);
    position: sticky;
    top: var(--loading-top);
    z-index: 2;
    flex: none;
    height: 0;
    pointer-events: none;
  }
  @media (min-width: 720px) {
    :global(.desk.has-live) .position { --loading-top: calc(var(--bar-height, 56px) + 66px); }
  }
</style>
