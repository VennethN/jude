<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { casePrompts } from '$lib/workspace/case-prompts';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { ArrowUp, Plus, X, History, MessageSquare, Paperclip, Search, SquarePen } from '@lucide/svelte';
  import type { ContextRef, InspectTarget, Lang, Thread, Workspace } from '@jude/core/domain';
  import { api, ApiError } from '$lib/client';
  import { apiPath, casePath, evidenceKey, local, meaningful, sourceOf } from './records';
  import Inspector from './Inspector.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import './evidence.css';

  let {
    workspace: w,
    lang,
    compact = false,
    initialQuestion = '',
    context,
    threadId,
    draft: initialDraft = '',
    onClose
  }: {
    workspace: Workspace;
    lang: Lang;
    compact?: boolean;
    initialQuestion?: string;
    context?: ContextRef;
    threadId?: string;
    draft?: string;
    onClose?: () => void;
  } = $props();
  let id = $derived(lang === 'id'),
    base = $derived(casePath(w) + '/assistant');
  let currentId = $state(untrack(() => (threadId && threadId !== 'new' ? threadId : '')));
  let result = $state<Thread>();
  let thread = $derived(
    result?.id === currentId && result ? result : w.threads.find((t) => t.id === currentId)
  );
  let draft = $state(
    untrack(() => initialDraft || (!compact ? (page.state as {judeDraft?: string}).judeDraft : '') || '')
  );
  let extra = $state<ContextRef[]>([]),
    removedInitial = $state<string[]>([]),
    pick = $state(false),
    search = $state(''),
    busy = $state(false),
    pending = $state(''),
    problem = $state(''),
    limit = $state(false),
    retry = $state('');
  let inspect = $state<InspectTarget | null>(null);
  let composer: HTMLTextAreaElement;
  let log = $state<HTMLDivElement>();
  let lastAttempt: { fingerprint: string; key: string } | undefined;
  let storeKey = $derived('jude:thread:' + w.caseRecord.id);
  function parse(value: string | null): ContextRef | undefined {
    if (value === 'case' || value === 'documents') return { kind: value };
    if (!value) return;
    const [kind, ...parts] = value.split(':');
    if (
      kind === 'finding' ||
      kind === 'document' ||
      kind === 'hearing' ||
      kind === 'passage' ||
      kind === 'statement' ||
      kind === 'connection' ||
      kind === 'board'
    ) {
      const ref = { kind, id: parts.join(':') } as ContextRef;
      if (sourceOf(w, ref, lang)) return ref;
    }
  }
  let initialContexts = $derived(
    context ? [context] : page.url.searchParams.getAll('context').map(parse).filter((ref) => ref !== undefined)
  );
  const key = (c: ContextRef) => ('id' in c ? evidenceKey(c) : c.kind);
  let contexts = $derived.by(() => {
    const all = [...initialContexts.filter((c) => c.kind !== 'case' && !removedInitial.includes(key(c))), ...extra];
    const seen = new Set<string>();
    return all
      .filter((c) => {
        const k = key(c);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 6);
  });
  let suggestions = $derived.by(() => {
    const kind = contexts[0]?.kind ?? 'case';
    if (kind === 'finding')
      return id
        ? [
            'Apa yang berbeda di antara kedua sumber?',
            'Sumber lain mana yang relevan?',
            'Apa yang perlu ditanyakan kepada saksi?'
          ]
        : [
            'Where do the sources differ?',
            'Which other sources are relevant?',
            'What should I ask the witness?'
          ];
    if (kind === 'board')
      return id
        ? [
            'Kutipan mana yang mendukung kartu di papan?',
            'Pertanyaan apa yang belum terjawab?',
            'Ringkas bukti yang terhubung.'
          ]
        : [
            'Which passages support the board cards?',
            'Which questions are still open?',
            'Summarise the connected evidence.'
          ];
    if (kind === 'document' || kind === 'passage' || kind === 'documents')
      return id
        ? [
            'Apa isi pokok berkas ini?',
            'Kutipan mana yang berkaitan dengan keterangan saksi?',
            'Apa yang perlu diperiksa lebih lanjut?'
          ]
        : [
            'What does the record say?',
            'Which passages relate to the testimony?',
            'What needs further checking?'
          ];
    if (kind === 'hearing' || kind === 'statement')
      return id
        ? [
            'Ringkas keterangan dalam sidang ini.',
            'Apa yang perlu dikonfirmasi?',
            'Dokumen mana yang dikutip?'
          ]
        : [
            'Summarise this hearing’s testimony.',
            'What needs to be confirmed?',
            'Which documents were cited?'
          ];
    return casePrompts[lang];
  });
  let options = $derived.by(() => {
    const candidates: ContextRef[] = [
      ...w.hearings.map((h) => ({ kind: 'hearing' as const, id: h.id })),
      ...w.documents.map((d) => ({ kind: 'document' as const, id: d.id })),
      ...w.findings.filter((f) => meaningful(f.status)).map((f) => ({ kind: 'finding' as const, id: f.id })),
      ...w.boards.map((b) => ({ kind: 'board' as const, id: b.id }))
    ];
    return candidates
      .map((ref) => ({ ref, label: sourceOf(w, ref, lang)?.label || '' }))
      .filter((c) => !search.trim() || c.label.toLowerCase().includes(search.trim().toLowerCase()));
  });
  function restoreContexts(t: Thread | undefined) {
    const prompt = t?.messages.findLast((m) => m.role === 'user');
    if (prompt?.contexts?.length) extra = prompt.contexts.filter((c) => c.kind !== 'case');
  }
  function remember(value: string) {
    try {
      if (value) sessionStorage.setItem(storeKey, value);
      else sessionStorage.removeItem(storeKey);
    } catch {
      /* Storage is optional. */
    }
  }
  function remove(ref: ContextRef) {
    if (initialContexts.some((c) => key(ref) === key(c))) removedInitial = [...removedInitial, key(ref)];
    extra = extra.filter((c) => key(c) !== key(ref));
  }
  function toggle(ref: ContextRef) {
    if (contexts.some((c) => key(c) === key(ref))) remove(ref);
    else if (contexts.length < 6) extra = [...extra, ref];
  }
  async function send(text = draft, suggested = false) {
    text = text.trim();
    if (!text || busy) return;
    const attached = contexts.length ? [...contexts] : [{ kind: 'case' } as const],
      typed = draft;
    busy = true;
    pending = text;
    problem = '';
    retry = '';
    limit = false;
    if (!suggested) draft = '';
    try {
      if (!currentId) {
        const created = await api<Thread>(apiPath(w, 'threads'), 'POST', { title: text.slice(0, 100) });
        currentId = created.id;
        result = created;
        remember(currentId);
      }
      const fingerprint = JSON.stringify([currentId, text, attached]);
      if (lastAttempt?.fingerprint !== fingerprint) lastAttempt = { fingerprint, key: crypto.randomUUID() };
      const response = await fetch(apiPath(w, 'threads/' + encodeURIComponent(currentId) + '/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': lastAttempt.key },
        body: JSON.stringify({ text, lang, contexts: attached })
      });
      const payload = await response.json();
      if (!response.ok)
        throw new ApiError(
          payload?.error?.code ?? 'request_failed',
          payload?.error?.message ?? response.statusText,
          response.status
        );
      result = payload as Thread;
      lastAttempt = undefined;
      pending = '';
      await invalidateAll();
      if (!compact && page.params.threadId !== currentId)
        await goto(base + '/' + encodeURIComponent(currentId), {
          replaceState: true,
          noScroll: true,
          keepFocus: true
        });
      await tick();
      log?.lastElementChild?.scrollIntoView({ block: 'nearest' });
    } catch (e) {
      limit = e instanceof ApiError && e.status === 402;
      problem =
        e instanceof Error
          ? e.message
          : id
            ? 'Jawaban belum tersedia. Coba lagi.'
            : 'The answer is unavailable. Try again.';
      retry = text;
      if (!suggested && !draft.trim()) draft = typed || text;
    } finally {
      busy = false;
      pending = '';
    }
  }
  function reset() {
    currentId = '';
    result = undefined;
    extra = [];
    removedInitial = [];
    draft = '';
    problem = '';
    retry = '';
    lastAttempt = undefined;
    remember('');
    composer?.focus();
  }
  function keydown(e: KeyboardEvent) {
    if (
      (e.key === 'a' || e.key === 'A') &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !(
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || e.target.closest('input,textarea,select'))
      ) &&
      (!document.querySelector('dialog[open]') || compact)
    ) {
      e.preventDefault();
      composer?.focus();
    }
    if (e.key === 'Escape' && pick) {
      e.preventDefault();
      e.stopPropagation();
      pick = false;
    }
  }
  onMount(() => {
    const next = page.state as { judeAsk?: { caseId: string; text: string } };
    if (!compact && threadId === 'new' && next.judeAsk?.caseId === w.caseRecord.id) {
      const { judeAsk, ...rest } = next;
      replaceState(page.url, rest);
      void send(judeAsk.text, true);
    }
    if (compact) {
      composer?.focus({ preventScroll: true });
      if (initialQuestion.trim()) {
        currentId = '';
        remember('');
        void send(initialQuestion, true);
        return;
      }
      try {
        const saved = sessionStorage.getItem(storeKey);
        if (saved && w.threads.some((t) => t.id === saved)) currentId = saved;
      } catch {
        /* Storage is optional. */
      }
    }
    if (currentId) {
      remember(currentId);
      restoreContexts(w.threads.find((t) => t.id === currentId));
    }
  });
</script>

<svelte:window onkeydown={keydown} />
<div class="ev-panel assistant" class:compact>
  {#if compact}<header class="panel-head">
      <h2 class="ev-title">{id ? 'Asisten perkara' : 'Case assistant'}</h2>
      <div class="ev-inline">
        <a
          class="ev-icon"
          href={base + (currentId ? '/' + encodeURIComponent(currentId) : '')}
          title={id ? 'Riwayat percakapan' : 'Conversation history'}
          aria-label={id ? 'Riwayat percakapan' : 'Conversation history'}
          onclick={() => onClose?.()}><History size={16} /></a
        ><button
          class="ev-icon"
          disabled={busy}
          aria-label={id ? 'Percakapan baru' : 'New conversation'}
          onclick={reset}><SquarePen size={16} /></button
        >{#if onClose}<button
            class="ev-icon"
            aria-label={id ? 'Tutup asisten' : 'Close assistant'}
            onclick={onClose}><X size={16} /></button
          >{/if}
      </div>
    </header>{/if}
  <div class="conversation-flow">
  {#if thread?.messages.length}
    <header class="thread-title">
      <h2 class="ev-title">{local(thread.title, lang)}</h2>
      {#if thread.sample}<span class="ev-meta">{id ? 'Contoh sintetis' : 'Synthetic example'}</span>{/if}
    </header>
    <div class="log" bind:this={log}>
      {#each thread.messages as m (m.id)}<ChatMessage
          {lang}
          workspace={w}
          message={m}
          inspect={(t) => (inspect = t)}
        />{/each}
    </div>
  {:else}
    <div class="welcome">
      <MessageSquare size={23} />
      <h2 class="ev-title">
        {contexts.length
          ? id
            ? 'Tanyakan tentang sumber ini.'
            : 'Ask about this source.'
          : id
            ? 'Apa yang perlu diperiksa?'
            : 'What would you like to check?'}
      </h2>
      <p class="ev-sub">
        {id
          ? 'Mulailah dengan pertanyaan. Buka kutipan untuk membaca sumbernya.'
          : 'Begin with a question. Open a citation to read its source.'}
      </p>
    </div>
    <div class="suggestions" data-tour="assistant-suggestions">
      {#each suggestions as q}<button disabled={busy || limit} onclick={() => send(q, true)}
          >{q}<ArrowUp size={14} /></button
        >{/each}
    </div>
  {/if}
  {#if pending}<div class="pending" role="status">
      <strong>{pending}</strong>
      <p>{id ? 'Membaca sumber perkara…' : 'Reading the case record…'}</p>
    </div>{/if}
  {#if problem}<div class="ev-notice" role="alert">
      <p>{problem}</p>
      {#if limit}<a class="ev-link" href="/billing">{id ? 'Lihat paket' : 'See plan'}</a
        >{:else if retry}<button class="ev-button" onclick={() => send(retry, draft !== retry)}
          >{id ? 'Coba lagi' : 'Try again'}</button
        >{/if}
    </div>{/if}
  </div>
  <form
    class="composer"
    data-tour="assistant-composer"
    onsubmit={(e) => {
      e.preventDefault();
      send();
    }}
  >
    <div class="contexts">
      {#if !contexts.length}<span class="whole"
          ><Paperclip size={14} />{id ? 'Seluruh perkara' : 'Whole case'}</span
        >{/if}
      {#each contexts as ctx (key(ctx))}<button
          type="button"
          class="chip"
          aria-label={(id ? 'Hapus konteks ' : 'Remove context ') + (sourceOf(w, ctx, lang)?.label || '')}
          onclick={() => remove(ctx)}>{sourceOf(w, ctx, lang)?.label}<X size={13} /></button
        >{/each}
      <button type="button" class="add-context" aria-expanded={pick} onclick={() => (pick = !pick)}
        ><Plus size={14} />{id ? 'Tambah konteks' : 'Add context'}</button
      >
    </div>
    {#if pick}<fieldset class="context-picker">
        <legend>{id ? 'Pilih hingga enam sumber' : 'Choose up to six sources'}</legend><label
          class="ev-search"
          ><Search size={14} /><input
            type="search"
            bind:value={search}
            placeholder={id ? 'Cari konteks…' : 'Find a source…'}
            aria-label={id ? 'Cari konteks' : 'Find a source'}
          /></label
        >
        <div>
          {#each options as option (key(option.ref))}{@const active = contexts.some(
              (c) => key(c) === key(option.ref)
            )}<label
              ><input
                type="checkbox"
                checked={active}
                disabled={!active && contexts.length >= 6}
                onchange={() => toggle(option.ref)}
              />{option.label}</label
            >{/each}
        </div>
        <button class="ev-button" type="button" onclick={() => (pick = false)}
          >{id ? 'Selesai' : 'Done'}</button
        >
      </fieldset>{/if}
    <label class="ev-only" for={compact ? 'panel-question' : 'case-question'}
      >{id ? 'Pertanyaan untuk asisten' : 'Question for the assistant'}</label
    >
    <textarea
      id={compact ? 'panel-question' : 'case-question'}
      bind:this={composer}
      bind:value={draft}
      rows="3"
      maxlength="8000"
      placeholder={id ? 'Tulis pertanyaan tentang perkara…' : 'Ask a question about this case…'}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send();
        }
      }}></textarea>
    <div class="send-row">
      <span class="ev-meta"
        >{id ? 'Jawaban merujuk pada sumber perkara.' : 'Answers reference the case record.'}</span
      ><button
        class="ev-button primary"
        aria-label={id ? 'Kirim pertanyaan' : 'Send question'}
        disabled={!draft.trim() || busy || limit}><ArrowUp size={16} />{id ? 'Kirim' : 'Send'}</button
      >
    </div>
  </form>
</div>
{#if inspect}<Inspector workspace={w} {lang} target={inspect} close={() => (inspect = null)} />{/if}

<style>
  .assistant {
    min-width: 0;
  }
  .panel-head,
  .thread-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.7rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.75rem;
  }
  .thread-title {
    display: block;
  }
  .thread-title h2 {
    font-size: 1.7rem;
  }
  .panel-head h2 {
    font-size: 1.5rem;
  }
  .panel-head .ev-inline {
    gap: 0.15rem;
  }
  .welcome {
    padding: 1.4rem 0 1rem;
  }
  .welcome > :global(svg) {
    color: var(--accent);
    margin-bottom: 0.6rem;
  }
  .welcome h2 {
    font-size: 2.1rem;
  }
  .suggestions {
    display: grid;
    gap: 0;
    margin: 0 0 1.4rem;
  }
  .suggestions button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    color: var(--ink);
    font: 500 0.9rem/1.4 var(--sans);
    text-align: start;
    padding: 0.65rem 0.25rem;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line);
    min-height: 44px;
    cursor: pointer;
  }
  .suggestions button :global(svg) {
    transform: rotate(45deg);
    color: var(--accent);
  }
  .suggestions button:hover {
    color: var(--accent);
  }
  .suggestions button:disabled {
    opacity: 0.6;
  }
  .composer {
    padding: 0.8rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.7rem;
  }
  .contexts {
    display: flex;
    align-items: center;
    gap: 0.2rem 0.5rem;
    flex-wrap: wrap;
  }
  .whole,
  .chip,
  .add-context {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 34px;
    color: var(--muted);
    font: 600 0.77rem var(--sans);
    text-align: left;
  }
  .chip,
  .add-context {
    cursor: pointer;
    background: none;
    border: 0;
    padding: 0.2rem;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .chip {
    background: var(--paper);
    padding: 0.45rem 0.5rem;
    border-radius: 0.45rem;
  }
  .add-context {
    color: var(--accent);
  }
  .composer textarea {
    width: 100%;
    font: 400 1rem/1.5 var(--sans);
    color: var(--ink);
    padding: 0.65rem 0.3rem;
    background: none;
    border: 0;
    resize: vertical;
    max-height: 15rem;
    min-height: 5.5rem;
  }
  .composer:focus-within {
    border-color: var(--accent);
  }
  .composer textarea:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 0;
  }
  .send-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }
  .context-picker {
    border: 1px solid var(--line);
    margin: 0.5rem 0;
    padding: 0.75rem;
    border-radius: 0.4rem;
  }
  .context-picker legend {
    font-size: 0.8rem;
  }
  .context-picker > div {
    max-height: 16rem;
    overflow: auto;
    display: grid;
    margin: 0.4rem 0;
  }
  .context-picker > div label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 38px;
    font-size: 0.83rem;
  }
  .pending {
    padding: 0.65rem;
  }
  .pending p {
    color: var(--muted);
    font-size: 0.82rem;
  }
  .log {
    margin-bottom: 1rem;
  }
  .compact { display:flex; flex-direction:column; height:100%; min-height:0; padding:0; border:0; border-radius:0; background:var(--surface); }
  .compact .panel-head { flex:none; padding:12px 10px 10px 16px; }
  .compact .panel-head h2 { font:600 15px/1.4 var(--sans); letter-spacing:-.01em; }
  .compact .conversation-flow { flex:1; min-height:0; overflow:auto; padding:16px; overscroll-behavior:contain; }
  .compact .welcome { padding:0 0 12px; }
  .compact .suggestions { gap:6px; }
  .compact .suggestions button { padding:11px 14px; border:1px solid var(--line); border-radius:8px; }
  .compact .composer { flex:none; max-height:55%; overflow:auto; padding:12px 16px max(14px,env(safe-area-inset-bottom)); border:0; border-top:1px solid var(--line); border-radius:0; }
  .compact .welcome h2 {
    font-size: 1.75rem;
  }
  .compact .send-row .ev-meta {
    max-width: 17ch;
  }
</style>
