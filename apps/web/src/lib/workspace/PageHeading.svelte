<script module lang="ts">
  export type HeadingArt = 'folder' | 'speech' | 'page' | 'finding' | 'connect' | 'spool' | 'quote' | 'scales' | 'bookmark';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let { art, compact = false, narrow = false, children }: {
    art: HeadingArt;
    compact?: boolean;
    narrow?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="object-heading" class:compact class:narrow>
  <img src={'/public/clay/' + art + '.webp'} alt="" width="64" height="64" decoding="async" draggable="false" />
  <div class="heading-copy">{@render children()}</div>
</div>

<style>
  .object-heading {
    --object-size: 62px;
    display: grid;
    grid-template-columns: var(--object-size) minmax(0, 1fr);
    align-items: start;
    column-gap: 16px;
    min-width: 0;
    max-width: 100%;
  }
  img {
    display: block;
    width: var(--object-size);
    height: var(--object-size);
    object-fit: contain;
    pointer-events: none;
    user-select: none;
  }
  .heading-copy { min-width: 0; overflow-wrap: anywhere; }
  .compact {
    --object-size: 34px;
    align-items: center;
    column-gap: 10px;
  }
  .compact .heading-copy:has(> :global(p)) { display: contents; }
  .compact .heading-copy :global(p) { grid-column: 2; }
  /* An open conversation takes over the narrow layout, where the section title is hidden. */
  @container (min-width: 880px) {
    .narrow, .narrow .heading-copy { display: contents; }
    .narrow img { display: none; }
  }
  @container (max-width: 620px) {
    .object-heading:not(.compact) {
      --object-size: 42px;
      align-items: center;
      column-gap: 12px;
    }
    .object-heading:not(.compact) .heading-copy { display: contents; }
    .object-heading:not(.compact) .heading-copy :global(h1) { min-width: 0; }
    .object-heading:not(.compact) .heading-copy :global(p) { grid-column: 1 / -1; }
    .compact { --object-size: 28px; column-gap: 8px; }
  }
  @media (max-width: 380px) {
    .object-heading:not(.compact) { --object-size: 36px; column-gap: 10px; }
    .compact { --object-size: 25px; column-gap: 7px; }
  }
</style>
