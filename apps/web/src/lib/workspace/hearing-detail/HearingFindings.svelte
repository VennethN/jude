<script lang="ts">
  import { ArrowUpRight, ListFilter } from '@lucide/svelte';
  import { needsReview, type Finding, type Lang } from '@jude/core/domain';
  import { statuses } from '$lib/evidence/records';
  import { timecode } from '../format';

  let { findings, times, casePath, hearingId, lang, live = false, bookmarked = false, onPreview }: {
    findings: Finding[];
    times: Map<string, number>;
    casePath: string;
    hearingId: string;
    lang: Lang;
    live?: boolean;
    bookmarked?: boolean;
    onPreview?: (finding: Finding) => void;
  } = $props();
  const en = $derived(lang === 'en');
  const attention = $derived(findings.filter(needsReview));
  const shown = $derived((attention.length ? attention : findings).slice(0, 4));
  const id = $props.id();

  function preview(event: MouseEvent, finding: Finding) {
    if (!onPreview || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onPreview(finding);
  }
</script>

<section class="finding-index" aria-labelledby={id} data-tour="hearing-findings">
  <header>
    <ListFilter size={21} strokeWidth={1.8} aria-hidden="true" />
    <h2 {id}>{en ? 'Hearing findings' : 'Temuan sidang'}</h2>
    <span class="total" aria-label={findings.length + (en ? ' findings' : ' temuan')}>{String(findings.length).padStart(2, '0')}</span>
  </header>
  {#if findings.length}
    <ul>
      {#each shown as finding (finding.id)}
        <li><a href={casePath + '/findings/' + encodeURIComponent(finding.id)} onclick={(event) => preview(event, finding)}>
          <span class="metadata">{#if times.has(finding.statementId)}{timecode(times.get(finding.statementId)!)} · {/if}{statuses[finding.status][lang]}</span>
          <strong>{finding.title[lang]}</strong>
        </a></li>
      {/each}
    </ul>
    <a class="index-link" href={casePath + '/findings?hearing=' + encodeURIComponent(hearingId)}>
      {en ? 'All findings in this hearing' : 'Semua temuan sidang ini'}<ArrowUpRight size={15} />
    </a>
  {:else}
    <p class="empty">{live
      ? (en ? 'Findings linked to testimony will appear here.' : 'Temuan yang berkaitan dengan ucapan akan muncul di sini.')
      : (en ? 'No findings have been filed for this hearing.' : 'Belum ada temuan dalam sidang ini.')}</p>
  {/if}
  {#if bookmarked}<a class="index-link" href={casePath + '/findings?tab=saved&hearing=' + encodeURIComponent(hearingId)}>
    {en ? 'Bookmarked testimony' : 'Ucapan yang ditandai'}<ArrowUpRight size={15} />
  </a>{/if}
</section>

<style>
  .finding-index { min-width:0; border-top:2px solid var(--ink-strong,var(--ink)); color:var(--ink-strong,var(--ink)); }
  header { display:flex; align-items:center; gap:9px; min-height:59px; border-bottom:1px solid var(--line); }
  header h2 { margin:0; font:400 24px/1.12 var(--display); letter-spacing:-.025em; }
  .total { margin-left:auto; color:var(--muted); font:600 13px/1.4 var(--sans); font-variant-numeric:tabular-nums; letter-spacing:.12em; }
  ul { list-style:none; margin:0; padding:0; }
  li { border-bottom:1px solid var(--line); }
  li a { display:grid; align-content:center; gap:6px; min-height:85px; padding:16px 0; color:inherit; text-decoration:none; }
  .metadata { color:#874d60; font:400 13px/1.4 var(--mono); letter-spacing:.01em; font-variant-numeric:tabular-nums; }
  :global([data-theme=night]) .metadata { color:#e8acbc; }
  li strong { font:400 22px/1.24 var(--display); letter-spacing:-.015em; overflow-wrap:anywhere; }
  li a:hover strong { text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:.15em; }
  .index-link { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:9px 0; color:var(--muted); font:650 14px/1.4 var(--sans); text-decoration:none; }
  .index-link:hover { color:var(--ink); text-decoration:underline; }
  .empty { margin:0; padding:14px 0; color:var(--muted); font-size:14px; }
  @media(prefers-reduced-motion:no-preference) { .index-link, li a { transition:color 170ms cubic-bezier(.22,1,.36,1); } }
</style>
