<script lang="ts">
  import { page } from '$app/state';
  import { afterNavigate } from '$app/navigation';
  import Wordmark from './Wordmark.svelte';
  import Icon from './Icon.svelte';
  import type { Language } from '@jude/core/plans';
  let { lang, signedIn = false }: { lang: Language; signedIn?: boolean } = $props();
  let isId = $derived(lang === 'id');
  const accountLabel = $derived(signedIn ? (isId ? 'Buka ruang kerja' : 'Open workspace') : (isId ? 'Masuk' : 'Sign in'));
  let menu: HTMLDetailsElement;
  let summary: HTMLElement;
  afterNavigate(({ from }) => {
    if (from && menu) menu.open = false;
  });
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menu?.open) {
      menu.open = false;
      summary.focus();
    }
  }
  function closeOutside(event: PointerEvent) {
    if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  }
</script>

<svelte:window onkeydown={keydown} onpointerdown={closeOutside} />
{#snippet navlinks()}
  <a href="/#lp-how">{isId ? 'Cara kerja' : 'How it works'}</a>
  <a href="/#lp-source">{isId ? 'Berbasis bukti' : 'Evidence first'}</a>
  <a href="/#lp-approach">{isId ? 'Pendekatan kami' : 'Our approach'}</a>
  <a href="/pricing" aria-current={page.url.pathname === '/pricing' ? 'page' : undefined}
    >{isId ? 'Harga' : 'Pricing'}</a
  >
{/snippet}
{#snippet language()}
  <form method="POST" action="/language" class="language" aria-label={isId ? 'Bahasa' : 'Language'}>
    <input type="hidden" name="next" value={page.url.pathname + page.url.search} />
    <button name="lang" value="id" lang="id" aria-pressed={isId} aria-label="ID · Bahasa Indonesia">ID</button>
    <span aria-hidden="true">/</span>
    <button name="lang" value="en" lang="en" aria-pressed={!isId} aria-label="EN · English">EN</button>
  </form>
{/snippet}
<header class="pub-header" class:cover={['/', '/pricing', '/login', '/signup'].includes(page.url.pathname)}>
  <nav class="pub-frame pub-nav" aria-label={isId ? 'Navigasi utama' : 'Main navigation'}>
    <Wordmark />
    <div class="middle">{@render navlinks()}</div>
    <div class="nav-right">
      {@render language()}
      <a class="entry" href={signedIn ? '/cases' : '/login'}
        >{accountLabel} <Icon name="forward" size={15} /></a
      >
    </div>
    <details
      bind:this={menu}
      class="mobile-menu"
      onfocusout={(e) => {
        if (e.relatedTarget instanceof Node && !menu.contains(e.relatedTarget)) menu.open = false;
      }}
    >
      <summary bind:this={summary} aria-label="Menu"><Icon name="menu" size={22} /></summary>
      <div class="mobile-links">
        {@render navlinks()}{@render language()}
      </div>
    </details>
  </nav>
</header>

<style>
  .pub-header {
    background: #142f26;
    color: #f6f0e3;
    position: relative;
    z-index: 5;
  }
  .pub-nav {
    min-height: 83px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    border-bottom: 1px solid #ffffff30;
  }
  .middle,
  .nav-right,
  .language {
    display: flex;
    align-items: center;
  }
  .middle {
    gap: clamp(20px, 3vw, 44px);
  }
  .middle a,
  .mobile-links > a,
  .entry {
    color: inherit;
    text-decoration: none;
    font: 500 0.87rem/1.3 var(--sans, Manrope, sans-serif);
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  a:hover,
  a[aria-current='page'] {
    text-decoration: underline;
    text-underline-offset: 0.38em;
  }
  .nav-right {
    gap: 23px;
  }
  .language {
    font: 500 0.75rem/1 var(--sans, Manrope, sans-serif);
  }
  .language button {
    background: transparent;
    border: 0;
    color: #c6d2c5;
    font: inherit;
    min-height: 44px;
    min-width: 35px;
    cursor: pointer;
  }
  .language button[aria-pressed='true'] {
    color: #fff9e9;
    text-decoration: underline;
    text-underline-offset: 0.35em;
  }
  .language span {
    color: #a9b8ac;
  }
  .entry {
    padding: 0 16px;
    border: 1px solid #aab9a780;
    border-radius: 4px;
    gap: 10px;
    justify-content: center;
  }
  .entry:hover {
    background: #25483a;
    text-decoration: none;
  }
  .mobile-menu {
    display: none;
    position: relative;
  }
  .mobile-menu summary {
    display: grid;
    place-items: center;
    list-style: none;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    border: 1px solid #aab9a780;
    border-radius: 4px;
  }
  .mobile-menu summary::-webkit-details-marker {
    display: none;
  }
  .mobile-links {
    position: absolute;
    top: calc(100% + 5px);
    right: 0;
    min-width: 210px;
    display: grid;
    padding: 16px 20px;
    background: #193b2e;
    box-shadow: 0 12px 36px #071b1470;
    border-radius: 4px;
  }
  .mobile-links > a,
  .mobile-links .language {
    border-bottom: 1px solid #ffffff25;
  }
  .mobile-links .entry {
    margin-top: 12px;
  }
  @media (max-width: 760px) {
    .pub-nav {
      min-height: 68px;
    }
    .middle,
    .nav-right .language {
      display: none;
    }
    .nav-right { margin-left: auto; }
    .mobile-menu {
      display: block;
    }
  }

  .pub-header.cover {
    position: absolute;
    top: 14px;
    left: 14px;
    right: 14px;
    background: transparent;
  }
  .cover .pub-nav {
    height: 102px;
    min-height: 0;
    width: auto;
    margin-inline: clamp(30px, 5vw, 76px);
    border: 0;
    justify-content: flex-start;
    gap: clamp(17px, 2.2vw, 34px);
  }
  .cover .middle {
    margin-left: auto;
    gap: clamp(15px, 1.8vw, 28px);
  }
  .cover .middle a {
    font-size: 0.98rem;
    font-weight: 400;
  }
  .cover :global(.wordmark) {
    font-size: clamp(3rem, 3.75vw, 3.6rem);
  }
  .cover .entry {
    font:
      400 1.25rem/1.2 'Caslon Display',
      Georgia,
      serif;
    padding-inline: 21px;
    min-height: 47px;
    border-radius: 7px;
  }
  .cover .language {
    border: 1px solid #bac8b674;
    border-radius: 40px;
    padding: 3px;
  }
  .cover .language span {
    display: none;
  }
  .cover .language button {
    min-height: 27px;
    min-width: 34px;
    border-radius: 30px;
    text-decoration: none;
    color: #e8ece3;
  }
  .cover .language button[aria-pressed='true'] {
    color: #23392e;
    background: #f4efdf;
  }
  @media (max-width: 900px) {
    .cover .middle,
    .cover .nav-right .language {
      display: none;
    }
    .cover .nav-right { margin-left: auto; }
    .cover .mobile-menu {
      display: block;
    }
    .cover .mobile-links .language {
      justify-self: start;
    }
    .cover .entry {
      min-height: 44px;
      padding-inline: 13px;
      font: 600 .9rem/1.25 var(--pub-body);
    }
  }
  @media (pointer: coarse) {
    .cover .language button {
      min-height: 44px;
      min-width: 44px;
    }
  }
  @media (max-width: 600px) {
    .pub-header.cover {
      top: 8px;
      left: 8px;
      right: 8px;
    }
    .cover .pub-nav {
      margin-inline: 20px;
      height: 83px;
    }
    .cover :global(.wordmark) {
      font-size: 3.15rem;
    }
  }
</style>
