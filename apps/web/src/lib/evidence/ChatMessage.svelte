<script lang="ts">
  import { AudioLines, BookOpenText, ChevronRight, FileText, Headphones, ListChecks } from '@lucide/svelte';
  import type { ChatMessage, Citation, InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import ContextChip from './ContextChip.svelte';
  import { local, sourceOf } from './records';

  let {
    workspace: w,
    lang,
    message: m,
    inspect,
  }: {
    workspace: Workspace;
    lang: Lang;
    message: ChatMessage;
    inspect: (target: InspectTarget) => void;
  } = $props();

  const id = $derived(lang === 'id');
  const text = $derived(local(m.text, lang));
  const icons = {
    passage: BookOpenText,
    statement: AudioLines,
    hearing: Headphones,
    document: FileText,
    finding: ListChecks,
  };
  const cited = $derived(
    (m.citations ?? []).map((ref) => {
      const source = ref.unavailable ? undefined : sourceOf(w, ref, lang);
      const finding = ref.kind === 'finding' && source ? w.findings.find((f) => f.id === ref.id) : undefined;
      const quote = finding ? local(finding.explanation, lang) : (source?.text ?? ref.snapshot ?? '');
      const target: InspectTarget | undefined =
        ref.kind === 'statement' || ref.kind === 'passage' ? { kind: ref.kind, id: ref.id } : undefined;
      return { ref, source, quote, target };
    }),
  );
  // A saved answer can outlive its sources or have been written in a different language.
  const bodyContainsAllQuotes = $derived(
    m.mode === 'sources-only' &&
      cited.length > 0 &&
      cited.every((c) => c.source && c.quote) &&
      text === cited.map((c, i) => '“' + c.quote + '” [' + (i + 1) + ']').join('\n\n'),
  );
  const answer = $derived(
    text ||
      cited
        .map(({ ref, source }, i) => (source?.label ?? missingLabel(ref)) + ' [' + (i + 1) + ']')
        .join('\n'),
  );
  const segments = $derived.by(() => {
    // Bracketed numbers inside an original quotation are part of the evidence.
    const pieces = bodyContainsAllQuotes
      ? cited.flatMap((c, i) => [(i ? '\n\n' : '') + '“' + c.quote + '” ', '[' + (i + 1) + ']'])
      : answer.split(/(“[^”]*”|"[^"\n]*"|\[\d+\])/);
    return pieces.map((value) => {
      const marker = /^\[(\d+)\]$/.exec(value);
      const number = marker ? Number(marker[1]) : 0;
      return { value, number, entry: number > 0 ? cited[number - 1] : undefined };
    });
  });
  const laws = $derived((m.legal ?? []).flatMap((lawId) => w.legal.filter((law) => law.id === lawId)));
  function missingLabel(ref: Citation) {
    if (ref.unavailable) return id ? 'Sumber dihapus' : 'Source removed';
    return id ? 'Sumber tidak tersedia' : 'Source unavailable';
  }
</script>

{#if m.role === 'user'}
  <article class="message question">
    <header>{id ? 'Anda' : 'You'}</header>
    {#if m.contexts?.length}
      <div class="asked" data-tour="asked">
        <span>{id ? 'Konteks' : 'Asked with'}</span>
        {#each m.contexts as ref, i (i)}
          <ContextChip workspace={w} {ref} {lang} link />
          {#if 'unavailable' in ref && ref.unavailable && ref.snapshot}<span class="saved-context"
              >{ref.snapshot}</span
            >{/if}
        {/each}
      </div>
    {/if}
    <p class="answer">{text}</p>
  </article>
{:else}
  <article class="message response" data-tour="assistant-answer">
    <header>
      {id ? 'Asisten perkara' : 'Case assistant'}
      {#if m.mode === 'sources-only'}
        <span class="mode">{id ? 'Pencarian sumber saja' : 'Sources only'}</span>
      {:else if w.caseRecord.label === 'synthetic'}
        <span class="mode">{id ? 'Perkara sintetis' : 'Synthetic case'}</span>
      {/if}
    </header>
    {#if m.mode === 'sources-only'}
      <p class="ev-meta">{id ? 'Kutipan berikut mempertahankan bahasa dan redaksi sumber.' : 'The quotations below retain the source language and exact wording.'}</p>
    {:else if typeof m.text === 'string'}
      <p class="ev-meta">{id ? 'Jawaban tersimpan · bahasa asli' : 'Saved answer · original language'}</p>
    {/if}
    {#if answer}
      <p class="answer">
        {#each segments as { value, number, entry }}{#if entry?.source}{@const label =
              (id ? 'Sumber ' : 'Source ') + number + ' · ' + entry.source.label}{@const target =
              entry.target}{#if target}<button
                class="citation"
                title={entry.source.label}
                aria-label={label}
                onclick={() => inspect(target)}>{number}</button
              >{:else}<a
                class="citation"
                href={entry.source.href}
                title={entry.source.label}
                aria-label={label}>{number}</a
              >{/if}{:else if entry}<span class="missing-marker" title={missingLabel(entry.ref)}>{value}</span
            >{:else}{value}{/if}{/each}
      </p>
    {:else}
      <p class="answer">
        {id ? 'Tidak ada sumber yang cocok dengan pertanyaan ini.' : 'No case sources matched this question.'}
      </p>
    {/if}

    {#if cited.length}
      <details data-tour="assistant-citations">
        <summary
          ><ChevronRight size={14} aria-hidden="true" />{id ? 'Sumber yang dikutip' : 'Cited sources'} · {cited.length}</summary
        >
        <ol>
          {#each cited as { ref, source, quote, target }, i (i)}
            {@const Icon = icons[ref.kind]}
            <li>
              {#snippet card()}
                <span class="num">{i + 1}</span>
                <span class="source-body">
                  <span class="source-title">
                    <Icon size={14} aria-hidden="true" />
                    {source?.label ?? missingLabel(ref)}
                  </span>
                  {#if quote && !bodyContainsAllQuotes}
                    <span class="source-quote" class:document-text={ref.kind === 'passage'}>
                      {ref.kind === 'passage' || ref.kind === 'statement' ? '“' + quote + '”' : quote}
                    </span>
                  {/if}
                </span>
              {/snippet}
              {#if source && target}
                <button class="source-card" onclick={() => inspect(target)}>{@render card()}</button>
              {:else if source}
                <a class="source-card" href={source.href}>{@render card()}</a>
              {:else}
                <div class="source-card removed-citation">{@render card()}</div>
              {/if}
            </li>
          {/each}
        </ol>
      </details>
    {/if}
    {#if laws.length}
      <details class="legal">
        <summary
          ><ChevronRight size={14} aria-hidden="true" />{id ? 'Rujukan hukum' : 'Legal references'} · {laws.length}</summary
        >
        <ul>
          {#each laws as law, i (i)}
            <li>
              <button class="source-card" onclick={() => inspect({ kind: 'legal', id: law.id })}>
                <span class="num"><BookOpenText size={13} aria-hidden="true" /></span>
                <span class="source-body">
                  <span class="source-title">{[law.article, law.regulation].filter(Boolean).join(' · ')}</span
                  >
                  <span class="source-quote document-text">{local(law.summary, lang)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </article>
{/if}

<style>
  .message {
    display: grid;
    gap: 8px;
    min-width: 0;
    color: var(--ink-strong);
  }
  .question {
    align-self: end;
    justify-self: end;
    width: fit-content;
    max-width: min(88%, 620px);
    margin-inline-start: auto;
    padding: 10px 14px 11px;
    background: var(--selected);
    border-radius: 16px 16px 6px 16px;
  }
  .response {
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  header,
  .asked,
  .source-title,
  summary {
    display: flex;
    align-items: center;
  }
  header,
  .asked,
  summary {
    color: var(--muted);
    font: 600 12px/1.45 var(--sans);
  }
  header {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .mode {
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .asked {
    flex-wrap: wrap;
    gap: 4px 6px;
    font-weight: 500;
  }
  .question header,
  .asked > span {
    color: color-mix(in srgb, var(--muted) 70%, var(--ink-strong));
  }
  .saved-context {
    overflow-wrap: anywhere;
    font-weight: 400;
  }
  .answer {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 400 0.94rem/1.6 var(--sans);
    color: var(--ink-strong);
  }
  .citation,
  .num {
    border-radius: 4px;
    background: var(--selected);
    color: var(--ink-strong);
    font: 700 12px/1 var(--sans);
  }
  .citation {
    display: inline-block;
    min-width: 20px;
    padding: 3px 5px;
    border: 0;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    vertical-align: 0.14em;
  }
  .missing-marker {
    font: 600 12px/1 var(--sans);
    color: var(--muted);
  }
  summary {
    gap: 5px;
    min-height: 32px;
    width: fit-content;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary :global(svg) {
    flex: none;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  details[open] summary :global(svg) {
    transform: rotate(90deg);
  }
  ol,
  .legal ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .source-card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    min-height: 44px;
    border: 0;
    border-radius: 6px;
    text-align: start;
    font: inherit;
    text-decoration: none;
    background: transparent;
    color: var(--ink-strong);
  }
  button.source-card,
  a.source-card {
    cursor: pointer;
  }
  button.source-card:hover,
  a.source-card:hover,
  .citation:hover {
    background: var(--sunken);
  }
  .num {
    display: grid;
    place-items: center;
    flex: none;
    min-width: 20px;
    height: 20px;
    padding-inline: 3px;
  }
  .source-body {
    display: grid;
    min-width: 0;
    gap: 3px;
    overflow-wrap: anywhere;
  }
  .source-title {
    gap: 5px;
    color: var(--ink-strong);
    font: 600 0.81rem/1.4 var(--sans);
  }
  .source-title :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .source-quote {
    color: var(--muted);
    font: 400 0.81rem/1.5 var(--sans);
    white-space: pre-wrap;
  }
  .document-text {
    font-family: var(--mono);
  }
  .removed-citation .source-title {
    color: var(--muted);
  }
  @media (hover: none) {
    summary {
      min-height: 44px;
    }
  }
</style>
