<script lang="ts">
  let { monochrome = false }: { monochrome?: boolean } = $props();
</script>

<span class="jude-lockup" aria-hidden="true">
  <span class="jude-initial" class:monochrome></span>
  <span class="jude-name">ude.</span>
</span>

<style>
  .jude-lockup {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    font-family: Rufina, Georgia, serif;
    line-height: 1;
    white-space: nowrap;
  }
  .jude-initial {
    flex: none;
    height: .88em;
    aspect-ratio: 468 / 743;
    transform: translateY(.035em);
    background: url('/brand/jude-primary.png') center / contain no-repeat;
  }
  .jude-initial.monochrome {
    background: currentColor;
    mask: url('/brand/jude-mono.png') center / contain no-repeat;
  }
  .jude-name {
    display: var(--jude-name-display, inline);
    margin-inline-start: -.035em;
  }
  @media (forced-colors: active) {
    .jude-lockup .jude-initial {
      forced-color-adjust: none;
      background: LinkText;
      mask: url('/brand/jude-mono.png') center / contain no-repeat;
    }
  }
  @media (max-width: 420px) {
    :global(.pub-header) .jude-lockup { font-size: clamp(31px, calc(24vw - 46px), 1em); }
  }
</style>
