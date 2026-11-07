<script lang="ts">
  import { page } from '$app/state';
  import { invalidate, replaceState } from '$app/navigation';
  import { Compass } from '@lucide/svelte';
  import { api } from '$lib/client';
  let { en, compact = false }: { en: boolean; compact?: boolean } = $props();
  const title = $derived(en ? 'See how Jude works' : 'Lihat cara kerja Jude');
  const description = $derived(
    en
      ? 'Follow testimony from the synthetic hearing to the exact passage in the case file. Allow about a minute.'
      : 'Ikuti satu keterangan dari sidang contoh sampai ke kalimat persis di berkas perkara sintetis. Luangkan sekitar satu menit.',
  );
  let savingTour = $state(false),
    tourError = $state('');
  async function tour(start: boolean) {
    if (savingTour) return;
    savingTour = true;
    tourError = '';
    const previous = page.url.pathname;
    try {
      await api('/api/me/prefs', 'PATCH', { tourSeen: true });
      await invalidate('jude:session');
      if (page.url.pathname !== previous) return;
      if (start) {
        replaceState('', { ...page.state, judeTour: true });
      } else {
        const main = document.getElementById('case-main');
        const heading = main?.querySelector<HTMLElement>('h1');
        if (heading) heading.tabIndex = -1;
        (heading ?? main)?.focus({ preventScroll: true });
        replaceState('', {
          ...page.state,
          judeNotice: {
            text: en
              ? 'You can open guided tours from the workspace menu.'
              : 'Panduan bisa dibuka kembali dari menu ruang kerja.',
          },
        });
      }
    } catch {
      tourError = en ? 'Could not save your choice. Try again.' : 'Pilihan belum tersimpan. Coba lagi.';
    } finally {
      savingTour = false;
    }
  }
</script>

{#snippet actions()}
  <div class="tour-actions">
    <button class="button primary" disabled={savingTour} onclick={() => tour(true)}
      >{en ? 'Start the tour' : 'Mulai tur'}</button
    >
    <button class="button" disabled={savingTour} onclick={() => tour(false)}
      >{en ? 'Not now' : 'Tidak sekarang'}</button
    >
  </div>
{/snippet}
<div class="invite-wrap" class:compact>
  <section class="tour-invite" aria-labelledby="tour-invite-title">
    <span class="tour-symbol" aria-hidden="true"><Compass size={20} /></span>
    <div class="tour-copy">
      <h2 id="tour-invite-title">{title}</h2>
      <p>{description}</p>
    </div>
    {@render actions()}
  </section>
  {#if compact}
    <details class="compact-invite">
      <summary><Compass size={16} aria-hidden="true" />{title}</summary>
      <p>{description}</p>
      {@render actions()}
    </details>
  {/if}
  {#if tourError}<p class="error-text" role="alert">{tourError}</p>{/if}
</div>

<style>
  .invite-wrap {
    container-type: inline-size;
  }
  .compact-invite {
    display: none;
  }
  .tour-invite {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: center;
    margin: 0 0 23px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
  }
  .tour-symbol {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--ink);
    background: var(--wash);
  }
  .tour-copy h2 {
    margin: 0;
    font: 400 1.25rem/1.2 var(--display);
  }
  .tour-copy p {
    margin: 4px 0 0;
    max-width: 72ch;
    font-size: 0.86rem;
    color: var(--muted);
  }
  .tour-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tour-actions .button {
    min-height: 38px;
    padding: 6px 12px;
  }
  @container (max-width: 640px) {
    .tour-invite {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
    }
    .tour-actions {
      grid-column: 2;
    }
    .tour-actions .button {
      min-height: 44px;
    }
  }
  @container (max-width:480px) {
    .compact .tour-invite {
      display: none;
    }
    .compact-invite {
      display: block;
      margin-bottom: 10px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
    }
    .compact-invite summary {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 38px;
      cursor: pointer;
      list-style: none;
      font: 600 13px/1.4 var(--sans);
    }
    .compact-invite summary::-webkit-details-marker {
      display: none;
    }
    .compact-invite summary::after {
      content: '';
      width: 6px;
      height: 6px;
      margin-left: auto;
      margin-right: 5px;
      border-bottom: 1.5px solid currentColor;
      border-right: 1.5px solid currentColor;
      transform: rotate(45deg);
    }
    .compact-invite[open] summary::after {
      transform: rotate(225deg);
    }
    .compact-invite p {
      margin: 2px 0 8px;
      font-size: 13px;
    }
    .compact-invite .tour-actions {
      padding-bottom: 8px;
    }
  }
</style>
