<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';
  import type { Finding, Lang, Workspace } from '@jude/core/domain';
  import FindingLink from '$lib/evidence/FindingLink.svelte';
  import ReviewMark from '$lib/evidence/ReviewMark.svelte';
  import { casePath, local } from '$lib/evidence/records';

  let { workspace, lang, alerts, hearingId, selected = '', onPreview }: {
    workspace: Workspace;
    lang: Lang;
    alerts: Finding[];
    hearingId: string;
    selected?: string;
    onPreview: (finding: Finding) => void;
  } = $props();

  const en = $derived(lang === 'en');
  const title = $derived(en ? 'Hearing findings' : 'Temuan sidang');
  const top = $derived(alerts[0]);
  const more = $derived(alerts.slice(1));
  let announcement = $state('');
  let previousHearing = '', known = new Set<string>();
  $effect(() => {
    if (previousHearing === hearingId && top && !known.has(top.id)) announcement = title + ' · ' + local(top.title, lang);
    else if (previousHearing !== hearingId) announcement = '';
    previousHearing = hearingId;
    known = new Set(alerts.map(finding => finding.id));
  });
</script>

{#if top}
  <section class="attention" aria-label={en ? 'Latest finding' : 'Temuan terbaru'} data-tour="live-attention">
    {#key top.id}
      <div class="featured">
        <FindingLink {workspace} finding={top} {lang} variant="lead" selected={selected === top.id} {onPreview}/>
      </div>
    {/key}
    {#if more.length}
      <a class="more" href={casePath(workspace) + '/findings?hearing=' + encodeURIComponent(hearingId)}>
        <span class="marks" aria-hidden="true">{#each more.slice(0,3) as item (item.id)}
          <ReviewMark status={item.status} size={20}/>{/each}</span>
        <span class="number">{more.length} {en ? 'more to check' : 'lainnya perlu dicek'}</span>
        <span class="more-text">{en ? 'See all in Findings' : 'Lihat semua di Temuan'}</span><ArrowRight size={14} aria-hidden="true"/>
      </a>
    {/if}
  </section>
{/if}
<span class="sr-only" role="status" aria-atomic="true">{announcement}</span>

<style>
  .attention { display:grid; align-content:start; gap:8px; min-width:0; }
  .more { display:flex; align-items:center; gap:10px; min-height:44px; padding:8px 14px 8px 12px; border:1px solid var(--line); border-radius:8px;
    background:var(--surface); color:var(--ink-strong); text-decoration:none; font:600 13.5px/1.4 var(--sans); transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur) var(--ease-out); }
  .more:hover { border-color:var(--line-strong); box-shadow:var(--shadow-raise); }
  .marks { display:flex; }
  .marks :global(.review-mark) { margin-right:-5px; outline:2px solid var(--surface); }
  .number { flex:1; margin-left:6px; }
  .more-text { color:var(--muted); font-size:13px; }
  @media(max-width:560px) { .more-text { display:none; } }
  @media(prefers-reduced-motion:no-preference) {
    .featured { animation:arrive 280ms cubic-bezier(.22,1,.36,1) both; }
  }
  @keyframes arrive { from { opacity:0; transform:translateY(-14px); } to { opacity:1; transform:translateY(0); } }
</style>
