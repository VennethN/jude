<script lang="ts">
  import { write } from '$lib/client';
  import type { Lang, Role, Speaker, Workspace } from '@jude/core/domain';
  import Dialog from '../Dialog.svelte';
  import { apiPath } from '$lib/evidence/records';
  import { roles, voice } from './people';
  let {
    workspace,
    lang,
    speaker,
    close
  }: { workspace: Workspace; lang: Lang; speaker: Speaker; close: () => void } = $props();
  let en = $derived(lang === 'en');
  let name = $state(''),
    role = $state<Role>('unknown'),
    alias = $state(''),
    busy = $state(false),
    issue = $state('');
  $effect(() => {
    name = speaker.label;
    role = speaker.role;
    alias = speaker.alias || '';
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    issue = '';
    try {
      const updates = alias
        ? { alias, confirmed: true }
        : { alias: '', label: name.trim(), role, confirmed: !!name.trim() };
      await write(apiPath(workspace, 'speakers/' + encodeURIComponent(speaker.id)), 'PATCH', updates);
      close();
    } catch {
      issue = en ? 'Could not save this voice. Try again.' : 'Label suara belum tersimpan. Coba lagi.';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title={en ? 'Identify this voice' : 'Kenali suara ini'} {lang} {close}>
  <form class="stack" onsubmit={save}>
    <p class="small muted">
      {en
        ? 'The speaker label applies to every line from this voice in the case.'
        : 'Label pembicara berlaku untuk setiap ucapan suara ini dalam perkara.'}
    </p>
    <label class="field"
      >{en ? 'Assign to a participant' : 'Tetapkan ke peserta'}<select bind:value={alias}
        ><option value="">{en ? 'Use a separate name' : 'Gunakan nama tersendiri'}</option
        >{#each workspace.speakers.filter((p) => p.id !== speaker.id && !p.alias && p.confirmed && p.label) as p (p.id)}<option
            value={p.id}>{voice(workspace.speakers, p.id, lang).name}</option
          >{/each}</select
      ></label
    >
    {#if !alias}<label class="field"
        >{en ? 'Speaker name' : 'Nama pembicara'}<input maxlength="160" bind:value={name} /></label
      >
      <label class="field"
        >{en ? 'Role' : 'Peran'}<select bind:value={role}
          >{#each Object.entries(roles) as [value, pair]}<option {value}>{pair[en ? 1 : 0]}</option
            >{/each}</select
        ></label
      >{/if}
    {#if issue}<p class="error-text" role="alert">{issue}</p>{/if}
    <button class="button primary" disabled={busy} type="submit">{en ? 'Save voice' : 'Simpan suara'}</button>
  </form>
</Dialog>
