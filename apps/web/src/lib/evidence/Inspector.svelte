<script lang="ts">
  import Dialog from '$lib/workspace/Dialog.svelte';
  import SourceAvailability from './SourceAvailability.svelte';
  import {
    ArrowUpRight,
    MessagesSquare,
    Network,
    PanelsTopLeft
  } from '@lucide/svelte';
  import type { InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import { assistantPath, boardPath, casePath, evidenceKey, local, sourceOf } from './records';
  import './evidence.css';

  let {
    workspace: w,
    lang,
    target,
    close
  }: { workspace: Workspace; lang: Lang; target: InspectTarget; close: () => void } = $props();
  let id = $derived(lang === 'id');
  let base = $derived(casePath(w));
  let law = $derived(target.kind === 'legal' ? w.legal.find((l) => l.id === target.id) : undefined);
  let p = $derived(target.kind === 'passage' ? w.passages.find((l) => l.id === target.id) : undefined);
  let line = $derived(target.kind === 'statement' ? w.statements.find((l) => l.id === target.id) : undefined);
  let finding = $derived(target.kind === 'finding' ? w.findings.find((l) => l.id === target.id) : undefined);
  let source = $derived(
    target.kind === 'reply' || target.kind === 'legal' ? undefined : sourceOf(w, target, lang)
  );
  let related = $derived(
    w.findings.filter((f) =>
      p
        ? f.sources.some((s) => s.passageId === p.id)
        : line
          ? f.statementId === line.id
          : law
            ? f.legal?.includes(law.id)
            : false
    )
  );
  const title = $derived(law ? (id ? 'Rujukan hukum' : 'Legal reference') : p ? (id ? 'Kutipan berkas' : 'Document passage') : (id ? 'Sumber perkara' : 'Case source'));
</script>

<Dialog sheet {title} {lang} {close}>
  <div class="ev-panel inspector">
  {#if law}
    <h2 id="source-title" class="ev-title">{law.article}</h2>
    <p>{law.regulation}</p>
    <p class="ev-meta">
      {w.caseRecord.label === 'synthetic'
        ? id
          ? 'Metadata contoh Pasal.id'
          : 'Sample Pasal.id metadata'
        : 'Pasal.id'} · {id ? 'Periksa naskah resmi.' : 'Verify the official text.'}
    </p>
    <p>{local(law.summary, lang)}</p>
    <a class="ev-link" href="https://pasal.id" target="_blank" rel="noreferrer"
      >Pasal.id <ArrowUpRight size={14} /></a
    >
  {:else if source}
    <h2 class="ev-title" id="source-title">{source.label}</h2>
    {#if p?.before}<p class="ev-record ev-muted">{p.before}</p>{/if}
    <blockquote class:ev-record={!!p}>{source.text}</blockquote>
    {#if p?.after}<p class="ev-record ev-muted">{p.after}</p>{/if}
    <div class="ev-actions">
      <a class="ev-button" href={source.href} onclick={close}
        >{id ? 'Buka sumber' : 'Open source'}<ArrowUpRight size={15} /></a
      >
      {#if target.kind === 'passage' || target.kind === 'statement' || target.kind === 'finding'}
        <a class="ev-button" href={assistantPath(w, target)} onclick={close}
          ><MessagesSquare size={15} />{id ? 'Tanya asisten' : 'Ask assistant'}</a
        >
        <a class="ev-button" href={boardPath(w, target)} onclick={close}
          ><PanelsTopLeft size={15} />{id ? 'Taruh di papan' : 'Put on board'}</a
        >
        <a
          class="ev-button"
          href={base + '/connections?of=' + encodeURIComponent(evidenceKey(target))}
          onclick={close}><Network size={15} />{id ? 'Keterkaitan' : 'Connections'}</a
        >
      {/if}
    </div>
    {#if finding}<p>{local(finding.explanation, lang)}</p>
      <SourceAvailability {finding} {lang} />{/if}
  {:else}<h2 id="source-title" class="ev-title">
      {id ? 'Sumber tidak tersedia' : 'Source unavailable'}
    </h2>{/if}
  {#if related.length}<section>
      <h3>{id ? 'Temuan terkait' : 'Related findings'}</h3>
      <ul class="ev-list">
        {#each related as f (f.id)}<li>
            <a class="ev-link" href={base + '/findings/' + encodeURIComponent(f.id)} onclick={close}
              >{local(f.title, lang)}</a
            >
          </li>{/each}
      </ul>
    </section>{/if}
  </div>
</Dialog>

<style>
  .inspector {
    padding:clamp(16px,3vw,26px);
    overflow-wrap:anywhere;
  }
  .inspector blockquote {
    background: var(--paper);
    padding: 1rem;
    margin: 1rem 0;
    line-height: 1.65;
  }
  .inspector section {
    margin-top: 1.65rem;
  }
  .inspector h3 {
    font-size: 1rem;
  }
</style>
