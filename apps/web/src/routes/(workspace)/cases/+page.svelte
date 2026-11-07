<script lang="ts">
  import PageHeading from '$lib/workspace/PageHeading.svelte';
  import { invalidate, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { Archive, ArchiveRestore, ChevronDown, FolderOpen, Plus, Search } from '@lucide/svelte';
  import type { CaseSummary } from '@jude/core/domain';
  import { api, ApiError } from '$lib/client';
  import CaseCard from '$lib/workspace/case-library/CaseCard.svelte';
  import NewCaseDialog from '$lib/workspace/case-library/NewCaseDialog.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let query = $state(''), creating = $state(false), archiveOpen = $state(false), ready = $state(false);
  let restoring = $state(''), announcement = $state(''), restoreError = $state(''), refused = $state(false);
  const en = $derived(data.lang === 'en');
  const term = $derived(query.trim().toLocaleLowerCase(data.lang));
  const filtered = $derived(data.cases.filter((item) => (item.title + ' ' + item.reference).toLocaleLowerCase(data.lang).includes(term)));
  const active = $derived(filtered.filter((item) => !item.archived));
  const archived = $derived(filtered.filter((item) => item.archived).sort((a,b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')));
  const dates = $derived(new Intl.DateTimeFormat(en ? 'en-US' : 'id-ID', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Jakarta' }));

  $effect(() => {
    if (term && !active.length && archived.length) archiveOpen = true;
  });
  onMount(() => {
    ready = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing || creating || document.visibilityState !== 'visible') return;
      refreshing = true;
      try { await invalidate('jude:case-library'); } finally { refreshing = false; }
    }
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
  function dateText(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : dates.format(date);
  }
  async function restore(item: CaseSummary) {
    if (restoring) return;
    restoring = item.id; announcement = ''; restoreError = ''; refused = false;
    try {
      await api('/api/cases/' + encodeURIComponent(item.id) + '/unarchive', 'POST');
      await invalidateAll();
      announcement = en ? 'Case restored from the archive.' : 'Perkara dipulihkan dari arsip.';
      await tick();
      document.getElementById('register-case-' + item.id)?.focus({ preventScroll: true });
    } catch (error) {
      refused = error instanceof ApiError && error.code === 'quota_exceeded';
      restoreError = refused ? (en ? 'The active-case limit has been reached. Archive another case to make room.' : 'Batas perkara aktif telah tercapai. Arsipkan perkara lain untuk memberi ruang.') : (en ? 'The case could not be restored.' : 'Perkara belum dapat dipulihkan.');
    } finally { restoring = ''; }
  }
</script>

<svelte:head><title>{en ? 'Your cases' : 'Perkara Anda'} · Jude</title></svelte:head>
<div class="library">
  <header class="library-head">
    <div class="introduction"><PageHeading art="folder">
      <h1>{en ? 'Your cases' : 'Perkara Anda'}</h1>
      <p>{en ? 'Each case keeps its own documents, hearings, findings and conversations.' : 'Setiap perkara menyimpan berkas, sidang, temuan, dan percakapannya sendiri.'}</p>
    </PageHeading></div>
    <div class="tools">
      <label class="search" data-tour="case-search"><Search size={17}/><span class="sr-only">{en ? 'Find a case' : 'Cari perkara'}</span><input type="search" bind:value={query} placeholder={en ? 'Find a case…' : 'Cari perkara…'} aria-controls="case-register"/></label>
      <button class="button primary" data-tour="case-new" disabled={!ready} onclick={() => creating = true}><Plus size={17}/>{en ? 'New case' : 'Perkara baru'}</button>
    </div>
  </header>

  <span class="sr-only" role="status">{term ? (en ? `${filtered.length} matching cases` : `${filtered.length} perkara cocok`) : ''}</span>
  {#if data.caseUnavailable}<p class="feedback" role="status">{en ? 'That case was not found, or you do not have access.' : 'Perkara itu tidak ditemukan, atau Anda tidak punya akses.'}</p>{/if}
  {#if announcement}<p class="feedback" role="status">{announcement}</p>{/if}
  {#if restoreError}<p class="feedback" role="alert">{restoreError} {#if refused}<a href="/billing">{en ? 'See plans' : 'Lihat paket'}</a>{/if}</p>{/if}
  <ul data-tour="case-register" class="case-grid" id="case-register" aria-label={en ? 'Active cases' : 'Perkara aktif'}>
    {#each active as item (item.id)}
      <li><CaseCard {item} lang={data.lang} updated={dateText(item.updated)}/></li>
    {:else}
      {#if term}
        <li class="no-matches">{archived.length ? (en ? 'No matching active cases.' : 'Tidak ada perkara aktif yang cocok.') : (en ? 'No matching cases.' : 'Tidak ada perkara yang cocok.')}</li>
      {:else}
        <li class="empty">
          <FolderOpen size={32} strokeWidth={1.4}/>
          <p>{#if data.account.demo}{en ? 'No cases yet. Start a blank case, import a .jude archive or open the example case.' : 'Belum ada perkara. Mulai dari perkara kosong, impor arsip .jude, atau buka perkara contoh.'}{:else}{en ? 'No cases yet. Start a blank case or import a .jude archive.' : 'Belum ada perkara. Mulai dari perkara kosong atau impor arsip .jude.'}{/if}</p>
          <button class="button" disabled={!ready} onclick={() => creating = true}><Plus size={16}/>{en ? 'New case' : 'Perkara baru'}</button>
        </li>
      {/if}
    {/each}
  </ul>

  {#if archived.length}
    <details class="archive" bind:open={archiveOpen}>
      <summary><Archive size={17}/>{en ? 'Archived' : 'Diarsipkan'} <span>· {archived.length}</span><ChevronDown size={16}/></summary>
      {#if data.casesFull}
        <p class="capacity">{en ? 'Your plan has reached its active-case limit. Archive another case to make room.' : 'Kuota perkara aktif paket Anda sudah penuh. Arsipkan perkara lain untuk memberi ruang.'} <a href="/billing">{en ? 'See plans' : 'Lihat paket'}</a></p>
      {/if}
      <ul>
        {#each archived as item (item.id)}
          <li><FolderOpen size={18}/><div class="archived-name"><a href={'/case/'+encodeURIComponent(item.id)}>{item.title}</a>{#if item.reference}<span>{item.reference}</span>{/if}</div>
            {#if item.archivedAt}<time datetime={item.archivedAt}>{en ? 'Archived' : 'Diarsipkan'} {dateText(item.archivedAt)}</time>{/if}
            <button class="button" disabled={!ready || Boolean(restoring) || (data.casesFull && item.label === 'private')} onclick={() => restore(item)}><ArchiveRestore size={15}/>{restoring === item.id ? (en ? 'Restoring…' : 'Memulihkan…') : (en ? 'Restore from archive' : 'Pulihkan dari arsip')}</button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</div>
{#if creating}<NewCaseDialog lang={data.lang} casesFull={data.casesFull} storageFull={data.storageFull} demoId={data.account.demo?.caseId} close={() => creating = false}/>{/if}

<style>
  .library{container-type:inline-size;max-width:1320px;margin-inline:auto}
  .library-head{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:20px 26px;margin-bottom:28px}
  .introduction{flex:1 1 340px;max-width:610px}
  h1{font:400 clamp(30px,4cqi,40px)/1.08 var(--display);letter-spacing:-.012em}
  .introduction p{margin-top:8px;max-width:68ch;color:var(--muted);font-size:14.5px;line-height:1.55}
  .tools,.search{display:flex;align-items:center;gap:8px}
  .tools{flex-wrap:wrap}
  .search{flex:0 1 300px;width:300px;min-width:0;border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:0 11px;color:var(--muted)}
  .search:focus-within{outline:2px solid #a8732a;outline-offset:2px}
  .search input{width:100%;min-width:0;min-height:34px;padding:6px 0;background:transparent;border:0;color:var(--ink);outline:0;font:400 14px var(--sans)}
  .search input::placeholder{color:var(--muted)}
  .search :global(svg),.tools .button{flex:none}
  .tools .button{min-height:36px;padding:7px 12px;gap:7px;border-radius:6px;font-size:13px}
  .case-grid,.archive ul{list-style:none;margin:0;padding:0}
  .case-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));align-items:stretch;gap:16px}
  .case-grid > li{min-width:0}
  .no-matches,.empty{grid-column:1/-1;color:var(--muted)}
  .no-matches{padding:30px 0;border-top:1px solid var(--line)}
  .empty{display:grid;justify-items:start;gap:14px;padding:clamp(20px,4cqi,40px);border:1px solid var(--line);border-radius:12px;background:var(--surface)}
  .empty p{max-width:48ch}
  .archive{margin-top:28px;border-top:1px solid var(--line);padding-top:6px}
  .archive summary{display:flex;align-items:center;gap:8px;min-height:44px;width:fit-content;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;list-style:none}
  .archive summary::-webkit-details-marker{display:none}
  .archive[open] summary :global(svg:last-child){transform:rotate(180deg)}
  .archive ul > li{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--line)}
  .archive ul > li > :global(svg),.archive time{color:var(--muted)}
  .archived-name{flex:1 1 150px;min-width:0}
  .archived-name a{font-size:14px;font-weight:600;text-decoration:none;overflow-wrap:anywhere}
  .archived-name a:hover{text-decoration:underline}
  .archived-name span,.archive time{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
  .capacity,.feedback{padding:12px 15px;margin-bottom:15px;border-radius:8px;background:var(--wash);color:var(--ink);font-size:14px}
  .capacity a,.feedback a{font-weight:600}
  @container(max-width:620px){.tools{width:100%}.introduction{flex-basis:100%}}
  @container(max-width:520px){.library-head{gap:16px}.search{flex:1 0 100%;width:100%}.archive ul > li{column-gap:8px}.archive time{margin-left:auto}.archive ul .button{margin-left:26px}}
  @media(pointer:coarse){.search input{min-height:42px}.tools .button{min-height:44px}}
</style>
