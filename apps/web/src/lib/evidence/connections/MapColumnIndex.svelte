<script lang="ts" module>
  export interface MapIndexEntry {
    key: string;
    kind: 'hearing' | 'findings' | 'document';
    id: string;
    name: string;
    short: string;
    live: boolean;
    count: number;
    cells: { id: string }[];
  }
</script>

<script lang="ts" generics="Entry extends MapIndexEntry">
  import { AudioLines, CheckCheck, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, FileText, FileUser, ScrollText } from '@lucide/svelte';
  import { mapText } from './map-copy';
  import type { Lang, Workspace } from '@jude/core/domain';

  let { columns, workspace, lang, selected, choose, preview }: {
    columns: Entry[];
    workspace: Workspace;
    lang: Lang;
    selected: string;
    choose: (column: Entry, keyboard: boolean) => void;
    preview: (key: string) => void;
  } = $props();

  const indexId = $props.id();
  const en = $derived(lang === 'en');
  const groups = $derived((['hearing', 'findings', 'document'] as const)
    .map(kind => ({kind, entries: columns.filter(col => col.kind === kind)}))
    .filter(group => group.entries.length));
  const docTypes = $derived(new Map(workspace.documents.map(doc => [doc.id, doc.kind.id])));
  const hearingTitles = $derived(new Map(workspace.hearings.map(h => [h.id, h.title[lang]])));
  let strip = $state<HTMLDivElement>();
  let items = $state<HTMLDivElement>();
  let start = $state(true), end = $state(true), overflow = $state(false), tab = $state('');
  const tabKey = $derived(columns.some(col => col.key === tab) ? tab : columns[0]?.key);

  function documentIcon(id: string) {
    const kind = docTypes.get(id) ?? '';
    if (/berita acara pemeriksaan|witness/i.test(kind)) return FileUser;
    if (/forensik|forensic|log|spreadsheet/i.test(kind)) return FileSpreadsheet;
    if (/dakwaan|indictment/i.test(kind)) return ScrollText;
    if (/berita acara|inventar/i.test(kind)) return ClipboardList;
    return FileText;
  }

  function updateScroll() {
    if (!strip || !items) return;
    const styles = getComputedStyle(strip);
    const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    // Measure against the entire index, including the space used by the overflow controls.
    overflow = items.offsetWidth + padding > (strip.parentElement?.clientWidth ?? strip.clientWidth) + 1;
    start = strip.scrollLeft < 2;
    end = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
  }
  $effect(() => {
    if (!strip || !items) return;
    const observe = new ResizeObserver(updateScroll);
    observe.observe(strip);
    observe.observe(items);
    updateScroll();
    return () => observe.disconnect();
  });
  function travel(direction: number) {
    if (!strip) return;
    strip.scrollBy({
      left: direction * Math.max(120, strip.clientWidth * .78),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
  }
  function focusButton(button: HTMLButtonElement, col: Entry) {
    tab = col.key;
    preview(col.key);
    if (!strip) return;
    const box = button.getBoundingClientRect(), area = strip.getBoundingClientRect();
    if (box.right > area.right - 6) strip.scrollLeft += box.right - area.right + 6;
    else if (box.left < area.left + 6) strip.scrollLeft += box.left - area.left - 6;
  }
  function move(event: KeyboardEvent, col: Entry) {
    if (!strip || event.metaKey || event.ctrlKey || event.altKey) return;
    const index = columns.indexOf(col);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = columns.length - 1;
    else if (event.key === 'ArrowRight') next = Math.min(index + 1, columns.length - 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else return;
    event.preventDefault();
    const target = strip.querySelector<HTMLButtonElement>('[data-column-key="' + CSS.escape(columns[next].key) + '"]');
    target?.focus({preventScroll:true});
  }
  function action(col: Entry) {
    if (!col.cells.length) return (en ? 'Open ' : 'Buka ') + col.name;
    return mapText(lang, col.kind === 'document' ? 'cx.map.exploreDoc' : 'cx.map.zoomTo', {name:col.name});
  }
</script>

<div class="heads" role="group" aria-label={en ? 'Evidence index' : 'Indeks bukti'}>
  <div class="track" bind:this={strip} onscroll={updateScroll}>
    <div class="entries" bind:this={items}>
      {#each groups as group (group.kind)}
        <div class="collection" data-kind={group.kind}>
          {#if group.kind === 'hearing'}<span class="category"><AudioLines size={16} aria-hidden="true"/>{en ? 'Hearings' : 'Sidang'}</span>{/if}
          {#each group.entries as col (col.key)}
            {@const details = [col.name, hearingTitles.get(col.id), col.live ? (en ? 'Live' : 'Langsung') : '', mapText(lang,col.count ? 'cx.map.count' : 'cx.map.none',{n:col.count})].filter(Boolean).join(' · ')}
            <button type="button" class="index-entry" class:hearing={col.kind === 'hearing'}
              aria-label={action(col)} aria-describedby={indexId + col.key} title={details} aria-current={selected === col.key ? 'location' : undefined}
              tabindex={tabKey === col.key ? 0 : -1} data-column-key={col.key}
              onfocus={event => focusButton(event.currentTarget,col)} onblur={() => preview('')}
              onpointerenter={event => { if (event.pointerType === 'mouse') preview(col.key); }} onpointerleave={() => preview('')}
              onkeydown={event => move(event,col)} onclick={event => choose(col,event.detail === 0)}>
              {#if col.kind === 'hearing'}
                <span class="ordinal">{col.short.padStart(2,'0')}</span>{#if col.live}<i aria-hidden="true"></i>{/if}
              {:else if col.kind === 'findings'}
                <CheckCheck size={16} aria-hidden="true"/><span>{col.name}</span>
              {:else}
                {@const Icon = documentIcon(col.id)}
                <Icon size={16} aria-hidden="true"/><span>{col.name}</span>
              {/if}
            </button>
            <span class="sr-only" id={indexId + col.key}>{details}</span>
          {/each}
        </div>
      {/each}
    </div>
  </div>
  {#if overflow}<div class="page-keys">
    <button type="button" disabled={start} aria-label={en ? 'Previous index entries' : 'Entri indeks sebelumnya'} onclick={() => travel(-1)}><ChevronLeft size={16}/></button>
    <button type="button" disabled={end} aria-label={en ? 'More index entries' : 'Entri indeks berikutnya'} onclick={() => travel(1)}><ChevronRight size={16}/></button>
  </div>{/if}
</div>

<style>
  .heads { position:absolute; z-index:6; inset:1px 1px auto; height:57px; display:flex; min-width:0; overflow:hidden; border-radius:11px 11px 0 0; border-bottom:1px solid var(--line); background:var(--surface); }
  .track { container-type:inline-size; flex:1; min-width:0; overflow-x:auto; overflow-y:hidden; padding:0 10px; scrollbar-width:none; overscroll-behavior-x:contain; touch-action:pan-x; }
  .track::-webkit-scrollbar { display:none; }
  .entries,.collection,.category,.index-entry,.page-keys { display:flex; align-items:center; }
  .entries { width:max-content; min-height:100%; gap:12px; }
  .collection { gap:5px; }
  .collection + .collection { border-left:1px solid var(--line); padding-left:12px; }
  .category { gap:6px; color:var(--muted); margin-right:3px; font:600 12px/1 var(--sans); }
  .category :global(svg) { color:var(--role-counsel-ink); }
  button { appearance:none; border:1px solid transparent; font-family:var(--sans); color:var(--ink); cursor:pointer; }
  .index-entry { flex:none; position:relative; gap:7px; padding:4px 10px; border-color:var(--line); border-radius:7px; min-height:34px; background:var(--surface-2); font:600 12.5px/1.3 var(--sans); white-space:nowrap; transition:background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out); }
  .index-entry:not(.hearing) { max-inline-size:calc(100cqi - 12px); white-space:normal; text-align:start; }
  .index-entry:not(.hearing) > span { overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; overflow-wrap:anywhere; }
  .index-entry :global(svg) { flex:none; color:var(--sand-ink); stroke-width:1.7; }
  [data-kind='findings'] .index-entry :global(svg) { color:var(--st-context-ink); }
  .index-entry.hearing { min-width:34px; justify-content:center; padding-inline:5px; }
  .ordinal { font:400 13px/1 var(--mono); font-variant-numeric:tabular-nums; }
  .hearing i { position:absolute; top:3px; right:3px; width:5px; height:5px; border-radius:50%; background:var(--live); }
  .index-entry:hover,.index-entry[aria-current] { background:var(--selected); border-color:var(--selected-line); }
  .heads button:focus-visible { outline:2px solid var(--focus); outline-offset:1px; }
  .page-keys { flex:none; gap:2px; padding:0 5px; border-left:1px solid var(--line); }
  .page-keys button { display:grid; place-items:center; width:29px; min-height:36px; padding:0; border-radius:5px; background:transparent; }
  .page-keys button:hover:enabled { background:var(--sunken); }
  .page-keys button:disabled { opacity:.3; cursor:default; }
  @media (pointer:coarse) { .index-entry,.page-keys button { min-height:44px; min-width:44px; } }
</style>
