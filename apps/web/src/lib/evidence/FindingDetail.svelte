<script lang="ts">
  import SourceAvailability from './SourceAvailability.svelte';
  import { onMount, untrack } from 'svelte';
  import {
    Check,
    Pencil,
    RotateCcw,
    Copy,
    MessageSquare,
    PanelsTopLeft,
    Play,
    ArrowUpRight,
    Bookmark,
    BookOpenText,
    FileText,
    CircleCheck,
    ChevronDown
  } from '@lucide/svelte';
  import { write } from '$lib/client';
  import type { Finding, InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import { apiPath, assistantPath, boardPath, local, sourceOf, statuses } from './records';
  import Inspector from './Inspector.svelte';
  import Match from './Match.svelte';
  import { timecode } from '$lib/workspace/format';
  import { voice } from '$lib/workspace/hearing-detail/people';

  let { workspace: w, lang, finding: f }: { workspace: Workspace; lang: Lang; finding: Finding } = $props();
  let id = $derived(lang === 'id');
  let line = $derived(w.statements.find((s) => s.id === f.statementId));
  let hearing = $derived(w.hearings.find((h) => h.id === f.hearingId));
  let testimony = $derived(sourceOf(w, { kind: 'statement', id: f.statementId }, lang));
  let speaker = $derived(line ? voice(w.speakers, line.speakerId, lang) : undefined);
  const group = $props.id();
  let pickedSource = $state(''),
    interactive = $state(false);
  let sources = $derived(
    f.sources.flatMap((ref) => {
      const passage = w.passages.find((p) => p.id === ref.passageId);
      const doc = passage && w.documents.find((d) => d.id === passage.docId);
      const source = sourceOf(w, { kind: 'passage', id: ref.passageId }, lang);
      return passage && doc && source ? [{ ref, passage, doc, source }] : [];
    })
  );
  let selected = $derived(sources.find((s) => s.ref.passageId === pickedSource) ?? sources[0]);
  function chooseSource(event: KeyboardEvent, index: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sources.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + sources.length) % sources.length;
    pickedSource = sources[next].ref.passageId;
    document.getElementById(group + '-source-' + next)?.focus();
  }
  let note = $state(untrack(() => f.note));
  let busy = $state(false),
    feedback = $state(''),
    problem = $state(''),
    manualCopy = $state(false);
  let target = $state<InspectTarget | null>(null);
  let notes: HTMLTextAreaElement;
  let question: HTMLElement;
  async function save(check = false) {
    if (busy) return;
    busy = true;
    problem = '';
    feedback = '';
    try {
      await write(
        apiPath(w, 'findings/' + encodeURIComponent(f.id)),
        'PATCH',
        check ? { reviewed: !f.reviewed, note } : { note }
      );
      feedback = id ? 'Perubahan tersimpan.' : 'Changes saved.';
    } catch (e) {
      problem = e instanceof Error ? e.message : id ? 'Gagal menyimpan.' : 'Could not save.';
    } finally {
      busy = false;
    }
  }
  async function toggleBookmark() {
    if (!line || busy) return;
    busy = true;
    problem = '';
    try {
      await write(apiPath(w, 'statements/' + encodeURIComponent(line.id)), 'PATCH', {
        flagged: !line.flagged
      });
    } catch (e) {
      problem = e instanceof Error ? e.message : id ? 'Perubahan gagal.' : 'Change failed.';
    } finally {
      busy = false;
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(f.question);
      feedback = id ? 'Pertanyaan disalin.' : 'Question copied.';
    } catch {
      manualCopy = true;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(question);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
  function shortcut(e: KeyboardEvent) {
    if (
      e.defaultPrevented ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.shiftKey ||
      target ||
      document.querySelector('dialog[open]') ||
      (e.target instanceof HTMLElement &&
        (e.target.isContentEditable || e.target.closest('input,textarea,select')))
    )
      return;
    if (e.key === 'r') {
      e.preventDefault();
      void save(true);
    }
    if (e.key === 'n') {
      e.preventDefault();
      notes?.focus();
    }
  }
  onMount(() => {
    interactive = true;
    if (f.isNew)
      void write(apiPath(w, 'findings/' + encodeURIComponent(f.id)), 'PATCH', { isNew: false }).catch(
        () => {}
      );
  });
</script>

<svelte:window onkeydown={shortcut} />
<article class="detail" data-tour="finding-detail">
  <div class="finding-meta">
    <span class="ev-cap flag" data-status={f.status}><span></span>{statuses[f.status][lang]}</span>
    {#if f.reviewed}<span class="ev-cap"><CircleCheck size={15} />{id ? 'Diperiksa' : 'Checked'}</span>{/if}
  </div>
  <h2 class="ev-title">{local(f.title, lang)}</h2>
  {#if testimony && line}
    <div class="evidence-pair" data-tour="finding-comparison">
      <section class="spoken">
        <h3>
          <span class="speaker-disc" aria-hidden="true">{speaker?.letters}</span>{id
            ? 'Di sidang'
            : 'In court'}
        </h3>
        <blockquote>“<Match text={line.text} term={f.said} />”</blockquote>
        <div class="source-foot">
          <span class="byline">{speaker?.name}</span><a class="under" href={testimony.href}
            >{timecode(line.t)} · {id ? 'Buka di sidang' : 'Open in hearing'}<ArrowUpRight size={13} /></a
          >
        </div>
      </section>
      <section class="filed">
        <h3><FileText size={16} />{id ? 'Dalam berkas' : 'In the record'}</h3>
        {#if selected}
          <div
            id={group + '-passage'}
            role={sources.length > 1 ? 'tabpanel' : 'region'}
            aria-labelledby={sources.length > 1 ? group + '-source-' + sources.indexOf(selected) : undefined}
            aria-label={sources.length === 1 ? selected.doc.title : undefined}
          >
            <blockquote class="ev-record">
              “<Match text={selected.passage.text} term={selected.ref.match} />”
            </blockquote>
            <div class="source-foot">
              <span class="byline">{selected.doc.title}</span><a class="under" href={selected.source.href}
                >{id ? 'Buka halaman' : 'Open page'} {selected.passage.page}<ArrowUpRight size={13} /></a
              >
            </div>
          </div>
          {#if sources.length > 1}<div
              class="source-tabs"
              role="tablist"
              aria-label={id ? 'Bandingkan sumber' : 'Compare sources'}
            >
              {#each sources as source, i (source.ref.passageId)}<button
                  role="tab"
                  disabled={!interactive}
                  id={group + '-source-' + i}
                  aria-label={source.source.label}
                  title={source.source.label}
                  aria-controls={group + '-passage'}
                  aria-selected={selected.ref.passageId === source.ref.passageId}
                  tabindex={selected.ref.passageId === source.ref.passageId ? 0 : -1}
                  onclick={() => (pickedSource = source.ref.passageId)}
                  onkeydown={(event) => chooseSource(event, i)}
                  >{source.doc.title.split(/\s+/).slice(0, 2).join(' ')} · {source.passage.page}</button
                >{/each}
            </div>{/if}
        {:else if !f.unavailableSources?.length}<p class="ev-sub">
            {id ? 'Belum ada kutipan sumber.' : 'No source passage is available.'}
          </p>{/if}
        <SourceAvailability finding={f} {lang} />
      </section>
    </div>
  {:else}<p class="ev-notice">
      {id ? 'Pernyataan untuk temuan ini tidak tersedia.' : 'The testimony for this finding is unavailable.'}
    </p>{/if}
  <section class="question" data-tour="finding-question">
    <h3>{id ? 'Pertanyaan untuk saksi' : 'Suggested question'}</h3>
    <blockquote bind:this={question}>{f.question}</blockquote>
    <button class="ev-button" onclick={copy}
      ><Copy size={15} />{id ? 'Salin pertanyaan' : 'Copy question'}</button
    >
    {#if manualCopy}<p class="ev-meta" role="status">
        {id
          ? 'Seleksi sudah disiapkan. Salin secara manual.'
          : 'The question is selected. Use your copy shortcut.'}
      </p>{/if}
  </section>
  <div class="ev-actions">
    {#if testimony && hearing?.audio}<a class="ev-button" href={testimony.href + '&play=1'}
        ><Play size={15} />{id ? 'Putar dari sini' : 'Play from here'}</a
      >{/if}
    {#if line}<button class="ev-button" disabled={busy} aria-pressed={!!line.flagged} onclick={toggleBookmark}
        ><Bookmark size={15} />{line.flagged
          ? id
            ? 'Tersimpan'
            : 'Bookmarked'
          : id
            ? 'Simpan pernyataan'
            : 'Bookmark line'}</button
      >{/if}
    <a class="ev-button" href={assistantPath(w, { kind: 'finding', id: f.id })}
      ><MessageSquare size={15} />{id ? 'Tanya asisten' : 'Ask assistant'}</a
    >
    <a class="ev-button" href={boardPath(w, { kind: 'finding', id: f.id })}
      ><PanelsTopLeft size={15} />{id ? 'Taruh di papan' : 'Put on board'}</a
    >
  </div>
  <section class="review" data-tour="finding-review">
    <h3>{id ? 'Pemeriksaan Anda' : 'Your review'}</h3>
    <label class="ev-field-label"
      >{id ? 'Catatan pemeriksaan' : 'Review note'}<textarea
        bind:this={notes}
        class="ev-textarea"
        rows="3"
        bind:value={note}
        placeholder={id ? 'Apa yang perlu ditindaklanjuti?' : 'What needs following up?'}
      ></textarea></label
    >
    <div class="ev-actions">
      <button class="ev-button primary" disabled={busy} onclick={() => save(true)}
        >{#if f.reviewed}<RotateCcw size={16} />{id ? 'Buka kembali' : 'Reopen'}{:else}<Check size={16} />{id
            ? 'Tandai diperiksa'
            : 'Mark checked'}{/if}</button
      >
      <button class="ev-button" disabled={busy || note === f.note} onclick={() => save()}
        ><Pencil size={15} />{id ? 'Simpan catatan' : 'Save note'}</button
      >
    </div>
  </section>
  <details class="reason">
    <summary>{id ? 'Mengapa temuan ini ditampilkan?' : 'Why is this shown?'}<ChevronDown size={16} /></summary
    >
    <div>
      <p>{local(f.explanation, lang)}</p>
      <h3>{id ? 'Yang perlu diverifikasi' : 'What to verify'}</h3>
      <p>{local(f.verify, lang)}</p>
      {#if f.uncertainty}<h3>{id ? 'Ketidakpastian' : 'Uncertainty'}</h3>
        <p>{local(f.uncertainty, lang)}</p>{/if}
      {#if f.legal?.length}<section class="law">
          <h3>{id ? 'Rujukan hukum' : 'Legal references'}</h3>
          {#each f.legal as lawId}{@const law = w.legal.find((l) => l.id === lawId)}{#if law}<button
                class="ev-button"
                onclick={() => (target = { kind: 'legal', id: lawId })}
                ><BookOpenText size={16} />{law.article} · {law.regulation}<ArrowUpRight size={14} /></button
              >{/if}{/each}
        </section>{/if}
    </div>
  </details>
  {#if feedback}<p role="status" class="ev-meta">{feedback}</p>{/if}{#if problem}<p
      class="ev-error"
      role="alert"
    >
      {problem}
    </p>{/if}
</article>
{#if target}<Inspector workspace={w} {lang} {target} close={() => (target = null)} />{/if}

<style>
  .detail {
    background: var(--surface);
    border: 1px solid var(--line);
    padding: clamp(1rem, 2.6vw, 2.25rem);
    border-radius: 0.7rem;
    min-width: 0;
    container: finding / inline-size;
    line-height: 1.6;
  }
  .detail h2 {
    margin: 0.55rem 0 1.3rem;
    font-size: 2rem;
  }
  .detail h3,
  .question h3 {
    font: 600 0.93rem/1.35 var(--sans);
    margin: 0.2rem 0 0.65rem;
  }
  .detail p {
    max-width: 72ch;
    margin: 0.8rem 0;
  }
  .flag span {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--ev-conflicts);
  }
  .flag[data-status='context_needed'] span {
    background: var(--ev-context);
  }
  .flag[data-status='supported'] span {
    background: var(--ev-supports);
  }
  .flag[data-status='insufficient_evidence'] span {
    background: var(--muted);
  }
  .finding-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--muted);
  }
  .evidence-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    align-items: stretch;
    gap: 1rem;
    border-block: 1px solid var(--line);
    padding: 1rem 0;
    margin: 1rem 0;
  }
  .evidence-pair h3 {
    display: flex;
    align-items: center;
    gap: 0.44rem;
    color: var(--muted);
    font-size: 0.76rem;
    margin: 0 0 0.65rem;
    min-height: 22px;
  }
  .spoken,
  .filed {
    min-width: 0;
    padding: 0.85rem 0.9rem;
    display: flex;
    flex-direction: column;
  }
  .spoken {
    padding-inline-start: 0;
  }
  .filed {
    background: var(--paper);
    border-radius: 0.25rem 0.45rem 0.25rem 0.25rem;
  }
  .speaker-disc {
    display: grid;
    place-items: center;
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: var(--wash);
    color: var(--ink);
    font: 650 0.59rem/1 var(--sans);
  }
  .spoken blockquote {
    margin: 0;
    font: 500 1.09rem/1.5 var(--sans);
  }
  .filed blockquote {
    margin: 0;
    font: 400 0.98rem/1.49 var(--mono);
    overflow-wrap: anywhere;
  }
  .source-foot {
    display: grid;
    gap: 0;
    justify-items: start;
    margin-top: auto;
    padding-top: 0.6rem;
  }
  .filed .source-foot {
    padding-top: 0.55rem;
  }
  .byline {
    font: 650 0.76rem/1.4 var(--sans);
    color: var(--ink);
  }
  .under {
    display: inline-flex;
    align-items: center;
    gap: 0.23rem;
    min-height: 32px;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    font: 600 0.73rem/1.45 var(--sans);
    color: var(--accent);
  }
  .source-tabs {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    border-top: 1px solid var(--line);
    padding-top: 0.5rem;
    margin-top: 0.4rem;
  }
  .source-tabs button {
    border: 1px solid transparent;
    border-radius: 0.3rem;
    min-height: 32px;
    padding: 0.2rem 0.5rem;
    background: transparent;
    color: var(--muted);
    font: 600 0.73rem/1.4 var(--sans);
    cursor: pointer;
    text-align: start;
  }
  .source-tabs button[aria-selected='true'] {
    background: var(--surface);
    border-color: var(--line);
    color: var(--ink);
  }
  .reason {
    border-top: 1px solid var(--line);
    margin-top: 1rem;
  }
  .reason summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
    list-style: none;
  }
  .reason summary::-webkit-details-marker {
    display: none;
  }
  .reason[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .reason > div {
    padding-bottom: 0.25rem;
  }
  .reason > div > p {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .reason h3 {
    margin-bottom: 0;
  }
  .reason h3 + p {
    margin-top: 0.2rem;
  }
  .question {
    padding: 1.1rem;
    margin: 1.2rem 0;
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--accent) 6%, var(--paper));
  }
  .question blockquote {
    font: 400 1.45rem/1.27 var(--display);
    margin: 0.4rem 0 0.75rem;
  }
  .review,
  .law {
    border-top: 1px solid var(--line);
    padding-top: 1.1rem;
    margin-top: 1.2rem;
  }
  @container finding (max-width:559px) {
    .evidence-pair {
      grid-template-columns: 1fr;
      gap: 0.45rem;
    }
  }
  @container finding (max-width:650px) {
    .detail h2 {
      font-size: 1.65rem;
    }
  }
</style>
