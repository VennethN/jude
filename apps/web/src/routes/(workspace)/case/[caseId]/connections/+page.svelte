<script lang="ts">
  import { displayTitle } from '$lib/workspace/format';

  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Search, FileText, ArrowRight, Link2 } from '@lucide/svelte';
  import { write } from '$lib/client';
  import type { Relation } from '@jude/core/domain';
  import type { PageData } from './$types';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import EvidenceMap from '$lib/evidence/connections/EvidenceMap.svelte';
  import GroupPanel from '$lib/evidence/connections/GroupPanel.svelte';
  import GraphIcon from '$lib/evidence/connections/GraphIcon.svelte';
  import { graphOf, groupOf } from '$lib/evidence/graph';
  import { mapText } from '$lib/evidence/connections/map-copy';
  import { relationOrder } from '$lib/evidence/connections/map-records';
  import { apiPath, casePath, nodeKey, relations } from '$lib/evidence/records';
  import '$lib/evidence/connections/connections.css';

  let { data }: { data: PageData } = $props();
  let w = $derived(data.workspace),
    lang = $derived(data.lang),
    id = $derived(lang === 'id');
  let graph = $derived(graphOf(w, lang)),
    base = $derived(casePath(w) + '/connections');
  let selected = $derived(page.url.searchParams.get('of') || page.url.searchParams.get('start') || '');
  let picked = $derived.by(() => {
    if (graph.vertices.has(selected)) return [selected];
    if (!selected.startsWith('document:')) return [];
    return w.passages.filter((p) => 'document:' + p.docId === selected).map((p) => 'passage:' + p.id);
  });
  let members = $derived(groupOf(picked, graph.adjacent));
  let hidden = $state<Relation[]>([]),
    width = $state(0);
  let modal = $state<'search' | 'pair' | null>(null),
    query = $state(''),
    pairFrom = $state(''),
    pairTo = $state(''),
    relation = $state<Relation>('related');
  let problem = $state(''),
    busy = $state(false),
    undo = $state(''),
    announcement = $state('');
  let root: HTMLElement,
    previousKey = '';
  let options = $derived(graph.nodes.filter((n) => n.ref.kind !== 'finding'));
  let eligible = $derived(
    options.filter(
      (n) =>
        n.key !== pairFrom &&
        !graph.pairs.some(
          (p) =>
            p.connectionId && ((p.from === pairFrom && p.to === n.key) || (p.to === pairFrom && p.from === n.key))
        )
    )
  );
  let resultDocs = $derived(
    w.documents.filter((d) => displayTitle(d, lang).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  );
  let hits = $derived(
    graph.nodes.filter((n) =>
      (n.source.label + ' ' + n.source.text).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    )
  );
  function search() {
    query = '';
    modal = 'search';
  }
  function startPair(key: string) {
    pairFrom = key || options[0]?.key || '';
    pairTo = '';
    relation = 'related';
    problem = '';
    modal = 'pair';
  }
  async function choose(key: string, keyboard = false) {
    modal = null;
    if (selected) previousKey = selected;
    await goto(key ? base + '?of=' + encodeURIComponent(key) : base, { noScroll: true, keepFocus: true });
    await tick();
    announcement = key
      ? (id ? 'Kelompok dipilih' : 'Group selected') +
        ' · ' +
        members.size +
        ' ' +
        (id ? 'bukti' : 'pieces of evidence')
      : mapText(lang, 'cx.map.all');
    if (key && width < 1080) {
      root.querySelector<HTMLElement>('#connection-group-name')?.focus({ preventScroll: !keyboard });
    } else if (keyboard) {
      const card = root.querySelector<HTMLElement>('[data-key="' + CSS.escape(key || previousKey) + '"]');
      card?.focus({ preventScroll: true });
    }
  }
  async function mutate(method: string, path: string, body?: unknown) {
    if (busy) return false;
    busy = true;
    problem = '';
    try {
      await write(apiPath(w, path), method, body);
      return true;
    } catch (error) {
      problem = error instanceof Error ? error.message : id ? 'Perubahan gagal.' : 'Change failed.';
      return false;
    } finally {
      busy = false;
    }
  }
  async function pair() {
    const from = nodeKey(pairFrom),
      to = nodeKey(pairTo);
    if (!from || !to) return;
    if (await mutate('POST', 'connections', { from, to, relation })) await choose(pairFrom, true);
  }
  async function remove(key: string) {
    if (await mutate('DELETE', 'connections/' + encodeURIComponent(key))) undo = key;
  }
  function panelKeys(event: KeyboardEvent) {
    if (
      !event.defaultPrevented &&
      event.key === 'Escape' &&
      !modal &&
      picked.length &&
      root.contains(event.target as Node)
    ) {
      event.preventDefault();
      void choose('', true);
    }
  }
</script>

<svelte:head><title>{mapText(lang, 'cx.title')} · Jude</title></svelte:head>
<svelte:window onkeydown={panelKeys} />
<section class="cx-page" bind:this={root} bind:clientWidth={width}>
  <header class="cx-title">
    <h1>{mapText(lang, 'cx.title')}</h1>
    <p>{mapText(lang, 'cx.lead')}</p>
  </header>
  <span role="status" class="sr-only">{announcement}</span>
  {#if problem && !modal}<p role="alert" class="cx-error">{problem}</p>{/if}
  {#if undo}<div class="cx-notice" role="status">
      {id ? 'Pasangan dihapus.' : 'Pairing removed.'}<button
        class="btn btn-sm"
        onclick={async () => {
          if (await mutate('POST', 'connections/' + encodeURIComponent(undo) + '/restore')) undo = '';
        }}>{id ? 'Urungkan' : 'Undo'}</button
      >
    </div>{/if}
  <div class="cx-split" class:side={width >= 1080 && !!picked.length}>
    <EvidenceMap
      workspace={w}
      {lang}
      {selected}
      pairings={graph.pairs}
      {members}
      {picked}
      bind:hidden
      onpick={search}
      onchoose={choose}
    />
    {#if picked.length}
      <aside class="group-panel" aria-label={mapText(lang, 'cx.map.groupLabel')}>
        <GroupPanel
          workspace={w}
          {lang}
          {members}
          {picked}
          pairings={graph.pairs}
          {busy}
          onchoose={choose}
          onpair={startPair}
          onremove={remove}
          onupdate={(key, body) => void mutate('PATCH', 'connections/' + encodeURIComponent(key), body)}
        />
      </aside>
    {/if}
  </div>
  <noscript
    ><ul>
      {#each graph.nodes as n (n.key)}<li><a href={n.source.href}>{n.source.label}</a></li>{/each}
    </ul></noscript
  >
</section>
{#if modal === 'search'}
  <Dialog title={mapText(lang, 'cx.map.pick')} {lang} close={() => (modal = null)} wide>
    <div class="cx-picker">
      <label class="search-line"
        ><Search size={17} /><input
          type="search"
          placeholder={id ? 'Cari keterangan, temuan, atau dokumen' : 'Search testimony, findings or documents'}
          aria-label={mapText(lang, 'cx.map.pick')}
          bind:value={query}
        /></label
      >
      <div class="pick-list">
        {#each resultDocs as doc (doc.id)}<button onclick={() => choose('document:' + doc.id, true)}
            ><FileText size={17} /><span
              ><strong>{displayTitle(doc, lang)}</strong><small>{id ? 'Seluruh dokumen' : 'Entire document'}</small></span
            ><ArrowRight size={15} /></button
          >{/each}
        {#each hits as n (n.key)}<button onclick={() => choose(n.key, true)}
            ><GraphIcon kind={n.ref.kind} /><span
              ><strong>{n.source.label}</strong><small lang={n.ref.kind === 'finding' ? lang : 'id'}
                >{n.source.text}</small
              ></span
            ><ArrowRight size={15} /></button
          >{/each}
        {#if !hits.length && !resultDocs.length}<p>
            {id ? 'Tidak ada bukti yang sesuai.' : 'No matching evidence.'}
          </p>{/if}
      </div>
      {#if options.length > 1}<button class="btn btn-sm" onclick={() => startPair('')}
          ><Link2 size={14} />{id ? 'Buat pasangan' : 'Create a pairing'}</button
        >{/if}
    </div>
  </Dialog>
{:else if modal === 'pair'}
  <Dialog title={id ? 'Buat pasangan' : 'Create a pairing'} {lang} close={() => (modal = null)}>
    <form
      class="cx-picker"
      onsubmit={(event) => {
        event.preventDefault();
        void pair();
      }}
    >
      <label
        >{id ? 'Bukti pertama' : 'First piece'}<select bind:value={pairFrom} onchange={() => (pairTo = '')}
          >{#each options as n (n.key)}<option value={n.key}>{n.source.label} · {n.source.text.slice(0, 80)}</option
            >{/each}</select
        ></label
      >
      <label
        >{id ? 'Bukti kedua' : 'Second piece'}<select bind:value={pairTo} required
          ><option value="">{id ? 'Pilih bukti' : 'Choose evidence'}</option>{#each eligible as n (n.key)}<option
              value={n.key}>{n.source.label} · {n.source.text.slice(0, 80)}</option
            >{/each}</select
        ></label
      >
      <label
        >{id ? 'Hubungan' : 'Relation'}<select bind:value={relation}
          >{#each relationOrder as r (r)}<option value={r}>{relations[r][lang]}</option>{/each}</select
        ></label
      >
      {#if problem}<p role="alert" class="cx-error">{problem}</p>{/if}
      <button class="button primary" disabled={!pairTo || busy}>{id ? 'Simpan pasangan' : 'Save pairing'}</button>
    </form>
  </Dialog>
{/if}
