<script lang="ts">
  import { CircleAlert, FileText, FolderOpen, Speech } from '@lucide/svelte';
  import type { CaseSummary, Lang } from '@jude/core/domain';

  let { item, lang, updated }: { item: CaseSummary; lang: Lang; updated: string } = $props();
  const en = $derived(lang === 'en');
  const href = $derived('/case/' + encodeURIComponent(item.id));
</script>

<article class="file-card">
  <div class="identity">
    <span class="kind"><FolderOpen size={19} strokeWidth={1.6}/><span>{item.label === 'synthetic' ? (en ? 'Synthetic material' : 'Materi sintetis') : (en ? 'Private case' : 'Perkara privat')}</span></span>
    {#if item.live}
      <span class="live" title={en ? 'Hearing live now' : 'Sidang langsung sedang berjalan'}>
        <i aria-hidden="true"></i><span aria-hidden="true">{en ? 'Live' : 'Langsung'}</span>
        <span class="sr-only">{en ? 'Hearing live now' : 'Sidang langsung sedang berjalan'}</span>
      </span>
    {/if}
  </div>
  <div class="details">
    <h2><a id={'register-case-' + item.id} href={href}>{item.title}</a></h2>
    {#if item.reference}<p class="reference">{item.reference}</p>{/if}
    {#if item.summary[lang]}<p class="summary">{item.summary[lang]}</p>{/if}
  </div>
  <footer>
    <div class="metrics">
      <span><Speech size={16}/>{item.counts.hearings} {en ? (item.counts.hearings === 1 ? 'hearing' : 'hearings') : 'sidang'}</span>
      <span><FileText size={16}/>{item.counts.documents} {en ? (item.counts.documents === 1 ? 'document' : 'documents') : 'dokumen'}</span>
      {#if item.counts.needsLook}
        <a class="review" href={href + '/findings'} title={en ? 'See all in Findings' : 'Lihat semua di Temuan'}>
          <span><CircleAlert size={14}/>{item.counts.needsLook} {en ? 'to check' : 'perlu dicek'}</span>
        </a>
      {/if}
    </div>
    <p class="updated">{en ? 'Updated' : 'Diperbarui'} <time datetime={item.updated}>{updated}</time></p>
  </footer>
</article>

<style>
  .file-card{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0;height:100%;padding:18px 20px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);transition:border-color .17s ease-out,box-shadow .22s ease-out}
  .identity,.kind,.live,.metrics,.metrics > span,.review,.review span{display:flex;align-items:center}
  .identity{justify-content:space-between;gap:8px;min-height:22px}
  .kind{gap:8px;color:var(--muted);font-size:12px;font-weight:600;line-height:1.35}
  .kind :global(svg){flex:none}
  .kind > span{border-radius:4px;background:var(--wash);padding:2px 7px}
  .live{gap:6px;flex:none;min-height:22px;padding:2px 9px;border-radius:20px;color:#8e3c32;background:#f6e4df;font-size:12px;font-weight:600}
  .live i{width:7px;height:7px;background:currentColor;border-radius:50%}
  .details{min-width:0}
  h2{font:400 23px/1.18 Rufina,Georgia,serif;letter-spacing:-.022em;text-wrap:initial;overflow-wrap:anywhere}
  h2 a{color:var(--ink);text-decoration:none}
  h2 a::after{content:'';position:absolute;inset:0;border-radius:12px}
  h2 a:focus-visible{outline:none}
  h2 a:focus-visible::after{outline:3px solid #a8732a;outline-offset:3px}
  .reference,.updated{color:var(--muted);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}
  .reference{margin-top:5px;overflow-wrap:anywhere}
  .summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;margin-top:12px;color:var(--ink);font-size:13px;line-height:1.55;overflow-wrap:anywhere}
  footer{margin-top:auto;border-top:1px solid var(--line);padding-top:8px}
  .metrics{flex-wrap:wrap;gap:2px 14px;min-height:35px}
  .metrics > span,.review{font-size:13px;white-space:nowrap}
  .metrics > span{gap:5px}
  .metrics > span :global(svg){color:var(--muted);flex:none}
  .review{position:relative;z-index:1;min-height:32px;text-decoration:none}
  .review span{gap:5px;border-radius:5px;background:#f4e7c9;color:#715017;padding:3px 7px;font-size:12px;font-weight:600}
  .review:hover span{text-decoration:underline;text-underline-offset:2px}
  .updated{margin-top:2px}
  :global([data-theme=night]) .live{background:#50352e;color:#f1b3a6}
  :global([data-theme=night]) .review span{background:#4c4027;color:#f1d49a}
  @media(hover:hover){.file-card:has(h2 a:hover){border-color:var(--muted);box-shadow:0 4px 13px #19271e10}}
  @media(pointer:coarse){.review{min-height:44px}}
</style>
