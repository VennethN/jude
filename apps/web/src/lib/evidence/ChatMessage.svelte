<script lang="ts">
  import { FileText, BookOpenText } from '@lucide/svelte';
  import type { ChatMessage, Citation, InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import { local, sourceOf } from './records';
  let {
    workspace: w,
    lang,
    message: m,
    inspect
  }: {
    workspace: Workspace;
    lang: Lang;
    message: ChatMessage;
    inspect: (t: InspectTarget) => void;
  } = $props();
  let id = $derived(lang === 'id');
  let body = $derived(local(m.text, lang).split(/(\[\d+\])/));
  function number(token: string) {
    return /^\[\d+\]$/.test(token) ? Number(token.slice(1, -1)) - 1 : -1;
  }
  function canInspect(ref: Citation): ref is Extract<InspectTarget, { kind: 'passage' | 'statement' }> {
    return ref.kind === 'statement' || ref.kind === 'passage';
  }
</script>

<article
  class="message"
  class:question={m.role === 'user'}
  data-tour={m.role === 'assistant' ? 'assistant-answer' : undefined}
>
  <header>
    <strong>{m.role === 'user' ? (id ? 'Anda' : 'You') : 'Jude'}</strong>{#if m.mode === 'sources-only'}<span
        >{id ? 'Pencarian sumber saja' : 'Sources only'}</span
      >{:else if m.role === 'assistant' && w.caseRecord.label === 'synthetic'}<span
        >{id ? 'Perkara sintetis' : 'Synthetic case'}</span
      >{/if}
  </header>
  {#if m.contexts?.length && m.role === 'user'}<p class="ev-meta">
      {id ? 'Konteks' : 'Context'} · {m.contexts
        .map((c) =>
          'unavailable' in c && c.unavailable
            ? id
              ? 'Sumber dihapus'
              : 'Source removed'
            : sourceOf(w, c, lang)?.label
        )
        .filter(Boolean)
        .join(' · ')}
    </p>{/if}
  <div class="answer">
    {#each body as segment}{@const idx = number(segment)}{@const ref = m.citations?.[idx]}{@const src =
        ref && sourceOf(w, ref, lang)}
      {#if ref && src}{#if canInspect(ref)}<button
            class="citation"
            title={src.label}
            aria-label={(id ? 'Sumber ' : 'Source ') + (idx + 1) + ' · ' + src.label}
            onclick={() => inspect(ref)}>{idx + 1}</button
          >{:else}<a class="citation" href={src.href} title={src.label}>{idx + 1}</a
          >{/if}{:else if ref?.unavailable}<span
          class="missing-marker"
          title={id ? 'Sumber dihapus' : 'Source removed'}>{segment}</span
        >{:else}{segment}{/if}{/each}
  </div>
  {#if m.citations?.length}<details data-tour="assistant-citations">
      <summary
        ><FileText size={15} />{id ? 'Sumber yang dikutip' : 'Cited sources'} · {m.citations.length}</summary
      >
      <ol>
        {#each m.citations as ref (ref.kind + ref.id)}{@const src = sourceOf(w, ref, lang)}{#if src}<li>
              {#if canInspect(ref)}<button class="source-link" onclick={() => inspect(ref)}
                  >{src.label}</button
                >{:else}<a class="source-link" href={src.href}>{src.label}</a>{/if}
            </li>{:else}<li class="removed-citation">
              <strong
                >{ref.unavailable
                  ? id
                    ? 'Sumber dihapus'
                    : 'Source removed'
                  : id
                    ? 'Sumber tidak tersedia'
                    : 'Source unavailable'}</strong
              >{#if ref.snapshot}<p>{ref.snapshot}</p>{/if}
            </li>{/if}{/each}
      </ol>
    </details>{/if}
  {#each m.legal ?? [] as lawId}{@const law = w.legal.find((l) => l.id === lawId)}{#if law}<button
        class="law"
        onclick={() => inspect({ kind: 'legal', id: lawId })}
        ><BookOpenText size={15} />{law.article} · {law.regulation}</button
      >{/if}{/each}
</article>

<style>
  .missing-marker {
    color: var(--muted);
    font: 600 0.72rem/1.2 var(--sans);
  }
  .removed-citation {
    color: var(--muted);
  }
  .removed-citation strong {
    font: 600 0.8rem var(--sans);
  }
  .removed-citation p {
    font: 400 0.83rem/1.45 var(--mono);
    margin: 0.15rem 0 0.5rem;
  }
  .message {
    padding: 1.1rem 0;
    max-width: 80ch;
  }
  :global(.message) + .message {
    border-top: 1px solid var(--line);
  }
  header {
    display: flex;
    gap: 0.65rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  header strong {
    font: 400 1.35rem var(--display);
    color: var(--ink);
  }
  .question header strong {
    font: 600 0.86rem var(--sans);
  }
  header span {
    font-size: 0.73rem;
    color: var(--muted);
  }
  .question .answer {
    font-weight: 600;
  }
  .answer {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.96rem;
    line-height: 1.65;
  }
  .citation {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: 0.15em;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--surface));
    min-width: 1.5em;
    min-height: 1.5em;
    border: 0;
    border-radius: 4px;
    font: 600 0.72rem/1 var(--sans);
    text-decoration: underline;
    cursor: pointer;
    padding: 0.1rem 0.28rem;
    margin-inline: 0.05rem;
  }
  details {
    margin-top: 0.6rem;
  }
  summary {
    cursor: pointer;
    font: 600 0.8rem/1.5 var(--sans);
    padding: 0.35rem 0;
    color: var(--muted);
    min-height: 36px;
  }
  summary :global(svg) {
    vertical-align: middle;
    margin-right: 0.3rem;
  }
  ol {
    padding-left: 1.75rem;
    margin: 0.25rem 0;
  }
  .source-link,
  .law {
    color: var(--accent);
    font: 500 0.81rem/1.45 var(--sans);
    text-align: start;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    border: 0;
    background: transparent;
    padding: 0.25rem 0;
    cursor: pointer;
  }
  .law {
    gap: 0.4rem;
  }
  .message .ev-meta {
    margin: 0.1rem 0 0.55rem;
  }
</style>
