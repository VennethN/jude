<script lang="ts">
  import { page } from '$app/state';
  const en = $derived(page.data.lang === 'en');
</script>
<svelte:head><title>{page.status} · Jude</title></svelte:head>
<main class="error-page">
  <a class="brand" href="/">Jude</a>
  <p>{page.status}</p>
  <h1>{page.status === 404 ? (en ? 'This record could not be found.' : 'Catatan ini tidak ditemukan.') : (en ? 'This page could not be opened.' : 'Halaman ini belum dapat dibuka.')}</h1>
  <a class="button primary" href="/cases">{en ? 'Return to cases' : 'Kembali ke perkara'}</a>
</main>
<style>.error-page{padding:clamp(32px,10vw,140px);max-width:830px}.error-page p{margin-top:80px}.error-page h1{margin-bottom:32px}</style>
