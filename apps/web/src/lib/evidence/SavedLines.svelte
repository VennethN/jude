<script lang="ts">
  import { Bookmark, Pencil } from '@lucide/svelte';
  import { ApiError, write } from '$lib/client';
  import type { Lang, Statement, Workspace } from '@jude/core/domain';
  import { apiPath, boardPath, sourceOf } from './records';
  let {
    workspace: w,
    lang,
    hearing = '',
    query = '',
    selected = ''
  }: { workspace: Workspace; lang: Lang; hearing?: string; query?: string; selected?: string } = $props();
  let id = $derived(lang === 'id');
  let lines = $derived(w.statements.filter((s) => s.flagged && (!hearing || s.hearingId === hearing) && (!query.trim() || (s.text+' '+(s.note??'')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))));
  let editing = $state(''),
    note = $state(''),
    busy = $state(false),
    problem = $state(''),
    removed = $state<Statement | null>(null);
  async function patch(s: Statement, fields: { flagged?: boolean; note?: string }) {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      await write(apiPath(w, 'statements/' + encodeURIComponent(s.id)), 'PATCH', fields);
      editing = '';
      if (fields.flagged === false) removed = s;
      if (fields.flagged === true) removed = null;
    } catch (e) {
      problem = e instanceof ApiError ? e.message : id ? 'Gagal menyimpan.' : 'Could not save.';
    } finally {
      busy = false;
    }
  }
</script>

{#if removed}<div class="ev-notice ev-inline" role="status">
    {id ? 'Penanda dihapus.' : 'Bookmark removed.'}<button
      class="ev-button"
      disabled={busy}
      onclick={() => removed && patch(removed, { flagged: true, note: removed.note })}
      >{id ? 'Urungkan' : 'Undo'}</button
    >
  </div>{/if}
{#if problem}<p role="alert" class="ev-error">{problem}</p>{/if}
{#if lines.length}<ul class="ev-list">
    {#each lines as s (s.id)}
      {@const source = sourceOf(w, { kind: 'statement', id: s.id }, lang)}
      {#if source}<li id={'saved-' + s.id} class:selected={s.id === selected}>
          <span class="ev-cap"><Bookmark size={15} />{source.label}</span>
          <blockquote>{s.text}</blockquote>
          {#if editing === s.id}
            <label class="ev-field-label"
              >{id ? 'Catatan' : 'Note'}<textarea class="ev-textarea" bind:value={note}></textarea></label
            ><button class="ev-button" disabled={busy} onclick={() => patch(s, { note })}
              >{id ? 'Simpan' : 'Save'}</button
            ><button class="ev-button" onclick={() => (editing = '')}>{id ? 'Batal' : 'Cancel'}</button>
          {:else}{#if s.note}<p>{s.note}</p>{/if}
            <div class="ev-actions">
              <a class="ev-link" href={source.href}>{id ? 'Buka transkrip' : 'Open transcript'}</a>
              <a class="ev-link" href={boardPath(w, { kind: 'statement', id: s.id })}
                >{id ? 'Taruh di papan' : 'Put on board'}</a
              ><button
                class="ev-button"
                onclick={() => {
                  editing = s.id;
                  note = s.note ?? '';
                }}><Pencil size={14} />{id ? 'Catatan' : 'Note'}</button
              ><button class="ev-button" disabled={busy} onclick={() => patch(s, { flagged: false })}
                >{id ? 'Hapus penanda' : 'Remove bookmark'}</button
              >
            </div>{/if}
        </li>{/if}
    {/each}
  </ul>{:else}<div class="ev-empty">
    <h2 class="ev-title">{id ? 'Belum ada pernyataan tersimpan' : 'No bookmarked statements'}</h2>
    <p>
      {id
        ? 'Tandai pernyataan di transkrip sidang untuk kembali ke sini.'
        : 'Bookmark a line in a hearing transcript to find it here.'}
    </p>
  </div>{/if}

<style>
  li {
    padding: 1.1rem 0.6rem;
  }
  li.selected {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  blockquote {
    font-size: 1.05rem;
    margin: 0.75rem 0;
    max-width: 75ch;
  }
</style>
