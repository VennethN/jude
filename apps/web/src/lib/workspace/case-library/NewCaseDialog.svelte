<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onDestroy, tick } from 'svelte';
  import { ArrowLeft, ChevronRight, FilePlus2, FileUp, FolderOpen, Info } from '@lucide/svelte';
  import { api, ApiError } from '$lib/client';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import type { CaseRecord, Lang } from '@jude/core/domain';

  let { lang, casesFull, storageFull, demoId, close }: {
    lang: Lang; casesFull: boolean; storageFull: boolean; demoId?: string; close: () => void
  } = $props();
  let step = $state<'choose'|'blank'|'import'>('choose');
  let title = $state(''), reference = $state(''), busy = $state(false), message = $state(''), quotaError = $state(false);
  let fileInput = $state<HTMLInputElement>(), titleInput = $state<HTMLInputElement>();
  let blankButton = $state<HTMLButtonElement>(), importButton = $state<HTMLButtonElement>();
  let percent = $state<number | null>(null), visible = true;
  let createKey = '';
  const en = $derived(lang === 'en');
  const quotaNotice = $derived(en ? 'Your plan has reached its active-case limit. Archive another case to make room.' : 'Kuota perkara aktif paket Anda sudah penuh. Arsipkan perkara lain untuk memberi ruang.');
  const importTitle = $derived(en ? 'Import a .jude archive' : 'Impor arsip .jude');
  const blankTitle = $derived(en ? 'Start a blank case' : 'Mulai perkara kosong');
  onDestroy(() => { visible = false; });

  async function change(next: 'choose'|'blank'|'import') {
    const previous = step;
    step = next; message = ''; quotaError = false; percent = null;
    await tick();
    if (next === 'blank') titleInput?.focus();
    if (next === 'import') fileInput?.focus();
    if (next === 'choose') (previous === 'blank' ? blankButton : importButton)?.focus();
  }
  async function openSaved(item: CaseRecord) {
    if (visible) await goto('/case/' + encodeURIComponent(item.id), { invalidateAll: true, state: { judeNotice: { text: en ? 'Case created.' : 'Perkara dibuat.' } } });
    else await invalidateAll();
  }
  function failure(error: unknown) {
    const code = error instanceof ApiError ? error.code : '';
    quotaError = code === 'quota_exceeded' || code === 'feature_not_in_plan';
    if (quotaError) return step === 'blank' ? quotaNotice : (en ? 'Your plan has reached its case or storage limit. Check usage before importing.' : 'Kuota perkara atau penyimpanan paket telah tercapai. Periksa pemakaian sebelum mengimpor.');
    if (code === 'file_too_large') return en ? 'This archive is too large to import.' : 'Arsip ini terlalu besar untuk diimpor.';
    return step === 'blank' ? (en ? 'Could not create the case. Try again.' : 'Perkara belum dapat dibuat. Coba lagi.') : (en ? 'This archive could not be imported. Check the file, then try again.' : 'Arsip ini tidak bisa diimpor. Periksa filenya, lalu coba lagi.');
  }
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!title.trim() || busy || casesFull) return;
    busy = true; message = ''; quotaError = false;
    try {
      createKey ||= crypto.randomUUID();
      const item = await api<CaseRecord>('/api/cases', 'POST', { title: title.trim(), reference: reference.trim() }, { 'Idempotency-Key': createKey });
      await openSaved(item);
    } catch (error) { message = failure(error); } finally { busy = false; }
  }
  function uploadFile(file: File) {
    const body = new FormData();
    body.append('file', file);
    return new Promise<CaseRecord>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/cases/import');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) percent = Math.round(100 * event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.id) resolve(xhr.response);
        else reject(new ApiError(xhr.response?.error?.code ?? '', '', xhr.status));
      };
      xhr.onerror = () => reject(new Error('upload_failed'));
      xhr.send(body);
    });
  }
  async function importCase(file?: File) {
    if (!file || busy || storageFull || casesFull) return;
    message = ''; quotaError = false;
    if (!file.name.toLowerCase().endsWith('.jude')) {
      message = en ? 'Choose a .jude archive.' : 'Pilih berkas arsip .jude.';
      return;
    }
    busy = true; percent = null;
    try { await openSaved(await uploadFile(file)); }
    catch (error) { message = failure(error); }
    finally { busy = false; if (fileInput) fileInput.value = ''; }
  }
</script>

<div class="case-dialog">
<Dialog title={step === 'choose' ? (en ? 'Add a case' : 'Tambah perkara') : step === 'blank' ? blankTitle : importTitle} {lang} {close}>
  <div class="dialog-body">
  {#if step === 'choose'}
    {#if casesFull || storageFull}
      <div class="limit"><Info size={17}/><p>{casesFull ? quotaNotice : (en ? 'Your storage is full. Make room before importing an archive.' : 'Penyimpanan Anda penuh. Kosongkan ruang sebelum mengimpor arsip.')} <a href="/billing">{en ? 'See plans' : 'Lihat paket'}</a></p></div>
    {/if}
    <div class="paths">
      <button class="path" bind:this={blankButton} disabled={casesFull} onclick={() => change('blank')}><FilePlus2/><span><strong>{blankTitle}</strong><small>{en ? 'Give it a title, then add documents and hearings.' : 'Beri judul, lalu tambahkan berkas dan sidang.'}</small></span><ChevronRight size={16}/></button>
      <button class="path" bind:this={importButton} disabled={casesFull || storageFull} onclick={() => change('import')}><FileUp/><span><strong>{importTitle}</strong><small>{en ? 'Continue from a colleague’s case or a Jude export. Imported findings start unreviewed.' : 'Lanjutkan perkara dari rekan atau hasil ekspor Jude. Temuan impor mulai sebagai belum ditinjau.'}</small></span><ChevronRight size={16}/></button>
      {#if demoId}<a class="path" href={'/case/' + encodeURIComponent(demoId)}><FolderOpen/><span><strong>{en ? 'Open the example case' : 'Buka perkara contoh'}</strong><small>{en ? 'Explore a synthetic case with documents, hearings and findings.' : 'Jelajahi perkara sintetis dengan dokumen, sidang, dan temuan.'}</small></span><ChevronRight size={16}/></a>{/if}
    </div>
  {:else if step === 'blank'}
    <form class="stack" onsubmit={create}>
      <label class="field">{en ? 'Case title' : 'Judul perkara'}<input bind:this={titleInput} bind:value={title} oninput={() => createKey = ''} required maxlength="200" placeholder={en ? 'e.g. Warehouse embezzlement case' : 'mis. Perkara Penggelapan Gudang'}/></label>
      <label class="field">{en ? 'Case number (optional)' : 'Nomor perkara (opsional)'}<input bind:value={reference} oninput={() => createKey = ''} maxlength="200" placeholder="000/Pid.B/2026/PN …"/></label>
      <div class="step-actions"><button class="button subtle" type="button" disabled={busy} onclick={() => change('choose')}><ArrowLeft size={16}/>{en ? 'Back' : 'Kembali'}</button><button class="button primary" disabled={busy || !title.trim()} type="submit">{busy ? (en ? 'Creating…' : 'Membuat…') : (en ? 'Create case' : 'Buat perkara')}</button></div>
    </form>
  {:else}
    <label class="upload" class:busy ondragover={(event) => event.preventDefault()} ondrop={(event) => {event.preventDefault(); void importCase(event.dataTransfer?.files[0]);}}>
      <input class="sr-only" bind:this={fileInput} type="file" accept=".jude" disabled={busy} onchange={(event) => importCase(event.currentTarget.files?.[0])}/>
      <FileUp size={25}/><strong>{busy ? (en ? 'Importing case…' : 'Mengimpor perkara…') : importTitle}</strong>
      {#if busy && percent !== null && percent < 100}<progress value={percent} max="100" aria-label={en ? 'Upload progress' : 'Kemajuan unggahan'}></progress>
      {:else if busy}<small>{en ? 'Checking the archive and its files.' : 'Memeriksa arsip dan isi berkasnya.'}</small>
      {:else}<small class="pointer">{en ? 'Drop the archive here or select a file.' : 'Tarik arsip ke sini atau pilih berkas.'}</small><small class="touch">{en ? 'Select an archive from your device.' : 'Pilih arsip dari perangkat Anda.'}</small>{/if}
    </label>
    <div class="step-actions"><button class="button subtle" disabled={busy} onclick={() => change('choose')}><ArrowLeft size={16}/>{en ? 'Back' : 'Kembali'}</button></div>
  {/if}
  {#if message}<p class="problem" role="alert">{message} {#if quotaError}<a href="/billing">{en ? 'See plans' : 'Lihat paket'}</a>{/if}</p>{/if}
  </div>
</Dialog>
</div>

<style>
  .case-dialog{display:contents}
  .case-dialog :global(dialog){width:min(520px,calc(100% - 32px));max-height:min(820px,calc(100dvh - 32px));padding:0;border-radius:16px}
  .case-dialog :global(.dialog-head){align-items:center;margin:0;padding:10px 12px 10px 20px;border-bottom:1px solid var(--line)}
  .case-dialog :global(.dialog-head h2){font-size:26px}
  .dialog-body{padding:18px 20px 20px}
  .paths{display:grid;gap:9px}
  .path{display:grid;grid-template-columns:26px 1fr 16px;align-items:start;gap:13px;text-align:start;width:100%;padding:15px 13px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--surface);text-decoration:none}
  .path:hover:not(:disabled){border-color:var(--muted);background:var(--wash)}
  .path > :global(svg){width:20px;height:20px;align-self:start;margin:2px auto;color:var(--muted)}
  .path > :global(svg:last-child){width:15px;height:15px;align-self:center}
  .path strong,.upload strong{display:block;font-size:14px;font-weight:600;line-height:1.45}
  .path small,.upload small{display:block;margin-top:3px;color:var(--muted);font-size:13px;line-height:1.5}
  .limit{display:flex;align-items:start;gap:9px;padding:12px;margin-bottom:14px;background:var(--wash);border-radius:7px;color:var(--ink);font-size:13px}
  .limit :global(svg){flex:none;margin-top:2px}
  .limit a,.problem a{font-weight:600}.step-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:10px}
  .upload{position:relative;display:grid;justify-items:center;gap:4px;border:1.5px dashed var(--muted);padding:24px 14px;background:var(--wash);border-radius:8px;cursor:pointer;text-align:center}
  .upload:focus-within{outline:3px solid #a8732a;outline-offset:3px}.upload.busy{cursor:wait}
  .upload .touch{display:none}.problem{margin-top:15px;color:var(--accent);font-size:14px}
  @media(pointer:coarse){.upload{border-style:solid}.upload .pointer{display:none}.upload .touch{display:block}}
  @media(max-width:600px){.case-dialog :global(dialog){width:100%;margin:auto 0 0;max-height:88dvh;border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom)}.dialog-body{padding:14px 16px 20px}}
</style>
