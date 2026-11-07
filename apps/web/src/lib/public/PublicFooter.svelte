<script lang="ts">
  import { page } from '$app/state';
  import Wordmark from './Wordmark.svelte';
  import Icon from './Icon.svelte';
  import type { Language } from '@jude/core/plans';

  let { lang }: { lang: Language } = $props();
  const id = $derived(lang === 'id');
  const pricing = $derived(page.url.pathname === '/pricing');
  const home = $derived(pricing ? '/' : '');
</script>

{#if page.url.pathname === '/' || pricing}
  <footer class="paper-foot" class:pricing>
    <div class="foot-wrap">
      <div class="foot-top">
        <div class="foot-brand">
          <a class="foot-mark" href={pricing ? '/' : '#public-main'} aria-label={pricing ? (id ? 'Beranda Jude' : 'Jude home') : (id ? 'Kembali ke atas' : 'Back to top')}>jude.</a>
          <p>{id ? 'Kecerdasan ruang sidang berbasis bukti.' : 'Evidence-grounded courtroom intelligence.'}</p>
        </div>
        <nav class="foot-nav" aria-label={id ? 'Navigasi kaki halaman' : 'Footer navigation'}>
          <a href={home + '#lp-how'}>{id ? 'Cara kerja' : 'How it works'}</a>
          <a href={home + '#lp-source'}>{id ? 'Berbasis bukti' : 'Evidence first'}</a>
          <a href={home + '#lp-approach'}>{id ? 'Pendekatan kami' : 'Our approach'}</a>
          <a href="/pricing" aria-current={pricing ? 'page' : undefined}>{id ? 'Harga' : 'Pricing'}</a>
          <a class="open" href="/cases">{id ? 'Buka ruang kerja' : 'Open workspace'} <Icon name="forward" size={15}/></a>
        </nav>
        <form class="foot-lang" method="POST" action="/language" aria-label={id ? 'Bahasa' : 'Language'}>
          <input type="hidden" name="next" value={page.url.pathname + page.url.search} />
          <button name="lang" value="id" aria-pressed={id} lang="id" aria-label="ID · Bahasa Indonesia">ID</button>
          <button name="lang" value="en" aria-pressed={!id} lang="en" aria-label="EN · English">EN</button>
        </form>
      </div>
      <div class="foot-notes">
        <p>{id ? 'Dirancang untuk praktisi hukum Indonesia.' : 'Designed for Indonesian legal professionals.'}</p>
        <p>{pricing ? (id ? 'Harga dan kuota merupakan contoh. Tagihan disimulasikan. Temuan menghubungkan keterangan dengan berkas sumber untuk penilaian praktisi.' : 'Prices and quotas are examples. Billing is simulated. Findings link testimony to source records for practitioners to assess.') : (id ? 'Temuan menghubungkan bukti. Penilaian hukum tetap berada di tangan praktisi.' : 'Findings connect evidence. Legal judgment stays with the practitioner.')}</p>
        <p>{id ? 'Perkara contoh · data sintetis' : 'Example case · synthetic data'}</p>
      </div>
    </div>
  </footer>
{:else}
  <footer class="pub-footer">
    <div class="pub-frame inner">
      <Wordmark />
      <span>{id ? 'Ruang kerja untuk advokat.' : 'A workspace for advocates.'}</span>
      <nav aria-label={id ? 'Navigasi kaki halaman' : 'Footer navigation'}>
        <a href="/pricing">{id ? 'Harga' : 'Pricing'}</a>
        <a href="/cases">{id ? 'Ruang kerja' : 'Workspace'} <Icon name="forward" size={14}/></a>
      </nav>
    </div>
  </footer>
{/if}

<style>
  .pub-footer { color: #e8eddf; background: #142f26; }
  .inner { min-height: 105px; display: flex; align-items: center; flex-wrap: wrap; gap: 26px; }
  .inner > span { font-size: .79rem; color: #c2d0c2; }
  .inner nav { margin-left: auto; display: flex; gap: 20px; }
  .inner nav a { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; color: inherit; font-size: .84rem; }
  .paper-foot { color: #14281f; background: #faf7f0; }
  .foot-wrap { width: min(90%, 1320px); margin: auto; display: grid; gap: 26px; padding: 56px 0 72px; }
  .foot-top { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px 48px; padding-bottom: 30px; border-bottom: 1px solid #d9d6ca; }
  .foot-brand { margin-right: auto; }
  .foot-mark { display: inline-block; margin-bottom: 8px; font: 400 43px/1 Rufina, Georgia, serif; color: #16382b; text-decoration: none; letter-spacing: -.02em; }
  .paper-foot p { font-size: 14px; line-height: 1.65; color: #64675e; }
  .foot-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 28px; padding-top: 16px; }
  .foot-nav a { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; font-size: 14.5px; color: inherit; text-decoration: none; text-underline-offset: 5px; }
  .foot-nav a:hover { text-decoration: underline; }
  .foot-nav .open { font-weight: 600; }
  .foot-lang { display: inline-flex; padding: 3px; margin-top: 12px; border: 1px solid #d9d6ca; border-radius: 30px; }
  .foot-lang button { min-width: 36px; padding: 3px 9px; border-radius: 30px; border: 0; background: transparent; color: #586155; font: 600 12.5px/1.65 var(--sans); cursor: pointer; }
  .foot-lang button[aria-pressed='true'] { background: #16382b; color: #f6f0e4; }
  .foot-notes { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.5fr) auto; gap: 8px 40px; }
  .foot-notes p:first-child { color: #14281f; }
  @media (max-width: 680px) {
    .inner { padding-block: 20px; gap: 10px 15px; }
    .inner nav { margin: 0; width: 100%; }
    .foot-wrap { width: calc(100% - 40px); }
    .foot-top { flex-direction: column; gap: 16px; }
    .foot-nav { flex-direction: column; align-items: flex-start; gap: 2px; padding: 0; }
    .foot-nav a { min-height: 40px; font-size: 16px; }
    .foot-lang { margin-top: 4px; }
    .foot-notes { grid-template-columns: 1fr; }
    .pricing .foot-top { flex-direction: row; gap: 24px 48px; }
    .pricing .foot-nav { flex-direction: row; flex: 1 1 100%; align-items: center; gap: 6px 27px; padding-top: 12px; }
    .pricing .foot-nav a { font-size: 14.5px; }
    .pricing .foot-nav a[aria-current='page'] { text-decoration: underline; }
  }
  @media (pointer: coarse) { .foot-nav a, .foot-lang button { min-height: 44px; } }
</style>
