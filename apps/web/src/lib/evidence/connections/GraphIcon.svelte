<script lang="ts">
  import { AudioLines, CircleAlert, FileText, Headphones } from '@lucide/svelte';
  import type { Speaker } from '@jude/core/domain';
  import type { IconKind } from './map-records';
  let {
    kind,
    size = 16,
    speakerId,
    speakers = []
  }: { kind: IconKind; size?: number; speakerId?: string; speakers?: Speaker[] } = $props();
  let person = $derived(speakers.find((s) => s.id === speakerId));
  let resolved = $derived(speakers.find((s) => s.id === person?.alias) ?? person);
  let label = $derived(resolved?.label?.replace(/^(Saksi|Witness|Terdakwa)\s+/i, '') ?? '');
  let letters = $derived(
    resolved?.role === 'witness'
      ? label.charAt(0)
      : label
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w.charAt(0))
          .join('')
  );
</script>

{#if kind === 'statement' && person}<span
    class="disc"
    data-role={resolved?.role}
    style:--size={size + 'px'}
    aria-hidden="true">{letters || '·'}</span
  >
{:else if kind === 'finding'}<CircleAlert {size} aria-hidden="true" />
{:else if kind === 'hearing'}<Headphones {size} aria-hidden="true" />
{:else if kind === 'statement'}<AudioLines {size} aria-hidden="true" />
{:else}<FileText {size} aria-hidden="true" />{/if}

<style>
  .disc {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--forest);
    color: var(--on-forest);
    font: 600 calc(var(--size) * 0.45)/1 var(--sans);
  }
  .disc[data-role='witness'] {
    background: var(--sand-ink);
    color: var(--on-forest);
  }
</style>
