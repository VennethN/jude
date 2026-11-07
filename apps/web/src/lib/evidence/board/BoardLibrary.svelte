<script lang="ts">
  import { FileText, Plus, Search, Speech } from '@lucide/svelte';
  import type { BoardRef, Lang, Workspace } from '@jude/core/domain';
  import { needsReview } from '@jude/core/domain';
  import { clock, evidenceKey, sourceOf } from '../records';
  import Match from '../Match.svelte';
  import BoardStatus from './BoardStatus.svelte';
  let {
    workspace,
    lang,
    placed,
    disabled,
    pick,
  }: {
    workspace: Workspace;
    lang: Lang;
    placed: string[];
    disabled: boolean;
    pick: (ref: BoardRef) => void;
  } = $props();
  let group = $state<'finding' | 'statement' | 'document'>('finding'),
    search = $state('');
  const en = $derived(lang === 'en');
  const lines = $derived(new Map(workspace.statements.map((line) => [line.id, line])));
  const findings = $derived(new Map(workspace.findings.map((finding) => [finding.id, finding])));
  const sortedFindings = $derived(
    [...workspace.findings].sort(
      (a, b) =>
        Number(needsReview(b)) - Number(needsReview(a)) ||
        (lines.get(a.statementId)?.t ?? Infinity) - (lines.get(b.statementId)?.t ?? Infinity),
    ),
  );
  const labels = $derived({
    finding: en ? 'Findings' : 'Temuan',
    statement: en ? 'Hearing lines' : 'Pernyataan',
    document: en ? 'Documents' : 'Dokumen',
  });
  const options = $derived.by(() => {
    const refs: BoardRef[] =
      group === 'finding'
        ? sortedFindings.map((f) => ({ kind: 'finding', id: f.id }))
        : group === 'statement'
          ? workspace.statements.map((s) => ({ kind: 'statement', id: s.id }))
          : [
              ...workspace.documents.map((d) => ({ kind: 'document' as const, id: d.id })),
              ...workspace.passages.map((p) => ({ kind: 'passage' as const, id: p.id })),
            ];
    return refs
      .map((ref) => ({ ref, key: evidenceKey(ref), source: sourceOf(workspace, ref, lang) }))
      .filter(
        (c) =>
          c.source &&
          (!search.trim() ||
            (c.source.label + ' ' + c.source.text)
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())),
      );
  });
</script>

<section class="library" aria-label={en ? 'Add to the board' : 'Tambahkan ke papan'}>
  <h2>{en ? 'Add to the board' : 'Tambahkan ke papan'}</h2>
  <p>
    {en
      ? 'Drag evidence onto the board, or choose an item to add it.'
      : 'Seret bukti ke papan, atau pilih dari daftar ini untuk menambahkannya.'}
  </p>
  <div class="segments" role="group" aria-label={en ? 'Evidence type' : 'Jenis bukti'}>
    {#each ['finding', 'statement', 'document'] as tab}
      <button
        type="button"
        aria-pressed={group === tab}
        onclick={() => {
          group = tab as typeof group;
          search = '';
        }}>{labels[tab as keyof typeof labels]}</button
      >
    {/each}
  </div>
  {#if group !== 'finding'}<label class="ev-search"
      ><Search size={14} /><input
        type="search"
        placeholder={en ? 'Find evidence…' : 'Cari bukti…'}
        aria-label={en ? 'Find evidence' : 'Cari bukti'}
        bind:value={search}
      /></label
    >{/if}
  <ul class="library-list">
    {#each options as entry (entry.key)}
      {@const finding = group === 'finding' ? findings.get(entry.ref.id) : undefined}
      {@const line = finding && lines.get(finding.statementId)}
      <li>
        <button
          disabled={disabled || placed.includes(entry.key)}
          title={en ? 'Add to board' : 'Tambahkan ke papan'}
          draggable={!disabled && !placed.includes(entry.key)}
          ondragstart={(e) => {
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData('application/x-jude-board-ref', entry.key);
            }
          }}
          onclick={() => pick(entry.ref)}
        >
          <span class="item-meta"
            >{#if finding}<BoardStatus status={finding.status} {lang} />{#if line}<time>{clock(line.t)}</time
                >{/if}{:else if group === 'statement'}<Speech size={13} />{en
                ? 'Testimony'
                : 'Keterangan'}{:else}<FileText size={13} />{entry.ref.kind === 'document'
                ? labels.document
                : en
                  ? 'Passage'
                  : 'Kutipan'}{/if}{#if placed.includes(entry.key)}<b>{en ? 'On board' : 'Di papan'}</b
              >{:else}<Plus size={13} />{/if}</span
          >
          <strong>{entry.source?.label}</strong><span class="item-text" lang="id"
            >{#if line}“<Match text={line.text} term={finding?.said} />”{:else}{entry.source?.text}{/if}</span
          >
        </button>
      </li>
    {:else}<li class="empty">{en ? 'No matching evidence.' : 'Tidak ada bukti yang cocok.'}</li>{/each}
  </ul>
</section>

<style>
  .library {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    padding: 14px;
    color: var(--ink);
  }
  .library h2 {
    margin: 0;
    font: 400 1.22rem/1.25 var(--display);
  }
  .library > p {
    margin: 4px 0 12px;
    color: var(--muted);
    font: 400 0.8rem/1.45 var(--sans);
  }
  .segments {
    display: flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
  }
  .segments button {
    flex: 1;
    min-height: 30px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    font: 500 0.78rem/1.25 var(--sans);
  }
  .segments button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 3px #13241a23;
  }
  .library .ev-search {
    margin-top: 8px;
    min-width: 0;
  }
  .library-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    max-height: 340px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .library-list li + li {
    margin-top: 4px;
  }
  .library-list button {
    width: 100%;
    display: grid;
    gap: 5px;
    padding: 9px 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ink);
    text-align: left;
  }
  .library-list button:hover {
    background: var(--wash);
  }
  .library-list button:disabled {
    opacity: 0.64;
  }
  .library-list strong {
    font: 400 1.03rem/1.25 var(--display);
  }
  .item-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--muted);
    font-size: 0.71rem;
  }
  .item-meta :global(svg:last-child),
  .item-meta b {
    margin-left: auto;
  }
  .item-text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--muted);
    font-size: 0.79rem;
    line-height: 1.4;
  }
  .empty {
    padding: 1rem;
    color: var(--muted);
  }
  @media (pointer: coarse) {
    .segments button {
      min-height: 44px;
    }
    .library-list button {
      min-height: 48px;
    }
  }
</style>
