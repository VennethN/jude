<script lang="ts">
  import BrandLockup from '$lib/BrandLockup.svelte';
  import { onMount } from 'svelte';
  import { ArrowRight } from '@lucide/svelte';
  import type { Lang } from '@jude/core/domain';

  let { lang, onJump }: { lang: Lang; onJump?: (target: HTMLElement | 0) => void } = $props();
  const sections = [
    { id: 'lp-how', idLabel: 'Cara kerja', enLabel: 'How it works' },
    { id: 'lp-source', idLabel: 'Berbasis bukti', enLabel: 'Built on evidence' },
    { id: 'lp-approach', idLabel: 'Pendekatan kami', enLabel: 'Our approach' }
  ];
  let nav: HTMLElement;
  let shown = $state(false), current = $state('');
  const en = $derived(lang === 'en');

  onMount(() => {
    const story = nav.closest<HTMLElement>('.lp');
    if (!story) return;
    const cover = story.querySelector<HTMLElement>('.cover');
    const closing = story.querySelector<HTMLElement>('.closing');
    let coverEnd = 0, closingTop = Infinity, lastY = window.scrollY, movingUp = false, frame = 0;
    let starts: { id: string; top: number }[] = [];

    function read() {
      frame = 0;
      const y = window.scrollY;
      if (Math.abs(y - lastY) > 6) {
        movingUp = y < lastY;
        lastY = y;
      }
      shown = movingUp && y > coverEnd - 72 && y + window.innerHeight < closingTop + 120;
      current = starts.filter((section) => section.top <= y + 72).at(-1)?.id ?? '';
    }
    function request() {
      if (!frame) frame = window.requestAnimationFrame(read);
    }
    function measure() {
      const y = window.scrollY;
      coverEnd = cover ? y + cover.getBoundingClientRect().bottom : 0;
      closingTop = closing ? y + closing.getBoundingClientRect().top : Infinity;
      starts = sections.flatMap(({ id }) => {
        const node = document.getElementById(id);
        return node ? [{ id, top: y + node.getBoundingClientRect().top }] : [];
      }).sort((a, b) => a.top - b.top);
      request();
    }
    const resize = new ResizeObserver(measure);
    resize.observe(story);
    if (cover) resize.observe(cover);
    if (closing) resize.observe(closing);
    measure();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', measure);
    };
  });

  function jump(event: MouseEvent, id?: string) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = id ? document.getElementById(id) : 0;
    if (target === null) return;
    event.preventDefault();
    if (onJump) onJump(target);
    else {
      const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
      if (target) target.scrollIntoView({ behavior, block: 'start' });
      else window.scrollTo({ top: 0, behavior });
    }
    if (target) target.focus({ preventScroll: true });
    else {
      const heading = nav.closest('.lp')?.querySelector<HTMLElement>('.opening h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }
</script>

<nav class="localnav" class:shown bind:this={nav} aria-label={en ? 'Page navigation' : 'Navigasi halaman'} inert={!shown}>
  <a class="ln-mark" href="#public-main" aria-label={en ? 'Back to top' : 'Kembali ke atas'} onclick={(event) => jump(event)}><BrandLockup/></a>
  <div class="ln-links">
    {#each sections as section (section.id)}
      <a href={'#' + section.id} aria-current={current === section.id ? 'location' : undefined} onclick={(event) => jump(event, section.id)}>{en ? section.enLabel : section.idLabel}</a>
    {/each}
    <a href="/pricing">{en ? 'Pricing' : 'Harga'}</a>
  </div>
  <a class="ln-cta" href="/demo">{en ? 'Try the example case' : 'Coba perkara contoh'}<ArrowRight size={17} strokeWidth={1.5}/></a>
</nav>

<style>
  .localnav {
    position: fixed;
    z-index: 45;
    top: calc(12px + env(safe-area-inset-top, 0px));
    left: 50%;
    display: flex;
    align-items: center;
    gap: 4px;
    width: min(1060px, calc(100% - 28px));
    height: 56px;
    padding: 0 7px 0 22px;
    border-radius: 999px;
    background: #f7f1e6 url('/public/ivory-paper.webp') center / 600px 600px;
    box-shadow: 0 14px 36px -14px rgb(10 30 20 / .36), 0 2px 8px -2px rgb(10 30 20 / .1),
      inset 0 0 0 1px rgb(20 40 31 / .08), inset 0 1px 0 rgb(255 255 255 / .55);
    color: var(--lp-ink);
    opacity: 0;
    transform: translate(-50%, calc(-100% - 28px));
    transition: transform .55s var(--lp-ease), opacity .3s ease;
  }
  .localnav.shown { transform: translate(-50%, 0); opacity: 1; }
  .localnav a { text-decoration: none; }
  .ln-mark {
    margin-right: auto;
    font: 400 28px/1 Rufina, Georgia, serif;
    letter-spacing: -.02em;
    color: var(--lp-forest);
  }
  .ln-links { display: flex; gap: 2px; margin-right: 10px; }
  .ln-links a {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    color: var(--lp-ink);
    font-size: 14.5px;
    transition: background-color .2s;
  }
  .ln-links a:hover { background: rgb(20 40 31 / .07); }
  .ln-cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 0 18px 0 22px;
    border-radius: 999px;
    background: var(--lp-forest);
    color: var(--lp-cream);
    font: 400 18px/1 var(--display);
    white-space: nowrap;
    transition: background-color .2s, transform .15s var(--lp-ease);
  }
  .ln-cta:hover { background: #0f2c20; }
  .ln-cta:active { transform: scale(.97); }
  .ln-cta :global(svg) { transition: transform .2s var(--lp-ease); }
  .ln-cta:hover :global(svg) { transform: translateX(3px); }
  .localnav :focus-visible { outline-offset: 3px; }
  @media (max-width: 980px) { .ln-links a:nth-child(3) { display: none; } }
  @media (max-width: 760px) {
    .localnav { top: calc(8px + env(safe-area-inset-top, 0px)); width: calc(100% - 16px); height: 52px; padding: 0 6px 0 18px; }
    .ln-links { display: none; }
    .ln-mark { font-size: 26px; }
    .ln-cta { min-height: 40px; padding: 0 14px 0 18px; gap: 8px; font-size: 17px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .localnav, .ln-cta, .ln-links a, .ln-cta :global(svg) { transition: none; }
  }
</style>
