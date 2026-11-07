<script lang="ts">
  import { page } from '$app/state';
  import { invalidate, replaceState } from '$app/navigation';
  import { Compass } from '@lucide/svelte';
  import { api } from '$lib/client';
  let { en } : { en: boolean } = $props();
  let savingTour = $state(false), tourError = $state('');
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
        replaceState('', { ...page.state, judeNotice: { text: en ? 'You can open guided tours from the workspace menu.' : 'Panduan bisa dibuka kembali dari menu ruang kerja.' } });
      }
    } catch {
      tourError = en ? 'Could not save your choice. Try again.' : 'Pilihan belum tersimpan. Coba lagi.';
    } finally {
      savingTour = false;
    }
  }
</script>

<div class="invite-wrap">
    <section class="tour-invite" aria-labelledby="tour-invite-title">
      <span class="tour-symbol" aria-hidden="true"><Compass size={20} /></span>
      <div class="tour-copy">
        <h2 id="tour-invite-title">{en ? 'See how Jude works' : 'Lihat cara kerja Jude'}</h2>
        <p>{en
          ? 'Follow testimony from the synthetic hearing to the exact passage in the case file. Allow about a minute.'
          : 'Ikuti satu keterangan dari sidang contoh sampai ke kalimat persis di berkas perkara sintetis. Luangkan sekitar satu menit.'}</p>
        {#if tourError}<p class="error-text" role="alert">{tourError}</p>{/if}
      </div>
      <div class="tour-actions">
        <button class="button primary" disabled={savingTour} onclick={() => tour(true)}>{en ? 'Start the tour' : 'Mulai tur'}</button>
        <button class="button" disabled={savingTour} onclick={() => tour(false)}>{en ? 'Not now' : 'Tidak sekarang'}</button>
      </div>
    </section>
</div>

<style>
  .invite-wrap { container-type: inline-size; }
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
  .tour-copy h2 { margin: 0; font: 400 1.25rem/1.2 var(--display); }
  .tour-copy p { margin: 4px 0 0; max-width: 72ch; font-size: .86rem; color: var(--muted); }
  .tour-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .tour-actions .button { min-height: 38px; padding: 6px 12px; }
  @container (max-width: 640px) {
    .tour-invite { grid-template-columns: auto minmax(0,1fr); align-items: start; }
    .tour-actions { grid-column: 2; }
    .tour-actions .button { min-height: 44px; }
  }
</style>
