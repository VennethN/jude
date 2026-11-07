<script lang="ts">
  import { displayTitle } from '$lib/workspace/format';

  import { Trash2 } from '@lucide/svelte';
  import type { CaseDocument, Lang, Workspace } from '@jude/core/domain';
  import { api } from '$lib/client';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import { apiPath } from './records';
  let {
    workspace,
    doc,
    lang,
    close,
    removed
  }: {
    workspace: Workspace;
    doc: CaseDocument;
    lang: Lang;
    close: () => void;
    removed: (result: { caseId: string; id: string; title: string; citedFindings: number }) => Promise<void>;
  } = $props();
  let en = $derived(lang === 'en'),
    busy = $state(false),
    issue = $state('');
  let passages = $derived(new Set(workspace.passages.filter((p) => p.docId === doc.id).map((p) => p.id)));
  let cited = $derived(
    workspace.findings.filter((f) => f.sources.some((s) => passages.has(s.passageId))).length
  );
  async function remove() {
    if (busy) return;
    busy = true;
    issue = '';
    try {
      const result = await api<{ id: string; citedFindings: number }>(
        apiPath(workspace, 'documents/' + encodeURIComponent(doc.id)),
        'DELETE'
      );
      await removed({
        caseId: workspace.caseRecord.id,
        id: result.id,
        title: displayTitle(doc, lang),
        citedFindings: result.citedFindings
      });
    } catch {
      issue = en ? 'Could not remove the document. Try again.' : 'Dokumen belum dapat dihapus. Coba lagi.';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog
  title={en ? 'Remove this document?' : 'Hapus dokumen ini?'}
  {lang}
  close={() => {
    if (!busy) close();
  }}
>
  <div class="stack">
    <p><strong>{displayTitle(doc, lang)}</strong></p>
    <p>
      {cited
        ? en
          ? 'Removing this file will make its citations unavailable in ' +
            cited +
            ' finding' +
            (cited === 1 ? '' : 's') +
            '.'
          : 'Kutipan dari berkas ini akan menjadi tidak tersedia dalam ' + cited + ' temuan.'
        : en
          ? 'The file and its passages will be removed from this case.'
          : 'Berkas dan kutipannya akan dihapus dari perkara ini.'}
    </p>
    {#if issue}<p class="error-text" role="alert">{issue}</p>{/if}
    <div class="actions">
      <button class="button" onclick={close} disabled={busy}>{en ? 'Cancel' : 'Batal'}</button><button
        class="button destructive"
        onclick={remove}
        disabled={busy}
        ><Trash2 size={15} />{busy
          ? en
            ? 'Removing…'
            : 'Menghapus…'
          : en
            ? 'Remove document'
            : 'Hapus dokumen'}</button
      >
    </div>
  </div>
</Dialog>

<style>
  .destructive {
    background: var(--accent);
    color: var(--surface);
    border-color: var(--accent);
  }
  .destructive:hover {
    background: var(--accent);
    color: var(--surface);
    text-decoration: underline;
  }
</style>
