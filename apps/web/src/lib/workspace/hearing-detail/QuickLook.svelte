<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowUpRight, BookOpenText, ChevronLeft, ChevronRight, ClipboardCopy, X } from '@lucide/svelte';
  import type { Finding, Lang, Reply, Workspace } from '@jude/core/domain';
  import Match from '$lib/evidence/Match.svelte';
  import SourceAvailability from '$lib/evidence/SourceAvailability.svelte';
  import { casePath, local, sourceOf, statuses } from '$lib/evidence/records';
  import { timecode } from '../format';
  import { voice } from './people';
  let {
    workspace: w,
    lang,
    finding,
    reply,
    findings,
    select,
    close
  }: {
    workspace: Workspace;
    lang: Lang;
    finding?: Finding;
    reply?: Reply;
    findings: Finding[];
    select: (id: string) => void;
    close: () => void;
  } = $props();
  let en = $derived(lang === 'en'),
    subject = $derived(finding ?? reply),
    statement = $derived(w.statements.find((s) => s.id === subject?.statementId)),
    first = $derived(finding?.sources[0]),
    source = $derived(first ? sourceOf(w, { kind: 'passage', id: first.passageId }, lang) : undefined);
  let previous = $derived(finding ? findings.findIndex((f) => f.id === finding?.id) : -1);
  let wide = $state(false),
    dialog = $state<HTMLDialogElement>(),
    heading = $state<HTMLHeadingElement>(),
    status = $state('');
  onMount(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = window.matchMedia('(min-width: 1250px)');
    const update = () => (wide = media.matches);
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      before?.focus({ preventScroll: true });
    };
  });
  $effect(() => {
    if (dialog && !wide && !dialog.open) dialog.showModal();
  });
  $effect(() => {
    if (subject) {
      status = '';
      void tick().then(() => heading?.focus({ preventScroll: true }));
    }
  });
  function step(delta: number) {
    const next = findings[previous + delta];
    if (finding && next) select(next.id);
  }
  function keys(e: KeyboardEvent) {
    if (
      e.metaKey ||
      e.altKey ||
      e.ctrlKey ||
      /input|textarea|select/i.test((e.target as HTMLElement)?.tagName)
    )
      return;
    if (e.key === 'Escape' && wide) {
      e.preventDefault();
      close();
    } else if (finding && ['j', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      step(e.key.toLowerCase() === 'j' ? 1 : -1);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      status = en ? 'Copied.' : 'Disalin.';
    } catch {
      status = en ? 'Select and copy the text manually.' : 'Pilih dan salin teks secara manual.';
    }
  }
</script>

<svelte:window onkeydown={keys} />
{#snippet content()}
  <div class="look-head">
    <span class="folio"><BookOpenText size={16} />{en ? 'Quick look' : 'Lihat sekilas'}</span>
    <div>
      {#if finding && findings.length > 1}<button
          class="icon-button"
          aria-label={en ? 'Previous finding' : 'Temuan sebelumnya'}
          disabled={previous <= 0}
          onclick={() => step(-1)}><ChevronLeft size={16} /></button
        ><button
          class="icon-button"
          aria-label={en ? 'Next finding' : 'Temuan berikutnya'}
          disabled={previous >= findings.length - 1}
          onclick={() => step(1)}><ChevronRight size={16} /></button
        >{/if}<button
        class="icon-button"
        aria-label={en ? 'Close quick look' : 'Tutup tampilan sekilas'}
        onclick={close}><X size={17} /></button
      >
    </div>
  </div>
  {#if finding}
    <p class="folio note">{statuses[finding.status][lang]}{statement ? ' · ' + timecode(statement.t) : ''}</p>
    <h2 id="brief-title" tabindex="-1" bind:this={heading}>{local(finding.title, lang)}</h2>
    <section class="question">
      <h3>{en ? 'You could ask' : 'Bisa ditanyakan'}</h3>
      <p>{finding.question}</p>
      <button class="text-action" onclick={() => copy(finding.question)}
        ><ClipboardCopy size={14} />{en ? 'Copy question' : 'Salin pertanyaan'}</button
      >
    </section>
    {#if statement}<section class="comparison">
        <h3>{en ? 'In court' : 'Di sidang'} · {voice(w.speakers, statement.speakerId, lang).name}</h3>
        <p>“<Match text={statement.text} term={finding.said} />”</p>
      </section>{/if}
    {#if source}<section class="comparison record">
        <h3><a href={source.href}>{source.label} <ArrowUpRight size={12} /></a></h3>
        <p>“<Match text={first?.match || source.text} />”</p>
      </section>{/if}
    <SourceAvailability {finding} {lang} /><a
      class="button"
      href={casePath(w) + '/findings/' + encodeURIComponent(finding.id)}
      >{en ? 'Details in Findings' : 'Detail di Temuan'}<ArrowUpRight size={15} /></a
    >
  {:else if reply}
    <p class="folio note">
      {en ? 'For counsel' : 'Untuk kuasa hukum'}{statement ? ' · ' + timecode(statement.t) : ''}
    </p>
    <h2 id="brief-title" tabindex="-1" bind:this={heading}>{en ? 'Your response' : 'Tanggapan Anda'}</h2>
    {#if statement}<blockquote class="trigger">“{statement.text}”</blockquote>{/if}
    <ol class="suggestions">
      {#each [...reply.suggestions].sort((a, b) => b.confidence - a.confidence) as option}
        {@const basis = option.basis.kind === 'procedure' ? undefined : sourceOf(w, option.basis, lang)}
        <li>
          <p>{option.text}</p>
          <small>{local(option.why, lang)}</small>
          <div>
            {#if basis}<a href={basis.href}>{basis.label}<ArrowUpRight size={12} /></a>{:else}<span
                >{en ? 'Court procedure' : 'Tata cara persidangan'}</span
              >{/if}<span>{Math.round(option.confidence * 100)}% · {en ? 'fit' : 'kecocokan'}</span>
          </div>
          <button class="text-action" onclick={() => copy(option.text)}
            ><ClipboardCopy size={14} />{en ? 'Copy response' : 'Salin tanggapan'}</button
          >
        </li>
      {/each}
    </ol>
  {/if}
  {#if status}<p class="small muted" role="status">{status}</p>{/if}
{/snippet}
{#if wide}<aside class="quick" aria-label={en ? 'Quick look' : 'Lihat sekilas'}>{@render content()}</aside>
{:else}<dialog
    class="quick"
    bind:this={dialog}
    aria-labelledby="brief-title"
    oncancel={(e) => {
      e.preventDefault();
      close();
    }}
  >
    {@render content()}
  </dialog>{/if}

<style>
  .quick {
    align-self: start;
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--ink);
    padding: 1.2rem;
    border-radius: 0.5rem;
  }
  aside.quick {
    position: sticky;
    top: 1rem;
  }
  dialog.quick {
    position: fixed;
    inset: 0 0 0 auto;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    width: min(29rem, 100%);
    max-width: 100%;
    border: 0;
    border-inline-start: 1px solid var(--line);
    border-radius: 0;
    overflow: auto;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--ink) 35%, transparent);
  }
  .look-head,
  .look-head > div,
  .folio,
  .text-action,
  .suggestions li > div {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .look-head {
    justify-content: space-between;
    padding-bottom: 0.65rem;
    border-bottom: 1px solid var(--line);
  }
  .look-head button {
    width: 36px;
    min-height: 36px;
  }
  .folio,
  h3,
  .suggestions small,
  .suggestions li > div {
    font: 600 0.75rem/1.45 var(--sans);
    color: var(--muted);
  }
  .note {
    color: var(--accent);
    margin: 1rem 0 0.35rem;
  }
  .quick h2 {
    font: 400 2rem/1.07 var(--display);
    margin: 0 0 0.9rem;
  }
  .question {
    background: var(--wash);
    padding: 0.8rem;
    border-radius: 0.35rem;
  }
  .question p {
    font: 400 1.25rem/1.3 var(--display);
    margin: 0.35rem 0;
  }
  .text-action {
    padding: 0.35rem 0;
    min-height: 36px;
    color: var(--ink);
    background: none;
    border: 0;
    font: 650 0.75rem var(--sans);
    cursor: pointer;
  }
  .comparison {
    padding: 0.95rem 0;
    border-bottom: 1px solid var(--line);
  }
  .comparison p {
    margin: 0.4rem 0 0;
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .record p {
    font-family: var(--mono);
    color: var(--accent);
  }
  .quick .button {
    margin-top: 1rem;
  }
  .trigger {
    margin: 0.75rem 0;
    padding: 0.75rem 0;
    border-block: 1px solid var(--line);
    line-height: 1.5;
  }
  .suggestions {
    padding-left: 1.3rem;
  }
  .suggestions li {
    padding: 0.75rem 0;
    border-top: 1px solid var(--line);
  }
  .suggestions p {
    margin: 0 0 0.35rem;
    line-height: 1.5;
  }
  .suggestions li > div {
    flex-wrap: wrap;
    justify-content: space-between;
    margin-top: 0.4rem;
  }
</style>
