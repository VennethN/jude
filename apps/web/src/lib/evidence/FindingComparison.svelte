<script lang="ts">
  import { onMount } from 'svelte';
  import { FileText } from '@lucide/svelte';
  import type { Finding, Lang, Workspace } from '@jude/core/domain';
  import { sourceOf } from './records';
  import { timecode } from '$lib/workspace/format';
  import { voice } from '$lib/workspace/hearing-detail/people';
  import Match from './Match.svelte';
  import SourceAvailability from './SourceAvailability.svelte';

  let { workspace, finding, lang }: { workspace: Workspace; finding: Finding; lang: Lang } = $props();
  let en = $derived(lang === 'en');
  let line = $derived(workspace.statements.find((s) => s.id === finding.statementId));
  let hearing = $derived(workspace.hearings.find((h) => h.id === finding.hearingId));
  let speaker = $derived(line ? voice(workspace.speakers, line.speakerId, lang) : undefined);
  let initial = $derived(
    speaker?.role === 'witness' ? speaker.name.replace(/^(Saksi|Witness)\s+/i, '').charAt(0) : speaker?.letters
  );
  let testimony = $derived(sourceOf(workspace, { kind: 'statement', id: finding.statementId }, lang));
  let sources = $derived(
    finding.sources.flatMap((ref) => {
      const passage = workspace.passages.find((p) => p.id === ref.passageId);
      const doc = passage && workspace.documents.find((d) => d.id === passage.docId);
      const source = sourceOf(workspace, { kind: 'passage', id: ref.passageId }, lang);
      return passage && doc && source ? [{ ref, passage, doc, source }] : [];
    })
  );
  const group = $props.id();
  let picked = $state(''),
    interactive = $state(false);
  let selected = $derived(sources.find((item) => item.passage.id === picked) ?? sources[0]);
  function move(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sources.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + sources.length) % sources.length;
    picked = sources[next].passage.id;
    document.getElementById(group + '-tab-' + next)?.focus();
  }
  onMount(() => {
    interactive = true;
  });
</script>

{#if testimony && line}
  <div
    class="evidence-pair"
    class:loud={finding.status === 'potential_inconsistency'}
    data-tour="finding-comparison"
  >
    <section class="spoken">
      <h3 class="label">
        <span class="disc" data-role={speaker?.role} aria-hidden="true">{initial ?? '?'}</span>{en
          ? 'In court'
          : 'Di sidang'}
      </h3>
      <blockquote lang="id">“<Match text={line.text} term={finding.said} />”</blockquote>
      <div class="byline">
        <b>{speaker?.name}</b><span>{en ? 'Hearing' : 'Sidang'} {hearing?.number} · {timecode(line.t)}</span>
      </div>
      <a class="source-link" href={testimony.href}>{en ? 'Open in hearing' : 'Buka di sidang'}</a>
    </section>
    <section class="filed">
      <h3 class="label">
        <FileText size={13} aria-hidden="true" />
        {selected
          ? selected.doc.title + ', ' + (en ? 'p.' : 'hal.') + ' ' + selected.passage.page
          : en
            ? 'In the record'
            : 'Dalam berkas'}
      </h3>
      {#if selected}
        <div
          class="selected-record"
          id={group + '-record'}
          role={sources.length > 1 ? 'tabpanel' : 'region'}
          aria-labelledby={sources.length > 1 ? group + '-tab-' + sources.indexOf(selected) : undefined}
          aria-label={sources.length === 1 ? selected.doc.title : undefined}
        >
          <blockquote class="record" lang="id">
            “<Match text={selected.passage.text} term={selected.ref.match} />”
          </blockquote>
          {#if sources.length > 1}
            <div class="source-tabs" role="tablist" aria-label={en ? 'Compare sources' : 'Bandingkan sumber'}>
              {#each sources as item, i (item.passage.id)}
                <button
                  role="tab"
                  id={group + '-tab-' + i}
                  aria-controls={group + '-record'}
                  aria-label={item.source.label}
                  title={item.source.label}
                  aria-selected={selected.passage.id === item.passage.id}
                  tabindex={selected.passage.id === item.passage.id ? 0 : -1}
                  disabled={!interactive}
                  onclick={() => (picked = item.passage.id)}
                  onkeydown={(event) => move(event, i)}
                >
                  {item.doc.title.split(/\s+/).slice(0, 2).join(' ')} · {en ? 'p.' : 'hal.'}
                  {item.passage.page}
                </button>
              {/each}
            </div>
          {/if}
          <a
            class="source-link"
            href={selected.source.href}
            aria-label={(en ? 'Open page ' : 'Buka halaman ') + selected.passage.page}
          >
            <FileText size={13} aria-hidden="true" />{en ? 'Open document' : 'Buka dokumen'}
          </a>
        </div>
        <noscript
          >{#each sources.slice(1) as item (item.passage.id)}<a class="source-link" href={item.source.href}
              >{item.source.label}</a
            >{/each}</noscript
        >
      {:else if !finding.unavailableSources?.length}<p class="missing">
          {en ? 'No source passage is available.' : 'Belum ada kutipan sumber.'}
        </p>{/if}
      <SourceAvailability {finding} {lang} />
    </section>
  </div>
{:else}<p class="ev-notice">
    {en ? 'The testimony for this finding is unavailable.' : 'Pernyataan untuk temuan ini tidak tersedia.'}
  </p>{/if}

<style>
  .evidence-pair {
    display: grid;
    gap: 10px;
  }
  @container finding (min-width:560px) {
    .evidence-pair {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface-2);
  }
  .loud section {
    border-color: color-mix(in srgb, var(--alert) 30%, var(--line));
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--muted);
    font: 600 11.5px/1.55 var(--sans);
    letter-spacing: 0.01em;
  }
  .disc {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--role-unknown-ink);
    color: var(--on-accent);
    font: 600 9px/1 var(--sans);
  }
  .disc[data-role='witness'] {
    background: var(--role-witness-ink);
  }
  .disc[data-role='judge'],
  .disc[data-role='judge_member'] {
    background: var(--role-judge-ink);
  }
  .disc[data-role='counsel'] {
    background: var(--role-counsel-ink);
  }
  .disc[data-role='opposing'] {
    background: var(--role-opposing-ink);
  }
  .disc[data-role='party'] {
    background: var(--role-party-ink);
  }
  :global([data-theme='night']) .disc[data-role='witness'] {
    background: var(--role-witness-soft);
    color: var(--role-witness-ink);
    box-shadow: inset 0 0 0 1px var(--role-witness-ink);
  }
  blockquote {
    margin: 0;
    color: var(--ink-strong);
    font: 400 16px/1.5 var(--sans);
    overflow-wrap: anywhere;
  }
  .record {
    font-family: var(--mono);
  }
  blockquote :global(mark.ev-mark) {
    color: inherit;
    background: color-mix(in srgb, var(--alert) 22%, transparent);
    box-shadow: inset 0 -2px 0 var(--alert);
    border-radius: 2px;
    padding: 0 1px;
  }
  .byline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    color: var(--muted);
    font: 400 12px/1.55 var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .byline b {
    color: var(--ink-strong);
    font-weight: 600;
  }
  .selected-record {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .source-link {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    min-height: 28px;
    margin-top: auto;
    color: var(--ink-strong);
    font: 500 13px/1.5 var(--sans);
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 4px;
  }
  .source-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .source-tabs button {
    border-radius: 999px;
    padding: 3px 10px;
    min-height: 26px;
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--line-strong);
    font: 600 11.5px/1.3 var(--sans);
  }
  .source-tabs button[aria-selected='true'] {
    background: var(--ink-strong);
    border-color: var(--ink-strong);
    color: var(--surface);
  }
  .source-tabs button:hover:not([aria-selected='true']) {
    color: var(--ink-strong);
    border-color: var(--muted);
  }
  .missing {
    color: var(--muted);
    font-size: 13px;
  }
  @media (pointer: coarse) {
    .source-link,
    .source-tabs button {
      min-height: 36px;
    }
  }
</style>
