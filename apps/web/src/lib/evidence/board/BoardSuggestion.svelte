<script lang="ts">
  import { Plus, X } from '@lucide/svelte';
  import type { BoardRef, Lang, Workspace } from '@jude/core/domain';
  import { clock, sourceOf } from '../records';
  import BoardStatus from './BoardStatus.svelte';
  import { displaySpeaker } from '$lib/workspace/format';
  let {
    workspace,
    lang,
    ref,
    disabled,
    accept,
    dismiss,
  }: {
    workspace: Workspace;
    lang: Lang;
    ref: BoardRef;
    disabled: boolean;
    accept: () => void;
    dismiss: () => void;
  } = $props();
  const en = $derived(lang === 'en'),
    source = $derived(sourceOf(workspace, ref, lang));
  const finding = $derived(
    ref.kind === 'finding' ? workspace.findings.find((f) => f.id === ref.id) : undefined,
  );
  const line = $derived(finding ? workspace.statements.find((s) => s.id === finding.statementId) : undefined);
  const hearing = $derived(line ? workspace.hearings.find((h) => h.id === line.hearingId) : undefined);
</script>

<article class="candidate">
  <div class="meta">
    {#if finding}<BoardStatus status={finding.status} {lang} />{/if}{#if line}<time>{clock(line.t)}</time
      >{/if}<span class="tag">{en ? 'Suggestion' : 'Saran'}</span>
  </div>
  <h3>{source?.label}</h3>
  {#if line && hearing}<p>
      {displaySpeaker(workspace.speakers, line.speakerId, lang)} · {en ? 'Hearing' : 'Sidang'}
      {hearing.number}
    </p>{:else}<p>{source?.text}</p>{/if}
  <div class="actions">
    <button {disabled} onclick={accept}><Plus size={14} />{en ? 'Place on board' : 'Taruh di papan'}</button
    ><button
      {disabled}
      class="skip"
      onclick={dismiss}
      aria-label={(en ? 'Skip' : 'Lewati') + ' · ' + source?.label}
      title={en ? 'Skip' : 'Lewati'}><X size={14} /><span>{en ? 'Skip' : 'Lewati'}</span></button
    >
  </div>
</article>

<style>
  .candidate {
    position: relative;
    display: grid;
    align-content: start;
    gap: 5px;
    min-width: 0;
    border: 1px dashed var(--line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 83%, transparent);
    color: var(--ink);
    padding: 10px 12px;
  }
  .meta,
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .meta {
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 0.71rem;
  }
  .tag {
    margin-left: auto;
    padding: 1px 4px;
    border: 1px dashed var(--line);
    border-radius: 3px;
  }
  .candidate h3 {
    margin: 0;
    font: 400 1.02rem/1.3 var(--display);
  }
  .candidate p {
    margin: 0;
    color: var(--muted);
    font-size: 0.76rem;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .actions {
    padding-top: 3px;
    border-top: 1px dashed var(--line);
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    border: 0;
    padding: 4px 6px;
    border-radius: 5px;
    background: transparent;
    color: var(--ink);
    font: 600 0.76rem/1.2 var(--sans);
  }
  .actions button:hover {
    background: var(--wash);
  }
  .actions .skip {
    margin-left: auto;
  }
  .skip span {
    display: none;
  }
  @container (max-width:710px) {
    .skip span {
      display: inline;
    }
    .actions .skip {
      margin-left: 0;
    }
    .actions button:first-child {
      background: var(--forest);
      color: #fffaf1;
    }
    .tag {
      display: none;
    }
  }
  @media (pointer: coarse) {
    .actions button {
      min-height: 44px;
    }
  }
</style>
