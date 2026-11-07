<script lang="ts">
  import { onMount } from 'svelte';
  import type { Lang } from '@jude/core/domain';

  let { lang, privateAccount }: { lang: Lang; privateAccount: boolean } = $props();
  let opening = $state(false);
  let message = $state('');
  let last = $state<HTMLAnchorElement>();
  let controller: AbortController | undefined;
  const en = $derived(lang === 'en');
  const pending = $derived(privateAccount
    ? (en ? 'Opening your workspace…' : 'Membuka ruang kerja Anda…')
    : (en ? 'Opening the example case…' : 'Membuka perkara contoh…'));

  function reset() {
    controller?.abort();
    controller = undefined;
    last?.removeAttribute('aria-busy');
    opening = false;
    message = '';
  }
  async function enter(link: HTMLAnchorElement) {
    if (opening) return;
    const request = new AbortController();
    controller = request;
    last = link;
    link.setAttribute('aria-busy', 'true');
    opening = true;
    message = '';
    const timeout = window.setTimeout(() => request.abort(), 30000);
    try {
      const response = await fetch(link.href, {
        method: 'POST', headers: { Accept: 'application/json' }, signal: request.signal,
      });
      if (!response.ok) {
        if (response.status === 429) message = en
          ? 'Too many example workspaces have been opened. Try again later.'
          : 'Terlalu banyak ruang contoh telah dibuka. Coba lagi nanti.';
        throw Error();
      }
      const result = await response.json();
      const target = new URL(result.location, location.origin);
      if (target.origin !== location.origin || !/^\/cases$|^\/case\//.test(target.pathname)) throw Error();
      if (controller === request) location.assign(target.href);
    } catch {
      if (controller !== request) return;
      opening = false;
      link.removeAttribute('aria-busy');
      if (!message) message = en ? 'The workspace could not be opened.' : 'Ruang kerja belum dapat dibuka.';
    } finally {
      clearTimeout(timeout);
    }
  }

  onMount(() => {
    function follow(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || !link.closest('.public-world') || link.origin !== location.origin || !/^\/demo(?:\/|$)/.test(link.pathname) ||
        (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      event.preventDefault();
      void enter(link);
    }
    function restored(event: PageTransitionEvent) {
      if (event.persisted) reset();
    }
    document.addEventListener('click', follow, true);
    window.addEventListener('pageshow', restored);
    return () => {
      document.removeEventListener('click', follow, true);
      window.removeEventListener('pageshow', restored);
      reset();
    };
  });
</script>

<div class="demo-feedback" class:visible={opening || !!message}>
  <span role="status" aria-live="polite">{opening ? pending : message}</span>
  {#if message && last}<button type="button" onclick={() => last && enter(last)}>{en ? 'Retry' : 'Coba lagi'}</button>{/if}
</div>

<style>
  .demo-feedback {
    position: fixed;
    z-index: 90;
    inset: auto auto max(1rem, env(safe-area-inset-bottom)) 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 1rem;
    width: max-content;
    max-width: calc(100vw - 2rem);
    border-radius: 7px;
    background: var(--forest, #183e33);
    color: #fff6e7;
    font: 600 .875rem/1.4 var(--sans, sans-serif);
    box-shadow: 0 4px 18px #10271d33;
  }
  .demo-feedback.visible { padding: .7rem 1rem; }
  .demo-feedback:not(.visible) { pointer-events: none; }
  button {
    padding: .35rem 0;
    border: 0;
    border-bottom: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
</style>
