<script lang="ts">
  import { ArrowUpRight } from '@lucide/svelte';
  import type { Lang, SessionInfo, Workspace } from '@jude/core/domain';
  let { workspace, account, lang }: { workspace: Workspace; account: SessionInfo; lang: Lang } = $props();
  const en = $derived(lang === 'en');
  const passage = $derived(workspace.passages.find(p => p.id === account.demo?.refs.d3p2));
  const document = $derived(workspace.documents.find(d => d.id === passage?.docId));
</script>

<div class="practice-prompt">
  <h3>{en ? 'Try saying this as Rina' : 'Coba ucapkan sebagai Rina'}</h3>
  <blockquote>{en ? '“I’m Rina Hartati. I first entered the East Gate at 9:30 p.m.”' : '“Saya Rina Hartati. Saya baru masuk Gerbang Timur pukul setengah sepuluh malam.”'}</blockquote>
  {#if passage && document}
    <a href={'/case/' + workspace.caseRecord.id + '/documents/' + document.id + '?p=' + encodeURIComponent(passage.id)}>
      {en ? 'East Gate access log' : 'Log akses Gerbang Timur'} · 20:07:41 <ArrowUpRight size={13}/>
    </a>
  {/if}
</div>

<style>
  .practice-prompt { display:grid; gap:6px; margin:0; padding:14px 16px; border-radius:8px; background:var(--selected,var(--wash)); color:var(--ink); }
  h3 { margin:0; font:600 .82rem/1.4 var(--sans); }
  blockquote { margin:0; max-width:58ch; font:400 1.25rem/1.28 var(--display); text-wrap:pretty; }
  a { display:inline-flex; align-items:center; gap:3px; justify-self:start; margin-top:2px; color:var(--ink); font:600 .8rem/1.5 var(--sans); text-underline-offset:3px; }
</style>
