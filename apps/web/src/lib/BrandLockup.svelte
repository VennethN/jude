<script lang="ts">
  let { monochrome = false }: { monochrome?: boolean } = $props();
</script>

<span class="jude-lockup">
  <img src={monochrome ? '/brand/jude-mono.png' : '/brand/jude-primary.png'}
    alt="" width="468" height="743" draggable="false" />
  <span class="jude-name">jude.</span>
</span>

<style>
  .jude-lockup {
    display: inline-flex;
    align-items: center;
    gap: .32em;
    vertical-align: middle;
    font-family: Rufina, Georgia, serif;
    line-height: 1;
    white-space: nowrap;
  }
  img {
    display: block;
    flex: none;
    height: var(--jude-mark-height, .88em);
    width: auto;
    max-width: none;
  }
  .jude-name { display: var(--jude-name-display, inline); }
  @media (max-width: 420px) {
    :global(.pub-header) .jude-lockup { font-size: clamp(31px, calc(24vw - 46px), 1em); }
  }
</style>
