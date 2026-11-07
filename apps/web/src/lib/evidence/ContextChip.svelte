<script lang="ts">
  import {
    AudioLines,
    BookOpenText,
    FileText,
    Files,
    FolderOpen,
    Headphones,
    LayoutGrid,
    ListChecks,
    Waypoints,
  } from '@lucide/svelte';
  import type { ContextRef, Lang, Workspace } from '@jude/core/domain';
  import { sourceOf } from './records';
  import { contextLabel } from './thread-context';
  let {
    workspace,
    ref,
    lang,
    link = false,
    cited = false,
  }: { workspace: Workspace; ref: ContextRef; lang: Lang; link?: boolean; cited?: boolean } = $props();
  const icons = {
    case: FolderOpen,
    documents: Files,
    statement: AudioLines,
    hearing: Headphones,
    finding: ListChecks,
    document: FileText,
    passage: BookOpenText,
    board: LayoutGrid,
    connection: Waypoints,
  };
  const Icon = $derived(icons[ref.kind]);
  const label = $derived(contextLabel(workspace, ref, lang));
  const source = $derived(
    'unavailable' in ref && ref.unavailable ? undefined : sourceOf(workspace, ref, lang),
  );
  const hint = $derived(
    (cited
      ? lang === 'id'
        ? 'Sumber kutipan'
        : 'Cited source'
      : lang === 'id'
        ? 'Konteks pertanyaan'
        : 'Question context') +
      ' · ' +
      label,
  );
</script>

{#snippet content()}<Icon size={12} aria-hidden="true" /><span>{label}</span>{/snippet}
{#if link && source}<a class="context-chip" href={source.href} title={hint}>{@render content()}</a>
{:else}<span class="context-chip" title={hint}>{@render content()}</span>{/if}

<style>
  .context-chip {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    min-width: 0;
    max-width: 100%;
    padding: 1px 7px 1px 5px;
    border: 1px solid var(--line);
    border-radius: 30px;
    background: var(--surface-2);
    color: var(--ink);
    font: 600 11.5px/1.5 var(--sans);
    text-decoration: none;
  }
  .context-chip :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .context-chip > span {
    min-width: 0;
    max-width: 24ch;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
  a:hover {
    background: var(--sunken);
  }
</style>
