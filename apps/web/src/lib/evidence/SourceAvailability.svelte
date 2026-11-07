<script lang="ts">
  import { FileX2 } from '@lucide/svelte';
  import type { Finding, Lang } from '@jude/core/domain';
  let { finding, lang }: { finding: Finding; lang: Lang } = $props();
  let absent = $derived(finding.unavailableSources ?? []),
    en = $derived(lang === 'en');
</script>

{#if absent.length}<section
    class="unavailable"
    aria-label={en ? 'Unavailable citations' : 'Kutipan yang tidak tersedia'}
  >
    <h3><FileX2 size={15} />{en ? 'Source removed' : 'Sumber dihapus'}</h3>
    <ul>
      {#each absent as source (source.passageId)}<li>
          {source.documentTitle} · {en ? 'p.' : 'hal.'}
          {source.page}
        </li>{/each}
    </ul>
  </section>{/if}

<style>
  .unavailable {
    margin: 0.65rem 0;
    color: var(--muted);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font: 650 0.8rem/1.4 var(--sans);
    color: var(--accent);
  }
  ul {
    padding: 0;
    list-style: none;
    margin: 0.3rem 0 0;
  }
  li {
    font: 400 0.8rem/1.5 var(--mono);
  }
</style>
