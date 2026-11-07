<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { ArrowLeft, Bookmark, CheckCheck, ClipboardList, PanelsTopLeft, Search } from '@lucide/svelte';
  import type { PageData } from './$types';
  import type { Finding } from '$lib/domain';
  import { casePath, clock, local, meaningful, statuses } from '$lib/evidence/records';
  import FindingDetail from '$lib/evidence/FindingDetail.svelte';
  import SavedLines from '$lib/evidence/SavedLines.svelte';
  import BoardView from '$lib/evidence/BoardView.svelte';
  import '$lib/evidence/evidence.css';

  let {data}:{data:PageData}=$props();
  let w=$derived(data.workspace), lang=$derived(data.lang), id=$derived(lang==='id');
  let base=$derived(casePath(w)+'/findings');
  let opened=$derived(page.params.findingId);
  let requested=$derived(opened?w.findings.find(f=>f.id===opened):undefined);
  let tab=$derived(page.url.searchParams.get('tab')||(requested?(requested.reviewed?'checked':meaningful(requested.status)?'attention':'others'):'attention'));
  let board=$derived(page.url.searchParams.get('view')==='board');
  let byH=$derived(page.url.searchParams.get('hearing')||''), byD=$derived(page.url.searchParams.get('doc')||'');
  let query=$state('');
  let filtered=$derived(w.findings.filter(f=>(!byH||f.hearingId===byH)&&(!byD||f.sources.some(s=>w.passages.find(p=>p.id===s.passageId)?.docId===byD))));
  let checked=$derived(filtered.filter(f=>f.reviewed));
  let attention=$derived(filtered.filter(f=>!f.reviewed&&meaningful(f.status)));
  let others=$derived(filtered.filter(f=>!f.reviewed&&!meaningful(f.status)));
  let list=$derived((tab==='checked'?checked:tab==='others'?others:attention).filter(f=>!query.trim()||(local(f.title,lang)+' '+f.said+' '+f.question).toLowerCase().includes(query.trim().toLowerCase())));
  let active=$derived(requested || (!opened ? list[0] : undefined));
  function href(changes:Record<string,string|null>,f?:Finding) {
    const qp=new URLSearchParams(page.url.searchParams);
    for(const [k,v] of Object.entries(changes))v===null?qp.delete(k):qp.set(k,v);
    return base+(f?'/'+encodeURIComponent(f.id):'')+(qp.size?'?'+qp:'');
  }
  let tabs=$derived([
    {code:'attention',text:id?'Perlu dicek':'Needs a look',count:attention.length},
    {code:'checked',text:id?'Diperiksa':'Checked',count:checked.length},
    {code:'others',text:id?'Lainnya':'Others',count:others.length},
    {code:'saved',text:id?'Tersimpan':'Bookmarked',count:w.statements.filter(s=>s.flagged&&(!byH||s.hearingId===byH)).length}
  ]);
</script>
<svelte:head><title>{board?(id?'Papan temuan':'Case board'):(id?'Temuan':'Findings')} · Jude</title></svelte:head>
<div class="ev-page">
  <header class="ev-head"><div><h1>{board?(id?'Papan temuan':'Case board'):(id?'Temuan':'Findings')}</h1><p>{board?(id?'Susun bukti dan catatan untuk pemeriksaan Anda.':'Arrange the evidence and your review notes.'):(id?'Bandingkan keterangan dengan berkas, lalu catat hasil pemeriksaan.':'Compare testimony with the record and keep your review notes together.')}</p></div>
    <a class="ev-button" data-tour="board-open" href={board?base:base+'?view=board'}>{#if board}<ClipboardList size={16}/>{id?'Daftar temuan':'Findings list'}{:else}<PanelsTopLeft size={16}/>{id?'Buka papan':'Open board'}{/if}</a>
  </header>
  {#if board}
    <BoardView workspace={w} {lang}/>
  {:else}
    <nav class="ev-tabs" aria-label={id?'Filter temuan':'Findings filters'} data-tour="findings-tabs">
      {#each tabs as t}<a href={href({tab:t.code})} aria-current={tab===t.code?'page':undefined}>{t.text} <span>{t.count}</span></a>{/each}
    </nav>
    <div class="ev-inline filters">
      {#if tab!=='saved'}<label class="ev-search"><Search size={16}/><input type="search" bind:value={query} aria-label={id?'Cari temuan':'Search findings'} placeholder={id?'Cari temuan…':'Find a finding…'}/></label>{/if}
      <select class="ev-select" aria-label={id?'Filter sidang':'Filter by hearing'} value={byH} onchange={e=>goto(href({hearing:e.currentTarget.value||null}))}><option value="">{id?'Semua sidang':'All hearings'}</option>{#each w.hearings as h}<option value={h.id}>{id?'Sidang':'Hearing'} {h.number}</option>{/each}</select>
      {#if byD}<a class="ev-link" href={href({doc:null})}>{id?'Hapus filter dokumen':'Clear document filter'}</a>{/if}
    </div>
    {#if tab==='saved'}<SavedLines workspace={w} {lang} hearing={byH} selected={page.url.searchParams.get('s')??''}/>
    {:else if opened && !requested}<div class="ev-empty"><h2 class="ev-title">{id?'Temuan tidak ditemukan':'Finding not found'}</h2><a class="ev-link" href={base}>{id?'Kembali ke temuan':'Back to findings'}</a></div>
    {:else if list.length || requested}
      <div class="review-grid" class:detail-open={!!opened}>
        <div class="queue" data-tour="findings-queue"><ul class="ev-list">{#each list as f (f.id)}
          {@const h=w.hearings.find(h=>h.id===f.hearingId)}{@const s=w.statements.find(s=>s.id===f.statementId)}
          <li><a class="ev-pick" href={href({tab},f)} aria-current={active?.id===f.id?'page':undefined}><span class="ev-cap status" data-status={f.status}>{#if f.reviewed}<CheckCheck size={14}/>{/if}{statuses[f.status][lang]}</span><strong>{local(f.title,lang)}</strong><span class="ev-meta">{id?'Sidang':'Hearing'} {h?.number} · {clock(s?.t??0)}</span></a></li>
        {/each}</ul></div>
        {#if active}<div class="detail-pane"><a class="mobile-back ev-link" href={href({tab})}><ArrowLeft size={15}/>{id?'Daftar temuan':'Findings list'}</a>{#key active.id}<FindingDetail workspace={w} {lang} finding={active}/>{/key}</div>{/if}
      </div>
    {:else}<div class="ev-empty">{#if tab==='checked'}<CheckCheck size={25}/>{:else if tab==='others'}<Bookmark size={25}/>{:else}<ClipboardList size={25}/>{/if}<h2 class="ev-title">{query?(id?'Tidak ada hasil':'No results'):tab==='attention'?(id?'Tidak ada temuan yang perlu dicek':'Nothing needs a look'):tab==='checked'?(id?'Belum ada temuan yang diperiksa':'No checked findings yet'):(id?'Belum ada temuan lain':'No other findings')}</h2></div>{/if}
  {/if}
</div>
<style>
  .filters{margin-bottom:1rem}.ev-tabs span{font-variant-numeric:tabular-nums;margin-left:.15rem;font-size:.73rem;color:var(--muted)}.review-grid{display:grid;grid-template-columns:minmax(12rem,31%) minmax(0,1fr);gap:1.1rem;align-items:start}.queue .ev-pick{padding:.9rem .7rem}.queue strong{display:block;line-height:1.45;margin:.35rem 0 .4rem}.status{color:var(--muted)}.status[data-status=potential_inconsistency]{color:var(--accent)}.mobile-back{display:none}.detail-pane{min-width:0}.queue{max-height:75vh;overflow:auto}
  @container (max-width:740px){.review-grid{display:block}.review-grid:not(.detail-open) .detail-pane,.detail-open .queue{display:none}.queue{max-height:none}.mobile-back{display:inline-flex}.filters .ev-search{flex:1;min-width:min(100%,12rem)}}
</style>

