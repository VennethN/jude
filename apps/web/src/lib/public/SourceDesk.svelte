<script lang="ts">
  import { ArrowUpRight, ChevronDown, FileText, Speech } from '@lucide/svelte';
  import type { Lang } from '@jude/core/domain';
  import { onMount } from 'svelte';
  import { around, sources, type LandingRecord } from './landing/landing-record';
  import { deskQuote } from './landing/desk-quote';
  import { translate } from './landing/landing-text';

  let {
    lang,
    record,
    mode = 'lines',
  }: { lang: Lang; record: LandingRecord; mode?: 'lines' | 'sources' } = $props();
  const metadata = {
    testimony: 'lp.g.statementMeta',
    written: 'lp.g.bapMeta',
    gate: 'lp.g.logMeta',
  } as const;
  let selected = $state(0);
  let source = $derived(sources[selected]);
  let passage = $derived(around(record[source.key], source.mark[lang]));
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });

  function move(event: KeyboardEvent, index: number) {
    const last = sources.length - 1;
    switch (event.key) {
      case 'Home':
        selected = 0;
        break;
      case 'End':
        selected = last;
        break;
      case 'ArrowLeft':
        selected = (index + last) % sources.length;
        break;
      case 'ArrowRight':
        selected = (index + 1) % sources.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const group = (event.currentTarget as HTMLButtonElement).parentElement;
    group?.querySelectorAll('button')[selected]?.focus({ preventScroll: true });
  }
</script>

{#if mode === 'lines'}
  <ol class="show-lines">
    {#each sources as item, index (item.key)}
      {@const quote = deskQuote(item.key, record, lang)}
      <li style:--k={index}>
        <span class="sl-n" aria-hidden="true">{index + 1}</span>
        <span class="sl-meta">
          {#if item.key === 'testimony'}<Speech size={13} aria-hidden="true" />{:else}<FileText
              size={13}
              aria-hidden="true"
            />{/if}
          {translate(lang, metadata[item.key])}
        </span>
        <span class="sl-text" lang={lang} class:typed={item.key !== 'testimony'}
          >{quote[0]}<mark>{quote[1]}</mark>{quote[2]}</span
        >
      </li>
    {/each}
  </ol>
{:else}
  <div class="source-reader">
    <details class="desk-picker">
      <summary
        >{lang === 'id' ? 'Baca ketiga sumber' : 'Read the three sources'}
        <ChevronDown size={15} aria-hidden="true" /></summary
      >
      <div class="reader-body">
        {#if ready}
          <div class="desk-tabs" role="group" aria-label={lang === 'id' ? 'Pilih sumber' : 'Choose a source'}>
            {#each sources as item, index (item.key)}
              <button
                type="button"
                aria-pressed={selected === index}
                onclick={() => (selected = index)}
                onkeydown={(event) => move(event, index)}>{item.name[lang]}</button
              >
            {/each}
          </div>
        {:else}
          <nav class="direct-sources" aria-label={lang === 'id' ? 'Buka sumber' : 'Open a source'}>
            {#each sources as item (item.key)}<a href={item.href}>{item.name[lang]}</a>{/each}
          </nav>
        {/if}
        <div class="reading excerpt" aria-live="polite" aria-atomic="true">
          <p class="translation-note">{translate(lang, "lp.translatedSample")}</p>
          <blockquote lang={lang} class:testimony={source.key === 'testimony'}>
            {passage[0]}<mark>{passage[1]}</mark>{passage[2]}
          </blockquote>
          <a href={source.href}
            >{translate(lang, 'lp.original')}
            <ArrowUpRight size={15} aria-hidden="true" /></a
          >
        </div>
      </div>
    </details>
  </div>
{/if}

<style>
  .source-reader {
    position: relative;
    margin-inline: auto;
    width: min(90%, 1440px);
    height: 0;
  }
  .desk-picker {
    position: absolute;
    z-index: 3;
    inset: 3px 0 auto auto;
    width: min(100%, 35rem);
    margin: 0;
    color: var(--lp-ink);
  }
  .source-reader:has(.desk-picker[open]) {
    height: auto;
    padding-block: 3px 0;
  }
  .desk-picker[open] {
    position: static;
    margin-left: auto;
  }
  .desk-picker summary {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.4rem;
    width: fit-content;
    margin-left: auto;
    min-height: 44px;
    padding-inline: 4px;
    cursor: pointer;
    list-style: none;
    font: 600 0.82rem/1.4 var(--pub-body);
    color: var(--lp-ink);
  }
  .desk-picker summary::-webkit-details-marker {
    display: none;
  }
  .desk-picker[open] summary :global(svg) {
    rotate: 180deg;
  }
  .reader-body {
    border: 1px solid var(--lp-line);
    border-radius: 9px;
    padding: 6px 15px 4px;
    background: var(--lp-paper) url('/public/ivory-paper.webp') center/600px;
  }
  .desk-tabs,
  .direct-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.75rem;
    border-bottom: 1px solid var(--lp-line);
  }
  .desk-tabs button,
  .direct-sources a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 0.15rem;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    color: inherit;
    font: 600 0.85rem/1.3 var(--pub-body);
  }
  .desk-tabs button[aria-pressed='true'] {
    color: var(--lp-sage-ink);
    border-bottom-color: currentColor;
  }
  .desk-tabs button:hover,
  .excerpt a:hover,
  .desk-picker summary:hover {
    text-decoration: underline;
  }
  .excerpt {
    padding-top: 0.65rem;
  }
  .translation-note {
    margin: 0 0 0.65rem;
    color: var(--lp-muted);
    font: 500 0.8rem/1.4 var(--pub-body);
  }
  .excerpt blockquote {
    margin: 0;
    font: 400 0.96rem/1.48 var(--lp-doc);
    text-wrap: pretty;
  }
  .excerpt blockquote.testimony {
    font-family: var(--pub-body);
  }
  .excerpt mark {
    color: inherit;
    background: var(--lp-amber-wash);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .excerpt a {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    min-height: 44px;
    color: var(--pub-plum);
    font: 600 0.8rem/1.4 var(--pub-body);
  }
  .desk-picker :focus-visible {
    outline: 2px solid var(--lp-ink);
    outline-offset: 2px;
  }
</style>
