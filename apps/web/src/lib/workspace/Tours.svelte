<script lang="ts">
  import { beforeNavigate, goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { ArrowRight, Check, X } from '@lucide/svelte';
  import type { CaseSummary, Lang, SessionInfo, Workspace } from '@jude/core/domain';
  import { api } from '$lib/client';
  import Dialog from './Dialog.svelte';
  import { makeGuides, type Guide } from './tours/guide';
  import { firstVisible, litArea, placeCard, reveal, type Box, type Placement } from './tours/spotlight';

  let {
    session,
    workspace,
    cases = [],
    lang,
    close,
    startOverview = false,
  }: {
    session: SessionInfo;
    workspace?: Workspace;
    cases?: CaseSummary[];
    lang: Lang;
    close: () => void;
    startOverview?: boolean;
  } = $props();
  const en = $derived(lang === 'en'),
    language = $derived(en ? 1 : 0);
  const guides = $derived(makeGuides(workspace, cases));
  const savedKey = $derived('jude:guide:' + session.user.id + ':' + (workspace?.caseRecord.id ?? 'register'));
  let active = $state.raw<Guide | undefined>(),
    index = $state(0);
  const current = $derived(active?.steps[index]);
  let saved = $state<{ guide: string; step: string } | null>(null);
  let origin = $state<HTMLSpanElement>(),
    stage = $state<HTMLDivElement>(),
    card = $state<HTMLElement>(),
    primary = $state<HTMLButtonElement>();
  let target: HTMLElement | undefined,
    observer: ResizeObserver | undefined,
    marker: Comment | undefined,
    ticket = 0,
    frame = 0;
  let hole = $state.raw<Box | null>(null),
    position = $state.raw<Placement | null>(null);
  let pointer = $state.raw<{ x: number; y: number } | null>(null);
  let shownStep = $state('');
  let transition = $state(false),
    missing = $state(false),
    feedback = $state('');
  let completing = $state(false);
  const clay = ['speech', 'page', 'finding'];
  const imagePath = (name: string) => '/public/clay/' + name + '.webp';
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  function stash(resume: typeof saved) {
    saved = resume;
    try {
      if (resume) sessionStorage.setItem(savedKey, JSON.stringify(resume));
      else sessionStorage.removeItem(savedKey);
    } catch {
      /* The tour works with session storage disabled. */
    }
  }
  function cleanStage() {
    ticket++;
    cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    if (stage?.matches(':popover-open')) stage.hidePopover();
    stage?.remove();
    marker?.remove();
    marker = undefined;
    target = undefined;
  }
  function exit() {
    cleanStage();
    close();
  }
  function update() {
    if (!card || !stage || !active) return;
    const rect = card.getBoundingClientRect(),
      next = target?.isConnected ? litArea(target, rect.height) : null;
    position = placeCard(next, rect.width, rect.height);
    // On a short screen, a tall map or transcript can occupy both sides of the card.
    // Illuminate the portion that is readable beyond it.
    if (next && position.side === 'top') {
      const top = Math.max(next.y, position.y + rect.height + 9);
      hole = { ...next, y: top, h: Math.max(0, next.h - (top - next.y)) };
    } else if (next && position.side === 'bottom') {
      hole = { ...next, h: Math.max(0, Math.min(next.h, position.y - next.y - 9)) };
    } else hole = next;
    const { side, x, y, caret } = position;
    pointer =
      next && side !== 'center'
        ? {
            x: (side === 'left' ? x + rect.width : side === 'right' ? x : x + caret) - 6,
            y: (side === 'top' ? y + rect.height : side === 'bottom' ? y : y + caret) - 6,
          }
        : null;
  }
  function queueUpdate() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
  }
  function portal() {
    if (!stage || !origin?.parentElement) return;
    if (!marker) {
      marker = document.createComment('tour portal');
      stage.before(marker);
    }
    const modal = target?.closest('dialog[open]');
    const host = modal ?? marker.parentElement;
    if (stage.parentElement !== host) {
      if (stage.matches(':popover-open')) stage.hidePopover();
      if (modal) modal.appendChild(stage);
      else marker.after(stage);
    }
    if (!stage.matches(':popover-open')) stage.showPopover();
  }
  async function go(guide: Guide, n: number) {
    if (completing || !guide.steps[n]) return;
    const serial = ++ticket,
      next = guide.steps[n],
      crossing = page.url.pathname + page.url.search !== next.href;
    feedback = '';
    missing = false;
    shownStep = '';
    transition = crossing;
    active = guide;
    index = n;
    target = undefined;
    if (crossing) hole = null;
    stash({ guide: guide.id, step: next.id });
    try {
      if (crossing) await goto(next.href, { keepFocus: true, noScroll: true });
      await tick();
      if (serial !== ticket) return;
      // A mobile finding can mount inside its native sheet after the page itself has rendered.
      const deadline = performance.now() + 1500;
      let element = firstVisible(next.target);
      while (!element && performance.now() < deadline && serial === ticket) {
        await nextFrame();
        element = firstVisible(next.target);
      }
      if (serial !== ticket || !stage || !card) return;
      target = element;
      portal();
      if (target) reveal(target);
      await nextFrame();
      if (serial !== ticket) return;
      missing = !target;
      update();
      transition = false;
      shownStep = next.id;
      observer?.disconnect();
      observer = new ResizeObserver(queueUpdate);
      observer.observe(card);
      if (target) observer.observe(target);
      primary?.focus({ preventScroll: true });
    } catch {
      if (serial !== ticket) return;
      target = undefined;
      missing = true;
      portal();
      update();
      transition = false;
      shownStep = next.id;
      feedback = en
        ? 'This area could not be opened. Try the step again.'
        : 'Bagian ini belum dapat dibuka. Coba langkah ini lagi.';
    }
  }
  async function next() {
    if (!active || completing) return;
    if (index < active.steps.length - 1) {
      await go(active, index + 1);
      return;
    }
    completing = true;
    try {
      await api('/api/me/prefs', 'PATCH', {
        tourSeen: true,
        toursDone: [...new Set([...(session.prefs.toursDone ?? []), active.id])],
      });
      stash(null);
      cleanStage();
      active = undefined;
      position = null;
      hole = null;
      feedback = '';
      await invalidate('jude:session');
    } catch {
      feedback = en ? 'Progress could not be saved. Try again.' : 'Progres belum tersimpan. Coba lagi.';
    } finally {
      completing = false;
    }
  }
  function keys(e: KeyboardEvent) {
    if (!active || e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      exit();
      return;
    }
    if (
      e.altKey ||
      e.shiftKey ||
      e.ctrlKey ||
      e.metaKey ||
      (e.target as Element | null)?.closest('input,textarea,select,[contenteditable],[role=slider]')
    )
      return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'ArrowRight') void next();
      else if (index) void go(active, index - 1);
    }
  }
  function outside(e: MouseEvent) {
    if (!active || transition || !stage?.matches(':popover-open') || !(e.target instanceof Node)) return;
    if (card?.contains(e.target) || target?.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    exit();
  }
  beforeNavigate(({ to }) => {
    if (active && current && to?.url && to.url.pathname + to.url.search !== current.href) exit();
  });
  onMount(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      const item = JSON.parse(sessionStorage.getItem(savedKey) ?? 'null');
      if (item && guides.some((g) => g.id === item.guide && g.steps.some((s) => s.id === item.step)))
        saved = item;
    } catch {
      /* Ignore stale saved progress. */
    }
    window.addEventListener('keydown', keys, true);
    window.addEventListener('click', outside, true);
    window.addEventListener('scroll', queueUpdate, true);
    window.addEventListener('resize', queueUpdate);
    window.visualViewport?.addEventListener('resize', queueUpdate);
    if (startOverview && guides[0]) void go(guides[0], 0);
    return () => {
      cleanStage();
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('click', outside, true);
      window.removeEventListener('scroll', queueUpdate, true);
      window.removeEventListener('resize', queueUpdate);
      window.visualViewport?.removeEventListener('resize', queueUpdate);
      const opener =
        before?.isConnected && before !== document.body ? before : firstVisible('.desk .menu-tool');
      opener?.focus({ preventScroll: true });
    };
  });
</script>

<span bind:this={origin} hidden></span>
{#if !active || !current}
  <Dialog title={en ? 'Guided tours' : 'Panduan perkara'} {lang} {close}>
    <div class="tour-list">
      {#each guides as guide (guide.id)}
        {@const resume = saved?.guide === guide.id ? guide.steps.findIndex((s) => s.id === saved?.step) : -1}
        <button class="guide" onclick={() => go(guide, Math.max(0, resume))}>
          <img src={imagePath(guide.image)} alt="" width="42" height="42" />
          <span
            ><b>{guide.name[language]}</b><small>{guide.description[language]}</small>
            {#if resume >= 0}<em
                >{en ? 'Resume at step' : 'Lanjut dari langkah'} {resume + 1}/{guide.steps.length}</em
              >{/if}
          </span>
          {#if session.prefs.toursDone?.includes(guide.id)}<Check
              size={17}
              aria-label={en ? 'Completed' : 'Selesai'}
            />{:else}<ArrowRight size={16} aria-hidden="true" />{/if}
        </button>
      {/each}
    </div>
  </Dialog>
{:else}
  <div class="tour-stage" popover="manual" bind:this={stage} data-moving={transition}>
    {#if hole}<div
        class="spot"
        aria-hidden="true"
        style:left={hole.x + 'px'}
        style:top={hole.y + 'px'}
        style:width={hole.w + 'px'}
        style:height={hole.h + 'px'}
      ></div>
    {:else}<div class="shade" aria-hidden="true"></div>{/if}
    {#if pointer && hole}<i
        class="pointer"
        aria-hidden="true"
        style:left={pointer.x + 'px'}
        style:top={pointer.y + 'px'}
      ></i>{/if}
    <div
      class="tour-strip"
      class:intro={active.id === 'overview' && index === 0}
      role="dialog"
      aria-modal="false"
      aria-labelledby="guide-heading"
      aria-describedby="guide-body"
      bind:this={card}
      data-guide={active.id}
      data-step={current.id}
      data-ready={shownStep === current.id}
      data-target={current.target}
      data-side={position?.side}
      style:left={(position?.x ?? 12) + 'px'}
      style:top={(position?.y ?? 12) + 'px'}
      style:--caret={(position?.caret ?? 24) + 'px'}
      style:visibility={position ? 'visible' : 'hidden'}
    >
      {#if active.id === 'overview' && index === 0}<div class="clay" aria-hidden="true">
          {#each clay as piece}<img src={imagePath(piece)} alt="" />{/each}
        </div>{/if}
      <div class="guide-head">
        <div>
          <small>{active.name[language]} · {index + 1}/{active.steps.length}</small>
          <h2 id="guide-heading">{current.title[language]}</h2>
        </div>
        <button class="close" onclick={exit} aria-label={en ? 'Pause tour' : 'Jeda tur'}
          ><X size={17} /></button
        >
      </div>
      <p id="guide-body">{current.body[language]}</p>
      {#if feedback || missing}<p class="feedback" role="status">
          {feedback ||
            (en
              ? 'This item is currently unavailable in this case.'
              : 'Butir ini belum tersedia dalam perkara ini.')}
          <button onclick={() => active && go(active, index)}>{en ? 'Show again' : 'Tampilkan lagi'}</button>
        </p>{/if}
      <footer>
        <div class="dots" aria-hidden="true">
          {#each active.steps as item, i (item.id)}<i class:on={i === index} class:past={i < index}
            ></i>{/each}
        </div>
        <div class="choices">
          {#if index}<button class="previous" onclick={() => active && go(active, index - 1)}
              >{en ? 'Back' : 'Kembali'}</button
            >
          {:else}<button class="skip" onclick={exit}>{en ? 'Skip' : 'Lewati'}</button>{/if}
          <button class="next" bind:this={primary} disabled={completing} onclick={next}
            >{index + 1 === active.steps.length
              ? en
                ? 'Finish'
                : 'Selesai'
              : en
                ? 'Next'
                : 'Lanjut'}<ArrowRight size={14} /></button
          >
        </div>
      </footer>
      <span class="sr-only" aria-live="polite"
        >{active.name[language]} · {index + 1}/{active.steps.length}. {current.title[language]}</span
      >
    </div>
  </div>
{/if}

<style>
  .tour-list {
    display: grid;
  }
  .guide {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 66px;
    padding: 9px 2px;
    text-align: left;
    color: var(--ink);
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
  }
  .guide:last-child {
    border-bottom: 0;
  }
  .guide:hover {
    background: var(--surface-2);
  }
  .guide img {
    object-fit: contain;
  }
  .guide > span {
    flex: 1;
    display: grid;
    gap: 2px;
  }
  .guide b {
    font: 600 14px/1.45 var(--sans);
  }
  .guide small,
  .guide em {
    color: var(--muted);
    font: 400 12px/1.4 var(--sans);
  }
  .guide em {
    color: var(--primary);
  }
  .tour-stage {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: visible;
    pointer-events: none;
  }
  .tour-stage::backdrop {
    background: transparent;
    pointer-events: none;
  }
  .spot,
  .shade {
    position: fixed;
    pointer-events: none;
  }
  .shade {
    inset: 0;
    background: rgb(15 29 22/0.55);
  }
  .spot {
    border: 1.5px solid color-mix(in srgb, var(--surface) 80%, var(--focus));
    border-radius: 12px;
    box-shadow: 0 0 0 250vmax rgb(15 29 22/0.55);
  }
  .pointer {
    position: fixed;
    width: 12px;
    height: 12px;
    rotate: 45deg;
    background: var(--surface);
    border: 1px solid var(--hairline);
    pointer-events: none;
  }
  .tour-strip {
    position: fixed;
    display: grid;
    gap: 10px;
    width: min(344px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    overflow: auto;
    padding: 17px 18px 15px 20px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 14px;
    box-shadow: var(--shadow-overlay);
    pointer-events: auto;
    font-family: var(--sans);
  }
  .tour-strip.intro {
    width: min(398px, calc(100vw - 24px));
  }
  .clay {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 56px;
    margin: -5px 0 1px;
  }
  .clay img {
    width: 58px;
    height: 58px;
    object-fit: contain;
  }
  .clay img + img {
    margin-left: -6px;
  }
  .guide-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .guide-head small {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font: 600 11px/1.4 var(--sans);
  }
  .guide-head h2 {
    margin: 0;
    color: var(--ink-strong);
    font: 400 24px/1.12 var(--display);
    letter-spacing: -0.012em;
    text-wrap: balance;
  }
  .intro h2 {
    font-size: 27px;
  }
  .close,
  .skip,
  .previous,
  .next,
  .feedback button {
    font: 600 13px/1.4 var(--sans);
    color: var(--ink-strong);
    border-radius: 6px;
  }
  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    background: transparent;
    margin: -4px -5px 0 0;
  }
  .close:hover,
  .skip:hover,
  .previous:hover {
    background: var(--sunken);
  }
  .tour-strip p {
    margin: 0;
    font: 400 14px/1.55 var(--sans);
  }
  .tour-strip footer,
  .choices,
  .dots,
  .next {
    display: flex;
    align-items: center;
  }
  .tour-strip footer {
    justify-content: space-between;
    gap: 8px;
    margin-top: 3px;
  }
  .choices {
    gap: 6px;
  }
  .dots {
    gap: 4px;
    flex-wrap: wrap;
  }
  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 6px;
    background: var(--line-strong);
  }
  .dots i.past {
    background: var(--selected-line);
  }
  .dots i.on {
    width: 17px;
    background: var(--primary);
  }
  .next,
  .previous,
  .skip {
    min-height: 36px;
    padding: 5px 12px;
    gap: 6px;
  }
  .skip {
    border: 0;
    background: transparent;
  }
  .previous {
    border: 1px solid var(--line-strong);
    background: var(--surface);
  }
  .next {
    border: 1px solid var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .next:hover {
    background: var(--primary-hover);
  }
  .tour-strip .feedback {
    color: var(--muted);
    font-size: 12px;
  }
  .feedback button {
    padding: 0;
    border: 0;
    background: transparent;
    text-decoration: underline;
  }
  @media (min-width: 720px) {
    .tour-strip:has(.clay) {
      gap: 8px;
    }
  }
  @media (max-width: 719px) {
    .pointer {
      display: none;
    }
    .tour-strip,
    .tour-strip.intro {
      width: calc(100vw - 24px);
    }
    .close,
    .next,
    .previous,
    .skip {
      min-height: 44px;
    }
    .close {
      width: 44px;
    }
    .tour-strip {
      padding: 15px 16px;
    }
    .clay {
      height: 44px;
    }
    .clay img {
      width: 50px;
      height: 50px;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .spot {
      transition:
        left 0.32s cubic-bezier(0.2, 0.65, 0.3, 1),
        top 0.32s cubic-bezier(0.2, 0.65, 0.3, 1),
        width 0.32s cubic-bezier(0.2, 0.65, 0.3, 1),
        height 0.32s cubic-bezier(0.2, 0.65, 0.3, 1);
    }
    .tour-strip {
      transition:
        opacity 0.17s ease,
        left 0.25s ease,
        top 0.25s ease;
    }
    .tour-stage[data-moving='true'] :is(.tour-strip, .pointer) {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tour-stage :is(.spot, .pointer, .tour-strip) {
      transition: none !important;
      animation: none !important;
    }
  }
  @media (max-height: 560px) {
    .tour-strip {
      max-height: max(142px, 49dvh);
    }
    .tour-strip .clay {
      display: none;
    }
    .tour-strip footer {
      position: sticky;
      bottom: 0;
      background: var(--surface);
    }
  }
  @media (forced-colors: active) {
    .spot {
      border: 3px solid Highlight;
    }
    .tour-strip {
      border: 2px solid CanvasText;
    }
  }
</style>
