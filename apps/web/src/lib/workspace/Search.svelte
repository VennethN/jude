<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ArrowDown, ArrowUp, AudioLines, Clock3, CornerDownLeft, FileText, Lightbulb, Quote, Search } from '@lucide/svelte';
  import type { Lang, Workspace } from '@jude/core/domain';
  import { displaySpeaker, localized, timecode } from './format';
  import SheetHandle from './SheetHandle.svelte';

  let { workspace: w, lang, close }: { workspace: Workspace; lang: Lang; close: () => void } = $props();
  type Hit = { title: string; description: string; href: string };
  const id = $props.id();
  const en = $derived(lang === 'en');
  const base = $derived('/case/' + encodeURIComponent(w.caseRecord.id));
  const hearings = $derived(new Map(w.hearings.map((hearing) => [hearing.id, hearing])));
  const documents = $derived(new Map(w.documents.map((document) => [document.id, document])));
  let dialog: HTMLDialogElement, input: HTMLInputElement;
  let query = $state(''), active = $state(0);
  const needle = $derived(query.trim().toLocaleLowerCase(lang));
  let remote = $state<{ query: string; caseId: string; urls: string[] } | null>(null);

  $effect(() => {
    const term = needle, caseId = w.caseRecord.id;
    if (term.length < 3 || w.caseRecord.label !== 'private') return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/cases/' + encodeURIComponent(caseId) + '/search?q=' + encodeURIComponent(term), {
          signal: controller.signal
        });
        if (!response.ok) return;
        const { hits } = await response.json() as { hits: { url: string }[] };
        if (!controller.signal.aborted) remote = { query: term, caseId, urls: hits.map(hit => hit.url) };
      } catch {
        // Local results are already available while typing or offline.
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  });

  const groups = $derived([
    { name: en ? 'Hearings' : 'Sidang', icon: Clock3, limit: 4, records: w.hearings.map((h) => ({
      title: h.title[lang], description: (en ? 'Hearing ' : 'Sidang ') + h.number,
      href: base + '/hearings/' + encodeURIComponent(h.id)
    })) },
    { name: en ? 'Findings' : 'Temuan', icon: Lightbulb, limit: 4, records: w.findings.map((f) => ({
      title: f.title[lang], description: localized(f.explanation, lang),
      href: base + '/findings/' + encodeURIComponent(f.id)
    })) },
    { name: en ? 'Documents' : 'Dokumen', icon: FileText, limit: 4, records: w.documents.map((d) => ({
      title: d.title, description: localized(d.kind, lang),
      href: base + '/documents/' + encodeURIComponent(d.id)
    })) },
    { name: en ? 'Document passages' : 'Kutipan dokumen', icon: Quote, limit: 4, records: w.passages.map((p) => ({
      title: p.text, description: (documents.get(p.docId)?.title ?? '') + (en ? ' · p. ' : ' · hal. ') + p.page,
      href: base + '/documents/' + encodeURIComponent(p.docId) + '?p=' + encodeURIComponent(p.id)
    })) },
    { name: en ? 'Transcript' : 'Transkrip', icon: AudioLines, limit: 5, records: w.statements.map((line) => ({
      title: line.text, description: [(en ? 'Hearing ' : 'Sidang ') + (hearings.get(line.hearingId)?.number ?? ''),
        timecode(line.t), displaySpeaker(w.speakers, line.speakerId, lang)].join(' · '),
      href: base + '/hearings/' + encodeURIComponent(line.hearingId) + '?s=' + encodeURIComponent(line.id)
    })) }
  ]);
  const hits = $derived.by(() => {
    if (needle.length < 2) return [];
    const urls = remote?.query === needle && remote.caseId === w.caseRecord.id ? remote.urls : [];
    const ranks = new Map(urls.map((url, i) => [url, i]));
    return groups.flatMap(group => group.records.filter(row =>
      ranks.has(row.href) || (row.title + ' ' + row.description).toLocaleLowerCase(lang).includes(needle)
    ).sort((a, b) => (ranks.get(a.href) ?? Infinity) - (ranks.get(b.href) ?? Infinity))
      .slice(0, group.limit).map(row => ({ ...row, group: group.name, icon: group.icon })));
  });
  const selected = $derived(Math.min(active, Math.max(0, hits.length - 1)));

  function excerpt(value: string) {
    const index = value.toLocaleLowerCase(lang).indexOf(needle);
    if (index < 0) return { before: value, match: '', after: '' };
    const start = Math.max(0, index - 40), end = Math.min(value.length, index + needle.length + 90);
    return { before: (start ? '…' : '') + value.slice(start, index), match: value.slice(index, index + needle.length),
      after: value.slice(index + needle.length, end) + (end < value.length ? '…' : '') };
  }

  onMount(() => {
    const openingControl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    input.focus({ preventScroll: true });
    return () => {
      if (dialog?.open) dialog.close();
      if (openingControl?.isConnected && document.activeElement === document.body) openingControl.focus({ preventScroll: true });
    };
  });

  function choose(hit: Hit) {
    dialog.close();
    void goto(hit.href);
  }
  function keys(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    } else if (hits.length && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      active = Math.max(0, Math.min(hits.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
      document.getElementById(id + '-hit-' + active)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } else if (hits.length && event.key === 'Enter') {
      event.preventDefault();
      choose(hits[selected]);
    }
  }
  function backdrop(event: MouseEvent) {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      dialog.close();
    }
  }
</script>

<dialog class="case-search" bind:this={dialog} aria-label={en ? 'Search the case file' : 'Cari dalam berkas perkara'} onclose={close} onclick={backdrop}>
  <SheetHandle search dismiss={close} />
  <div class="search-in">
    <Search size={20} aria-hidden="true" />
    <input bind:this={input} bind:value={query} oninput={() => active = 0} onkeydown={keys}
      role="combobox" type="text" aria-autocomplete="list" aria-expanded={hits.length > 0}
      aria-controls={id + '-results'} aria-activedescendant={hits.length ? id + '-hit-' + selected : undefined}
      aria-label={en ? 'Search terms' : 'Kata pencarian'}
      placeholder={en ? 'Search hearings, findings, documents…' : 'Cari sidang, temuan, dokumen…'} />
    <button class="dismiss" aria-label={en ? 'Close search' : 'Tutup pencarian'} onclick={() => dialog.close()}>
      <kbd>Esc</kbd><span>{en ? 'Cancel' : 'Batal'}</span>
    </button>
  </div>
  <p class="sr-only" role="status">{needle.length >= 2 ? hits.length + (en ? ' results' : ' hasil') : ''}</p>
  <ul class="results" id={id + '-results'} role="listbox" aria-label={en ? 'Case search results' : 'Hasil pencarian perkara'} hidden={!hits.length}>
    {#each hits as hit, i (hit.href)}
      {@const Icon = hit.icon}
      {@const title = excerpt(hit.title)}
      {#if i === 0 || hits[i - 1].group !== hit.group}<li role="presentation" class="group">{hit.group}</li>{/if}
      <li role="presentation">
        <a role="option" id={id + '-hit-' + i} href={hit.href} aria-selected={i === selected} tabindex="-1"
          onpointerenter={() => active = i} onclick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            choose(hit);
          }}>
          <Icon size={18} aria-hidden="true" />
          <span class="hit-body"><strong class:record={hit.icon === Quote}>{title.before}{#if title.match}<mark>{title.match}</mark>{/if}{title.after}</strong><small>{hit.description}</small></span>
        </a>
      </li>
    {/each}
  </ul>
  {#if !hits.length}
    <p class="message">{needle.length < 2
      ? (en ? 'Type at least two letters to search hearings, findings, document passages and testimony.' : 'Ketik minimal dua huruf untuk mencari sidang, temuan, kutipan dokumen, dan ucapan di sidang.')
      : (en ? 'Nothing matches “' + query.trim() + '”. Try other words.' : 'Tidak ada yang cocok dengan “' + query.trim() + '”. Coba kata lain.')}</p>
  {/if}
  <div class="keys" aria-hidden="true">
    <span><kbd><ArrowUp size={11}/></kbd><kbd><ArrowDown size={11}/></kbd>{en ? 'choose' : 'pilih'}</span>
    <span><kbd><CornerDownLeft size={11}/></kbd>{en ? 'open' : 'buka'}</span>
    <span><kbd>Esc</kbd>{en ? 'close' : 'tutup'}</span>
  </div>
</dialog>

<style>
  .case-search { position:fixed; inset:0; width:min(640px,calc(100% - 32px)); max-width:100%; max-height:min(680px,calc(100dvh - min(14vh,120px) - 32px)); margin:min(14vh,120px) auto auto; padding:0; overflow:hidden; border:1px solid var(--line); border-radius:16px; background:var(--surface); color:var(--ink); box-shadow:0 18px 54px rgb(15 30 20 / .18); }
  .case-search[open] { display:flex; flex-direction:column; }
  .case-search::backdrop { background:rgb(12 25 20 / .44); }
  .search-in { flex:none; display:flex; align-items:center; gap:12px; padding:14px 16px 14px 18px; min-height:65px; border-bottom:1px solid var(--line); color:var(--muted); }
  .search-in input { flex:1; min-width:0; min-height:36px; padding:0; color:var(--ink); border:0; background:none; font:400 18px/1.4 var(--sans); letter-spacing:-.01em; }
  .search-in input:focus-visible { outline:none; }
  .dismiss { display:inline-flex; align-items:center; min-height:36px; padding:0 2px; color:var(--muted); background:transparent; border:0; }
  .dismiss span { display:none; }
  kbd { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 4px; border:1px solid var(--line); border-radius:4px; background:var(--surface); color:var(--muted); font:400 11px/1 var(--mono); }
  .results { margin:0; padding:6px; list-style:none; max-height:min(60dvh,520px); overflow:auto; overscroll-behavior:contain; }
  .group { padding:12px 10px 4px; font:600 12px/1.45 var(--sans); color:var(--muted); }
  .results a { display:flex; align-items:flex-start; gap:12px; min-height:44px; padding:9px 10px; border-radius:9px; color:var(--ink); text-decoration:none; }
  .results a[aria-selected=true] { background:var(--wash); }
  .results :global(svg) { flex:none; margin-top:2px; color:var(--muted); }
  .hit-body { display:grid; gap:2px; min-width:0; }
  .hit-body strong,.hit-body small { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; overflow:hidden; }
  .hit-body strong { font:500 14px/1.45 var(--sans); }
  .hit-body .record { font-family:var(--mono); }
  .hit-body small { color:var(--muted); font-size:12px; }
  mark { background:color-mix(in srgb,#d7b25a 32%,transparent); color:inherit; }
  .message { display:grid; align-content:center; width:100%; min-height:88px; padding:22px 24px; color:var(--muted); font:400 13.5px/1.5 var(--sans); text-align:center; text-wrap:pretty; }
  .keys,.keys span { display:flex; align-items:center; }
  .keys { flex:none; gap:16px; min-height:39px; padding:8px 16px; border-top:1px solid var(--line); background:var(--paper); font-size:12px; color:var(--muted); }
  .keys span { gap:4px; }
  @media (pointer:coarse), (max-width:599px) {
    .dismiss kbd,.keys { display:none; }
    .dismiss span { display:inline; font-weight:600; }
  }
  @media (max-width:599px) {
    .case-search { width:100%; height:calc(100dvh - 24px); max-height:calc(100dvh - 24px); margin:auto 0 0; padding:10px 0 env(safe-area-inset-bottom,0px); border-radius:16px 16px 0 0; }
    .results { max-height:none; }
  }
  @media (prefers-reduced-motion:no-preference) {
    .case-search[open] { animation:palette-in 280ms cubic-bezier(.22,1,.36,1) both; }
    .case-search[open]::backdrop { animation:scrim-in 220ms ease-out; }
    .results a { transition:background-color 110ms ease-out; }
    @keyframes palette-in { from { opacity:0; transform:scale(.96); } to { opacity:1; transform:none; } }
    @keyframes scrim-in { from { opacity:0; } to { opacity:1; } }
    @media (max-width:599px) {
      .case-search[open] { animation:palette-rise 420ms cubic-bezier(.22,1,.36,1) both; }
      @keyframes palette-rise { from { opacity:.6; transform:translateY(72px); } to { opacity:1; transform:none; } }
    }
  }
</style>
