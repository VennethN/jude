<script lang="ts">
  import { findingQuestion } from '$lib/workspace/format';
  import StatusChip from './StatusChip.svelte';
  import FindingComparison from './FindingComparison.svelte';
  import FindingPager, { type FindingNavigation } from './FindingPager.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import {
    Check,
    Pencil,
    RotateCcw,
    Copy,
    MessageSquare,
    PanelsTopLeft,
    ArrowUpRight,
    Bookmark,
    BookOpenText,
    NotebookPen,
    ChevronDown
  } from '@lucide/svelte';
  import { ApiError, write } from '$lib/client';
  import type { Finding, InspectTarget, Lang, Workspace } from '@jude/core/domain';
  import { apiPath, assistantPath, boardPath, local } from './records';
  import Inspector from './Inspector.svelte';

  let {
    workspace: w,
    lang,
    finding: f,
    navigation,
    internalPager = true
  }: {
    workspace: Workspace;
    lang: Lang;
    finding: Finding;
    navigation?: FindingNavigation;
    internalPager?: boolean;
  } = $props();
  let article: HTMLElement;
  let id = $derived(lang === 'id');
  let line = $derived(w.statements.find((s) => s.id === f.statementId));
  let note = $state(untrack(() => f.note));
  let noteOpen = $state(untrack(() => !!f.note));
  async function openNote() {
    noteOpen = true;
    await tick();
    notes?.focus();
  }
  let busy = $state(false),
    feedback = $state(''),
    problem = $state(''),
    manualCopy = $state(false);
  let target = $state<InspectTarget | null>(null);
  let notes = $state<HTMLTextAreaElement>();
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
      problem = e instanceof ApiError ? e.message : id ? 'Gagal menyimpan.' : 'Could not save.';
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
      problem = e instanceof ApiError ? e.message : id ? 'Perubahan gagal.' : 'Change failed.';
    } finally {
      busy = false;
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(findingQuestion(f, lang));
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
      [...document.querySelectorAll('dialog[open]')].some((dialog) => !dialog.contains(article)) ||
      (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input,textarea,select')))
    )
      return;
    if (e.key === 'r') {
      e.preventDefault();
      void save(true);
    }
    if (e.key === 'n') {
      e.preventDefault();
      void openNote();
    }
    if (navigation && (e.key === 'j' || e.key === 'k')) {
      e.preventDefault();
      navigation.step(e.key === 'j' ? 1 : -1);
    }
  }
  onMount(() => {
    if (f.isNew)
      void write(apiPath(w, 'findings/' + encodeURIComponent(f.id)), 'PATCH', { isNew: false }).catch(() => {});
  });
</script>

<svelte:window onkeydown={shortcut} />
<article class="detail" data-tour="finding-detail" bind:this={article}>
  <div class="finding-meta">
    <StatusChip status={f.status} {lang} />
    {#if f.reviewed}<span class="checked"><Check size={12} />{id ? 'Sudah dicek' : 'Checked'}</span>{/if}
    {#if navigation && internalPager}<FindingPager {navigation} {lang} />{/if}
  </div>
  <h2 class="ev-title">{local(f.title, lang)}</h2>
  <FindingComparison workspace={w} finding={f} {lang} />
  <section class="question" data-tour="finding-question">
    <h3>{id ? 'Bisa ditanyakan' : 'You could ask'}</h3>
    <blockquote bind:this={question} lang={f.questionTranslation ? lang : 'id'}>{findingQuestion(f, lang)}</blockquote>
    {#if lang === 'en' && !f.questionTranslation}<p class="ev-meta">Saved courtroom draft · original wording</p>{/if}
    <button class="text-link" onclick={copy}><Copy size={15} />{id ? 'Salin pertanyaan' : 'Copy question'}</button>
    {#if manualCopy}<p class="ev-meta" role="status">
        {id ? 'Seleksi sudah disiapkan. Salin secara manual.' : 'The question is selected. Use your copy shortcut.'}
      </p>{/if}
  </section>
  <div class="ev-actions finding-actions" data-tour="finding-review">
    <button class="ev-button" class:primary={!f.reviewed} disabled={busy} onclick={() => save(true)}
      >{#if f.reviewed}<RotateCcw size={15} />{id ? 'Buka kembali' : 'Reopen'}{:else}<Check size={15} />{id
          ? 'Tandai diperiksa'
          : 'Mark checked'}{/if}</button
    >
    <a class="ev-button" href={assistantPath(w, { kind: 'finding', id: f.id })}
      ><MessageSquare size={15} />{id ? 'Tanya asisten' : 'Ask assistant'}</a
    >
    <a class="ev-button" href={boardPath(w, { kind: 'finding', id: f.id })}
      ><PanelsTopLeft size={15} />{id ? 'Taruh di papan temuan' : 'Put on the findings board'}</a
    >
  </div>
  {#if noteOpen || f.note}
    <div class="review-note">
      <label class="ev-field-label"
        >{id ? 'Catatan pemeriksaan' : 'Review note'}<textarea
          class="ev-textarea"
          bind:this={notes}
          rows="3"
          bind:value={note}
          placeholder={id ? 'Apa yang perlu ditindaklanjuti?' : 'What needs following up?'}
        ></textarea></label
      >
      <div class="note-foot">
        {#if note !== f.note}<span role="status">{id ? 'Belum disimpan' : 'Unsaved'}</span>{/if}
        <button class="ev-button" disabled={busy || note === f.note} onclick={() => save()}
          ><Pencil size={14} />{id ? 'Simpan catatan' : 'Save note'}</button
        >
      </div>
    </div>
  {/if}
  <div class="utilities">
    {#if !noteOpen && !f.note}<button class="text-link" onclick={openNote}
        ><NotebookPen size={14} />{id ? 'Tambah catatan' : 'Add a note'}</button
      >{/if}
    {#if line}<button class="text-link" aria-pressed={!!line.flagged} disabled={busy} onclick={toggleBookmark}>
        <Bookmark size={14} fill={line.flagged ? 'currentColor' : 'none'} />{line.flagged
          ? id
            ? 'Tersimpan'
            : 'Bookmarked'
          : id
            ? 'Simpan pernyataan'
            : 'Bookmark line'}</button
      >{/if}
  </div>
  <details class="reason">
    <summary>{id ? 'Mengapa temuan ini ditampilkan?' : 'Why is this shown?'}<ChevronDown size={16} /></summary>
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
      <p class="source-note">
        {id
          ? 'Temuan menggambarkan hubungan bukti. Penilaian kredibilitas, kesalahan, dan putusan adalah kewenangan pengadilan.'
          : 'Findings describe evidence relationships. The court determines credibility, guilt and outcomes.'}
      </p>
    </div>
  </details>
  {#if feedback}<p role="status" class="ev-meta">{feedback}</p>{/if}{#if problem}<p class="ev-error" role="alert">
      {problem}
    </p>{/if}
</article>
{#if target}<Inspector workspace={w} {lang} {target} close={() => (target = null)} />{/if}

<style>
  .detail {
    display: grid;
    gap: 18px;
    padding: 22px 24px 24px;
    min-width: 0;
    container: finding / inline-size;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: 400 14px/1.55 var(--sans);
  }
  :global(dialog.sheet) .detail {
    border: 0;
    border-radius: 0;
  }
  .finding-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .detail > h2 {
    margin: -8px 0 0;
    color: var(--ink-strong);
    font: 400 clamp(22px, 2.2vw, 27px)/1.2 var(--display);
    letter-spacing: -0.005em;
  }
  .checked {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--selected);
    color: var(--ink-strong);
    font-size: 12px;
    font-weight: 600;
  }
  .question {
    display: grid;
    gap: 6px;
    padding: 16px 18px;
    background: var(--selected);
    border-radius: 12px;
  }
  .question h3,
  .reason h3 {
    margin: 0;
    color: var(--muted);
    font: 600 11.5px/1.55 var(--sans);
    letter-spacing: 0.01em;
  }
  .question h3 {
    color: var(--muted-on-fill);
  }
  .question blockquote {
    margin: 0;
    color: var(--ink-strong);
    font: 400 20px/1.35 var(--display);
  }
  .text-link {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 6px;
    min-height: 28px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-strong);
    font: 500 13px/1.45 var(--sans);
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 4px;
  }
  .text-link:hover {
    text-decoration-color: currentColor;
  }
  .finding-actions,
  .utilities {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .utilities {
    gap: 6px 18px;
  }
  .finding-actions .ev-button,
  .review-note .ev-button,
  .law .ev-button {
    min-height: 36px;
    padding: 5px 12px;
    gap: 6px;
    border-color: var(--line-strong);
    border-radius: 6px;
    font: 500 13px/1.35 var(--sans);
  }
  .finding-actions .ev-button.primary {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-ink);
  }
  .review-note {
    display: grid;
    gap: 8px;
  }
  .review-note .ev-field-label {
    margin: 0;
  }
  .note-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .note-foot span {
    margin-right: auto;
    padding: 3px 8px;
    border-radius: 4px;
    background: var(--st-inconsistency-bg);
    color: var(--st-inconsistency-ink);
    font-size: 12px;
    font-weight: 600;
  }
  .reason {
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .reason summary {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-height: 32px;
    width: fit-content;
    cursor: pointer;
    list-style: none;
    color: var(--ink-strong);
    font: 600 13px/1.5 var(--sans);
  }
  .reason summary::-webkit-details-marker {
    display: none;
  }
  .reason summary :global(svg) {
    order: -1;
    transform: rotate(-90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .reason[open] summary :global(svg) {
    transform: rotate(0deg);
  }
  .reason > div {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
  .reason p {
    margin: 0;
  }
  .reason h3 {
    margin-top: 4px;
    font-size: 12px;
  }
  .law {
    display: grid;
    justify-items: start;
    gap: 6px;
  }
  .source-note {
    font-size: 12px;
    color: var(--muted);
  }
  @media (pointer: coarse) {
    .finding-actions .ev-button,
    .review-note .ev-button,
    .law .ev-button,
    .utilities .text-link {
      min-height: 44px;
    }
  }
</style>
