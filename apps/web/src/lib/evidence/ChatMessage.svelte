<script lang="ts">
  import { AudioLines, BookOpenText, ChevronRight, FileText, Headphones, ListChecks } from '@lucide/svelte';
  import type { ChatMessage, Citation, InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import ContextChip from './ContextChip.svelte';
  import { answerBlocks, inlines, type Inline } from './answer-markdown';
  import { local, sourceOf } from './records';

  let {
    workspace: w,
    lang,
    message: m,
    inspect,
    streaming = false,
  }: {
    workspace: Workspace;
    lang: Lang;
    message: ChatMessage;
    inspect: (target: InspectTarget) => void;
    streaming?: boolean;
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
  const blocks = $derived(m.mode === 'ai' ? answerBlocks(answer, streaming) : []);
  const plain = $derived.by((): Inline[] => {
    if (m.mode === 'ai') return [];
    if (!bodyContainsAllQuotes) return inlines(answer);
    return cited.flatMap((entry, i): Inline[] => [
      { kind: 'quote', text: (i ? '\n\n' : '') + '“' + entry.quote + '” ' },
      { kind: 'citation', number: i + 1, text: '[' + (i + 1) + ']' },
    ]);
  });
  const laws = $derived((m.legal ?? []).flatMap((lawId) => w.legal.filter((law) => law.id === lawId)));
  const notices = $derived.by(() => {
    const issue = {
      not_configured: id ? 'Penyedia AI belum siap. Hubungi pengelola untuk memeriksa konfigurasi; sumber perkara tetap dapat dibaca.' : 'The AI provider is not ready. Ask your administrator to check its configuration; case sources remain available.',
      unavailable: id ? 'Penyedia AI tidak dapat dihubungi. Sumber terkait ditampilkan; coba lagi nanti.' : 'The AI provider could not be reached. Related sources are shown; try again later.',
      rate_limit: id ? 'Batas permintaan penyedia AI tercapai. Sumber terkait ditampilkan; coba lagi nanti.' : 'The AI provider’s request limit was reached. Related sources are shown; try again later.',
      incomplete: id ? 'Jawaban AI belum selesai. Sumber terkait ditampilkan; coba pertanyaan yang lebih spesifik.' : 'The AI answer did not finish. Related sources are shown; try a more specific question.',
      unverified: id ? 'Kutipan jawaban AI tidak lolos pemeriksaan. Gunakan sumber asli di bawah ini.' : 'The AI answer’s quotations could not be verified. Use the original sources below.',
      insufficient: id ? 'Sumber yang ditemukan belum cukup untuk menjawab. Perjelas pertanyaan atau tambahkan konteks.' : 'The retrieved sources are insufficient to answer. Clarify the question or add context.',
    };
    const result: string[] = m.issue ? [issue[m.issue]] : [];
    if (m.retrieval === 'lexical' && m.issue !== 'not_configured') result.push(id ? 'Pencarian makna belum tersedia; pencarian kata digunakan.' : 'Semantic search is unavailable; keyword search was used.');
    if (m.retrieval === 'partial') result.push(id ? 'Sebagian sumber masih perlu diindeks. Pencarian makna belum mencakup seluruh konteks; coba lagi setelah pengindeksan berlanjut.' : 'Some sources still need indexing. Semantic search does not yet cover the whole context; try again as indexing progresses.');
    if (m.legalStatus === 'unavailable') result.push(id ? 'Pasal.id tidak dapat dihubungi. Rujukan baru belum diperiksa; coba lagi nanti.' : 'Pasal.id could not be reached. New legal references have not been checked; try again later.');
    if (m.legalStatus === 'not_configured') result.push(id ? 'Akses Pasal.id belum dikonfigurasi. Hubungi pengelola untuk mengaktifkannya.' : 'Pasal.id access is not configured. Ask your administrator to enable it.');
    if (m.legalStatus === 'no_matches') result.push(id ? 'Pasal.id tidak menemukan rujukan yang cocok.' : 'Pasal.id found no matching references.');
    return result.filter(Boolean);
  });
  function missingLabel(ref: Citation) {
    if (ref.unavailable) return id ? 'Sumber dihapus' : 'Source removed';
    return id ? 'Sumber tidak tersedia' : 'Source unavailable';
  }
</script>

{#snippet citation(number: number, original: string)}
  {@const entry = cited[number - 1]}
  {#if entry?.source}
    {@const label = (id ? 'Sumber ' : 'Source ') + number + ' · ' + entry.source.label}
    {@const target = entry.target}
    {#if target}
      <button class="citation" title={entry.source.label} aria-label={label} onclick={() => inspect(target)}>{number}</button>
    {:else}
      <a class="citation" href={entry.source.href} title={entry.source.label} aria-label={label}>{number}</a>
    {/if}
  {:else if entry}
    <span class="missing-marker" title={missingLabel(entry.ref)}>{original}</span>
  {:else}
    {original}
  {/if}
{/snippet}

{#snippet renderInline(nodes: Inline[])}
  {#each nodes as node}
    {#if node.kind === 'citation'}
      {@render citation(node.number, node.text)}
    {:else if node.kind === 'strong'}
      <strong>{@render renderInline(node.children)}</strong>
    {:else if node.kind === 'em'}
      <em>{@render renderInline(node.children)}</em>
    {:else if node.kind === 'quote'}
      <span class="verbatim">{node.text}</span>
    {:else if node.kind === 'text'}
      {node.text}
    {/if}
  {/each}
{/snippet}

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
    {#each notices as notice}<p class="notice">{notice}</p>{/each}
    {#if answer}
      {#if m.mode === 'ai'}
        <div class="answer formatted">
          {#each blocks as block}
            {#if block.kind === 'heading'}<h3>{@render renderInline(block.content)}</h3>
            {:else if block.kind === 'subheading'}<h4>{@render renderInline(block.content)}</h4>
            {:else if block.kind === 'paragraph'}<p>{@render renderInline(block.content)}</p>
            {:else if block.kind === 'ordered'}
              <ol start={block.start}>{#each block.items as item}<li>{@render renderInline(item)}</li>{/each}</ol>
            {:else if block.kind === 'bullets'}
              <ul>{#each block.items as item}<li>{@render renderInline(item)}</li>{/each}</ul>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="answer">{@render renderInline(plain)}</p>
      {/if}
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
        <p class="notice">{id ? 'Rujukan ini berasal dari indeks peraturan. Buka sumber untuk memeriksa bunyi pasal dan status berlakunya.' : 'These references come from the regulation index. Open the source to check the article text and its current status.'}</p>
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
  .notice { margin: 0; color: var(--muted); font: 400 13px/1.5 var(--sans); }
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
  .formatted {
    display: grid;
    gap: 0.6rem;
    white-space: normal;
  }
  .formatted p,
  .formatted h3,
  .formatted h4,
  .formatted ul,
  .formatted ol { margin: 0; }
  .formatted h3 {
    font: 400 1.4rem/1.2 var(--display);
    color: var(--ink-strong);
  }
  .formatted h4 { font: 600 0.96rem/1.5 var(--sans); }
  .formatted :is(h3, h4):not(:first-child) { margin-top: 0.45rem; }
  .formatted :is(ul, ol) { padding-inline-start: 1.35em; }
  .formatted li + li { margin-top: 0.3rem; }
  .formatted li::marker { color: var(--muted); }
  .formatted strong { font-weight: 650; }
  .formatted em { font-style: italic; font-synthesis: style; }
  .verbatim { white-space: pre-wrap; }
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
  details > ol,
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
