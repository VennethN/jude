<script lang="ts">
  import PageHeading from '$lib/workspace/PageHeading.svelte';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { casePrompts } from '$lib/workspace/case-prompts';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { ArrowUp, Plus, X, History, FolderOpen, Scale, Search, SquarePen } from '@lucide/svelte';
  import type { ChatMessage as Message, ContextRef, InspectTarget, Lang, Thread, Workspace } from '@jude/core/domain';
  import { api, ApiError } from '$lib/client';
  import { apiPath, casePath, evidenceKey, local, meaningful, sourceOf } from './records';
  import Inspector from './Inspector.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import { claimAttempt, forgetAttempt, readAnswer, rememberAttempt, type AnswerAttempt } from './answer-stream';
  import { workspaceRequest } from '$lib/workspace/tab-cache';
  import './evidence.css';

  let {
    workspace: w,
    lang,
    compact = false,
    initialQuestion = '',
    context,
    threadId,
    draft: initialDraft = '',
    onClose,
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
  let withLegal = $state(true);
  const discovery = $derived(
    w.legalDiscovery ?? (w.caseRecord.label === 'synthetic' ? 'sample' : 'unavailable'),
  );
  const searchLaw = $derived(withLegal && discovery !== 'unavailable');
  const lawHint = $derived(
    discovery === 'unavailable'
      ? id
        ? 'Pencarian hukum tidak tersedia. Anda tetap bisa merujuk peraturan yang diunggah.'
        : 'Legal search is unavailable. You can still reference uploaded legislation.'
      : discovery === 'sample'
        ? id
          ? 'Sertakan rujukan hukum contoh'
          : 'Include sample legal references'
        : id
          ? 'Cari juga di Pasal.id'
          : 'Also search Pasal.id',
  );
  let currentId = $state(untrack(() => (threadId && threadId !== 'new' ? threadId : '')));
  let result = $state<Thread>();
  let savedThread = $derived(w.threads.find((t) => t.id === currentId));
  let thread = $derived(result?.id === currentId && (!savedThread || result.updated >= savedThread.updated) ? result : savedThread);
  let draft = $state(
    untrack(() => initialDraft || (!compact ? (page.state as { judeDraft?: string }).judeDraft : '') || ''),
  );
  let extra = $state<ContextRef[]>([]),
    removedInitial = $state<string[]>([]),
    pick = $state(false),
    search = $state(''),
    busy = $state(false),
    problem = $state(''),
    limit = $state(false),
    retry = $state('');
  let pending = $state.raw<Message>();
  let partial = $state.raw<Message>();
  let previousCount = $state(0);
  const messages = $derived(pending
    ? [...(thread?.messages.slice(0, previousCount) ?? []), pending, ...(partial ? [partial] : [])]
    : (thread?.messages ?? []));
  const conversationTitle = $derived(thread ? local(thread.title, lang) : pending ? local(pending.text, lang).slice(0, 100) : '');
  let inspect = $state<InspectTarget | null>(null);
  let composer: HTMLTextAreaElement;
  let flow: HTMLDivElement;
  let addContextButton: HTMLButtonElement;
  let sourceSearch = $state<HTMLInputElement>();
  const pickerId = $derived(compact ? 'dock-source-picker' : 'page-source-picker');

  async function scrollToLatest(smooth = false) {
    await tick();
    if (flow)
      flow.scrollTo({
        top: flow.scrollHeight,
        behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
      });
  }

  async function showPicker(open: boolean) {
    pick = open;
    if (open) search = '';
    await tick();
    (open ? sourceSearch : addContextButton)?.focus({ preventScroll: true });
  }
  let lastAttempt: AnswerAttempt | undefined;
  let activeRequest: AbortController | undefined;
  onDestroy(() => activeRequest?.abort());
  function attemptSlot(threadId: string) {
    const account = page.data.account;
    return ['jude:ask', account?.organization.id, account?.user.id, w.caseRecord.id, threadId || 'new'].join('/');
  }
  function followsLatest() {
    return !flow || flow.scrollHeight - flow.scrollTop - flow.clientHeight < 90;
  }
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
    context
      ? [context]
      : page.url.searchParams
          .getAll('context')
          .map(parse)
          .filter((ref) => ref !== undefined),
  );
  const key = (c: ContextRef) => ('id' in c ? evidenceKey(c) : c.kind);
  let contexts = $derived.by(() => {
    const all = [
      ...initialContexts.filter((c) => c.kind !== 'case' && !removedInitial.includes(key(c))),
      ...extra,
    ];
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
            'Apa yang perlu ditanyakan kepada saksi?',
          ]
        : [
            'Where do the sources differ?',
            'Which other sources are relevant?',
            'What should I ask the witness?',
          ];
    if (kind === 'board')
      return id
        ? [
            'Kutipan mana yang mendukung kartu di papan?',
            'Pertanyaan apa yang belum terjawab?',
            'Ringkas bukti yang terhubung.',
          ]
        : [
            'Which passages support the board cards?',
            'Which questions are still open?',
            'Summarise the connected evidence.',
          ];
    if (kind === 'document' || kind === 'passage' || kind === 'documents')
      return id
        ? [
            'Apa isi pokok berkas ini?',
            'Kutipan mana yang berkaitan dengan keterangan saksi?',
            'Apa yang perlu diperiksa lebih lanjut?',
          ]
        : [
            'What does the record say?',
            'Which passages relate to the testimony?',
            'What needs further checking?',
          ];
    if (kind === 'hearing' || kind === 'statement')
      return id
        ? [
            'Ringkas keterangan dalam sidang ini.',
            'Apa yang perlu dikonfirmasi?',
            'Dokumen mana yang dikutip?',
          ]
        : [
            'Summarise this hearing’s testimony.',
            'What needs to be confirmed?',
            'Which documents were cited?',
          ];
    return casePrompts[lang];
  });
  let options = $derived.by(() => {
    const candidates: ContextRef[] = [
      ...w.hearings.map((h) => ({ kind: 'hearing' as const, id: h.id })),
      ...w.documents.map((d) => ({ kind: 'document' as const, id: d.id })),
      ...w.findings.filter((f) => meaningful(f.status)).map((f) => ({ kind: 'finding' as const, id: f.id })),
      ...w.boards.map((b) => ({ kind: 'board' as const, id: b.id })),
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
    const attached = contexts.length ? [...contexts] : [{ kind: 'case' } as const];
    const typed = draft, question = { text, lang, contexts: attached, withLegal };
    const initialSlot = attemptSlot(currentId);
    const controller = new AbortController();
    activeRequest = controller;
    busy = true;
    previousCount = thread?.messages.length ?? 0;
    pending = { id: 'pending-question', role: 'user', text, contexts: attached };
    partial = undefined;
    problem = '';
    retry = '';
    limit = false;
    if (!suggested) draft = '';
    pick = false;
    void scrollToLatest(true);
    let path = '';
    try {
      const attempt = await claimAttempt(initialSlot, JSON.stringify(question), previousCount, lastAttempt);
      if (controller.signal.aborted) return;
      lastAttempt = attempt;
      // A lost receipt can be retried after the workspace already received the saved pair.
      previousCount = Math.min(previousCount, attempt.startCount);
      if (!currentId) {
        const created = await api<Thread>(apiPath(w, 'threads'), 'POST', { title: text.slice(0, 100) }, {
          'Idempotency-Key': attempt.key,
        });
        if (controller.signal.aborted) return;
        currentId = created.id;
        result = created;
        remember(currentId);
      }
      const threadSlot = attemptSlot(currentId);
      rememberAttempt(threadSlot, attempt);
      path = apiPath(w, 'threads/' + encodeURIComponent(currentId) + '/messages');
      const response = await fetch(path, {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
        body: JSON.stringify(question),
        signal: controller.signal,
      });
      const completed = await readAnswer(response, lang, (message) => {
        if (controller.signal.aborted) return;
        const pinned = followsLatest();
        partial = message;
        if (pinned) void scrollToLatest();
      });
      if (controller.signal.aborted) return;
      const pinned = followsLatest();
      result = completed;
      pending = partial = undefined;
      forgetAttempt(initialSlot, attempt);
      forgetAttempt(threadSlot, attempt);
      forgetAttempt(attemptSlot(''), attempt);
      lastAttempt = undefined;
      workspaceRequest('POST', path, 200);
      // The received thread is already saved, even if refreshing the surrounding workspace fails.
      await invalidateAll().catch(() => undefined);
      if (controller.signal.aborted) return;
      if (!compact && page.params.threadId !== currentId)
        await goto(base + '/' + encodeURIComponent(currentId), { replaceState: true, noScroll: true, keepFocus: true });
      if (pinned && !controller.signal.aborted) await scrollToLatest();
    } catch (e) {
      if (controller.signal.aborted || !pending) return;
      if (path && e instanceof ApiError) workspaceRequest('POST', path, e.status);
      limit = e instanceof ApiError && e.status === 402;
      problem = e instanceof Error ? e.message : id ? 'Jawaban belum tersedia. Coba lagi.' : 'The answer is unavailable. Try again.';
      retry = text;
      if (!suggested && !draft.trim()) draft = typed || text;
    } finally {
      if (activeRequest === controller && !controller.signal.aborted) {
        activeRequest = undefined;
        busy = false;
        pending = partial = undefined;
      }
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
    pick = false;
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
      void showPicker(false);
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
      void scrollToLatest();
    }
  });
</script>

<svelte:window onkeydown={keydown} />
<div class="ev-panel assistant" class:compact>
  {#if compact}<header class="panel-head">
      <PageHeading art="quote" compact><h2 class="ev-title">{id ? 'Asisten perkara' : 'Case assistant'}</h2></PageHeading>
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
  <div
    class="conversation-flow"
    bind:this={flow}
    role="log"
    aria-live="polite"
    aria-relevant="additions"
    aria-label={id ? 'Pesan percakapan' : 'Conversation messages'}
  >
    {#if messages.length}
      {#if compact}<header class="thread-title">
          <h2 class="ev-title">{conversationTitle}</h2>
          {#if thread?.sample}<span class="ev-meta">{id ? 'Contoh sintetis' : 'Synthetic example'}</span>{/if}
        </header>{/if}
      <div class="log">
        {#each messages as m, index (index)}<ChatMessage
            {lang}
            workspace={w}
            message={m}
            streaming={m === partial}
            inspect={(t) => (inspect = t)}
          />{/each}
        {#if pending && !partial}
          <div class="reading" role="status">
            <span>{id ? 'Asisten perkara' : 'Case assistant'}</span>
            <span class="reading-status">{id ? 'Membaca sumber perkara…' : 'Reading the case record…'}</span>
            <div class="reading-lines" aria-hidden="true"><i></i><i></i><i></i></div>
          </div>
        {/if}
      </div>
    {:else}
      <div class="welcome">
        <p>
          {contexts.length
            ? id
              ? 'Tanyakan tentang sumber terlampir atau tambahkan sumber lain untuk membandingkan.'
              : 'Ask about the attached sources or add another to compare them.'
            : id
              ? 'Tanyakan tentang perkara ini. Anda bisa menyertakan sidang, dokumen, atau temuan.'
              : 'Ask about this case. You can attach a hearing, a document, or a finding.'}
        </p>
        <h3>{id ? 'Pertanyaan yang disarankan' : 'Suggested questions'}</h3>
        <div class="suggestions" data-tour="assistant-suggestions">
          {#each suggestions as q}<button disabled={busy || limit} onclick={() => send(q, true)}
              >{q}<ArrowUp size={14} aria-hidden="true" /></button
            >{/each}
        </div>
      </div>
    {/if}
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
      {#if !contexts.length}
        <span class="whole"
          ><FolderOpen size={14} aria-hidden="true" />{id ? 'Seluruh perkara' : 'Whole case'}</span
        >
      {:else}
        {#each contexts as ctx (key(ctx))}
          {@const label = sourceOf(w, ctx, lang)?.label ?? (id ? 'Sumber' : 'Source')}
          <button
            type="button"
            class="chip"
            title={label}
            aria-label={(id ? 'Hapus konteks ' : 'Remove context ') + label}
            onclick={() => remove(ctx)}
          >
            <span>{label}</span><X size={12} aria-hidden="true" />
          </button>
        {/each}
      {/if}
    </div>
    <div class="input-box">
      <label class="ev-only" for={compact ? 'panel-question' : 'case-question'}
        >{id ? 'Pertanyaan untuk asisten' : 'Question for the assistant'}</label
      >
      <textarea
        id={compact ? 'panel-question' : 'case-question'}
        bind:this={composer}
        bind:value={draft}
        rows="2"
        maxlength="8000"
        placeholder={id ? 'Tulis pertanyaan tentang perkara…' : 'Ask a question about this case…'}
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      ></textarea>
      <div class="send-row">
        <button
          type="button"
          class="add-context"
          bind:this={addContextButton}
          aria-expanded={pick}
          aria-controls={pick ? pickerId : undefined}
          onclick={() => showPicker(!pick)}
          ><Plus size={14} aria-hidden="true" />{id ? 'Tambah konteks' : 'Add context'}</button
        >
        <button
          type="button"
          class="legal-toggle"
          aria-pressed={searchLaw}
          title={lawHint}
          disabled={discovery === 'unavailable'}
          onclick={() => (withLegal = !withLegal)}
        >
          <Scale size={14} aria-hidden="true" />Pasal.id
        </button>
        <button
          type="submit"
          class="send"
          aria-label={id ? 'Kirim pertanyaan' : 'Send question'}
          title={id ? 'Kirim pertanyaan' : 'Send question'}
          disabled={!draft.trim() || busy || limit}
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
    {#if pick}
      <div
        id={pickerId}
        class="context-picker"
        role="group"
        aria-label={id ? 'Pilih hingga enam sumber' : 'Choose up to six sources'}
      >
        <div class="picker-head">
          <strong>{id ? 'Pilih hingga enam sumber' : 'Choose up to six sources'}</strong>
          <button type="button" class="done" onclick={() => showPicker(false)}
            >{id ? 'Selesai' : 'Done'}</button
          >
        </div>
        <label class="ev-search"
          ><Search size={14} aria-hidden="true" /><input
            type="search"
            bind:this={sourceSearch}
            bind:value={search}
            placeholder={id ? 'Cari konteks…' : 'Find a source…'}
            aria-label={id ? 'Cari konteks' : 'Find a source'}
          /></label
        >
        <div class="choices">
          {#each options as option (key(option.ref))}
            {@const active = contexts.some((c) => key(c) === key(option.ref))}
            <label
              ><input
                type="checkbox"
                checked={active}
                disabled={!active && contexts.length >= 6}
                onchange={() => toggle(option.ref)}
              />{option.label}</label
            >
          {:else}<p>{id ? 'Tidak ada sumber yang cocok.' : 'No matching sources.'}</p>{/each}
        </div>
      </div>
    {/if}
  </form>
</div>
{#if inspect}<Inspector workspace={w} {lang} target={inspect} close={() => (inspect = null)} />{/if}

<style>
  .assistant {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    color: var(--ink);
  }
  .compact {
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--surface);
  }
  .panel-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 10px 10px 16px;
    border-bottom: 1px solid var(--line);
  }
  .panel-head h2 {
    font: 600 15px/1.4 var(--sans);
  }
  .panel-head .ev-inline {
    gap: 2px;
  }
  .thread-title {
    padding: 0 0 12px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--line);
  }
  .thread-title h2 {
    font-size: 22px;
  }
  .conversation-flow {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 18px 20px;
    scrollbar-width: thin;
    scrollbar-color: var(--line-strong) transparent;
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .welcome {
    max-width: 640px;
  }
  .welcome p {
    margin: 0;
    color: var(--muted);
    font: 400 14px/1.55 var(--sans);
  }
  .welcome h3 {
    margin: 18px 0 7px;
    color: var(--muted);
    font: 600 12px/1.5 var(--sans);
  }
  .suggestions {
    display: grid;
    gap: 6px;
  }
  .suggestions button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    min-height: 42px;
    text-align: start;
    color: var(--ink-strong);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    font: 500 13.5px/1.5 var(--sans);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .suggestions button:hover {
    border-color: var(--line-strong);
    background: var(--surface);
  }
  .suggestions button :global(svg) {
    transform: rotate(45deg);
    color: var(--muted);
  }
  .suggestions button:disabled {
    opacity: 0.58;
  }
  .reading {
    min-width: 0;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    font: 600 12px/1.45 var(--sans);
    color: var(--muted);
  }
  .reading-status { margin-inline-start: 8px; font-weight: 400; }
  .reading-lines {
    display: grid;
    gap: 13px;
    margin: 14px 0 7px;
    max-width: 63ch;
  }
  .reading-lines i {
    width: 93%;
    height: 8px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--line-strong) 60%, var(--surface));
  }
  .reading-lines i:nth-child(2) { width: 78%; }
  .reading-lines i:last-child { width: 44%; }
  @media (prefers-reduced-motion: no-preference) {
    .reading-lines { animation: reading-pulse 1.6s ease-in-out infinite alternate; }
  }
  @keyframes reading-pulse { to { opacity: 0.5; } }
  .composer {
    position: relative;
    flex: none;
    display: grid;
    gap: 7px;
    padding: 10px 14px max(12px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .contexts,
  .whole,
  .chip,
  .add-context,
  .send-row,
  .picker-head,
  .done {
    display: flex;
    align-items: center;
  }
  .contexts {
    gap: 4px 6px;
    flex-wrap: wrap;
    max-height: 82px;
    overflow: auto;
    scrollbar-width: thin;
  }
  .whole,
  .chip,
  .add-context,
  .done {
    gap: 5px;
    font: 600 12px/1.35 var(--sans);
  }
  .whole {
    min-height: 20px;
    color: var(--muted);
    font-weight: 500;
  }
  .chip,
  .add-context,
  .done,
  .send {
    cursor: pointer;
    color: var(--ink);
  }
  .chip {
    max-width: 100%;
    min-height: 26px;
    padding: 2px 7px;
    background: var(--selected);
    border: 1px solid var(--line);
    border-radius: 20px;
  }
  .chip span {
    overflow: hidden;
    max-width: 28ch;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .add-context,
  .legal-toggle {
    min-height: 32px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    padding: 4px 10px;
  }
  .legal-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: 600 12px/1.35 var(--sans);
    color: var(--ink);
    cursor: pointer;
  }
  .legal-toggle[aria-pressed='true'] {
    color: var(--on-forest);
    background: var(--forest);
    border-color: var(--forest);
  }
  .legal-toggle:disabled {
    background: var(--surface-2);
    color: var(--muted);
    cursor: default;
  }
  .add-context:hover,
  .add-context[aria-expanded='true'],
  .chip:hover,
  .done:hover {
    background: var(--sunken);
  }
  .input-box {
    display: grid;
    gap: 3px;
    padding: 6px 7px 6px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 16px;
    background: var(--surface);
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .input-box:focus-within {
    border-color: var(--selected-line);
  }
  .input-box:has(textarea:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .input-box textarea {
    display: block;
    field-sizing: content;
    width: 100%;
    min-height: 46px;
    max-height: min(140px, 18dvh);
    padding: 4px 0;
    border: none;
    background: transparent;
    color: var(--ink);
    font: 400 15px/1.5 var(--sans);
    resize: none;
  }
  .input-box textarea:focus-visible {
    outline: none;
  }
  .send-row,
  .picker-head {
    justify-content: space-between;
    gap: 8px;
  }
  .send-row {
    justify-content: flex-start;
    gap: 6px;
  }
  .send {
    margin-left: auto;
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    color: var(--on-forest);
    background: var(--forest);
  }
  .send:hover:enabled {
    background: var(--ink-strong);
    color: var(--paper);
  }
  .send:disabled {
    background: var(--sunken);
    color: var(--muted);
    cursor: default;
  }
  .context-picker {
    position: absolute;
    z-index: 2;
    left: 12px;
    right: 12px;
    bottom: calc(100% - 4px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    max-height: min(340px, 40dvh);
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow-float);
  }
  .picker-head {
    color: var(--ink);
    font: 600 13px/1.4 var(--sans);
  }
  .context-picker .ev-search input {
    min-height: 36px;
    font-size: 14px;
    padding: 4px 0;
  }
  .done {
    min-height: 32px;
    padding: 4px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
  }
  .choices {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .choices label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 5px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  .choices label:hover {
    background: var(--sunken);
  }
  .choices input {
    width: 16px;
    height: 16px;
    flex: none;
    accent-color: var(--forest);
  }
  .choices p {
    margin: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .compact .conversation-flow {
    padding: 16px;
  }
  @media (max-width: 600px) {
    .conversation-flow {
      padding: 14px 12px;
    }
    .composer {
      padding-inline: 10px;
    }
    .input-box textarea {
      font-size: 16px;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .context-picker {
      animation: pick-in var(--dur-fast) var(--ease-out);
    }
  }
  @keyframes pick-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }
</style>
