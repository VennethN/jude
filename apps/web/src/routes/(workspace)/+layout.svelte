<script lang="ts">
  import { displayTitle, displaySpeaker, initials, timecode } from '$lib/workspace/format';
  import BrandLockup from '$lib/BrandLockup.svelte';
  import { page } from '$app/state';
  import { watchWorkspace, workspaceAccessLost } from '$lib/workspace/tab-cache';
  import { workspaceScope } from '$lib/workspace/scope';
  import { afterNavigate, goto, invalidate, replaceState } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import {
    ArrowRight,
    Check,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    Compass,
    Ellipsis,
    FileText,
    FolderOpen,
    House,
    Keyboard,
    LogOut,
    MessageSquare,
    PanelLeftClose,
    PanelLeftOpen,
    Pause,
    Play,
    Search as Lens,
    Settings2,
    Speech,
    Waypoints,
  } from '@lucide/svelte';
  import {
    needsReview,
    type ContextRef,
    type Preferences,
    type Statement,
    type Workspace,
  } from '@jude/core/domain';
  import { api, write } from '$lib/client';
  import { getCapture, pauseCapture } from '$lib/workspace/hearing-detail/active-recording.svelte';
  import { planById } from '@jude/core/plans';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import SheetHandle from '$lib/workspace/SheetHandle.svelte';
  import Search from '$lib/workspace/Search.svelte';
  import Tours from '$lib/workspace/Tours.svelte';
  import TourInvite from '$lib/workspace/TourInvite.svelte';
  import Assistant from '$lib/evidence/Assistant.svelte';
  import WorkspaceNavigation from '$lib/workspace/WorkspaceNavigation.svelte';
  let { data, children } = $props();
  const w = $derived(page.data.workspace as Workspace | undefined),
    en = $derived(data.lang === 'en'),
    account = $derived(data.account);
  const accountName = $derived(account.user.guest && account.user.name === 'Ruang contoh'
    ? (en ? 'Example workspace' : 'Ruang contoh') : account.user.name);
  const base = $derived(w ? '/case/' + w.caseRecord.id : '');
  const prefs = $derived(account.prefs),
    section = $derived(page.url.pathname.split('/')[3] ?? '');
  const nav = $derived([
    { path: '', key: 'o', name: en ? 'Overview' : 'Ringkasan', icon: House },
    { path: 'hearings', key: 'h', name: en ? 'Hearings' : 'Sidang', icon: Speech },
    { path: 'documents', key: 'd', name: en ? 'Documents' : 'Dokumen', icon: FileText },
    { path: 'findings', key: 'f', name: en ? 'Findings' : 'Temuan', icon: CircleAlert },
    { path: 'connections', key: 'c', name: en ? 'Connections' : 'Keterkaitan', icon: Waypoints },
  ]);
  const live = $derived(w?.hearings.find((h) => h.mode === 'live')),
    active = $derived(nav.find((n) => n.path === section)?.name ?? (en ? 'Assistant' : 'Asisten'));
  const reviewCount = $derived(w?.findings.filter(needsReview).length ?? 0);
  const planName = $derived(planById(account.plan.id).name[data.lang]);
  const lastLine = $derived.by(() => {
    if (!w || !live) return;
    let latest: Statement | undefined;
    for (const line of w.statements) {
      if (line.hearingId === live.id && (!latest || line.t > latest.t)) latest = line;
    }
    return latest;
  });
  const showLive = $derived(
    Boolean(w && live && !(section === 'hearings' && page.url.pathname.endsWith('/' + live.id))),
  );
  const speaker = $derived(lastLine && w ? displaySpeaker(w.speakers, lastLine.speakerId, data.lang) : '');
  const captureKey = $derived(w && live ? [account.user.id, w.caseRecord.id, live.id].join('/') : '');
  const capture = $derived(captureKey ? getCapture(captureKey) : null);
  let now = $state(0);
  $effect(() => {
    if (!showLive || w?.caseRecord.label !== 'private' || !live?.startedAt) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const elapsed = $derived.by(() => {
    if (capture) {
      const runningSeconds =
        capture.runningSince && now ? Math.max(0, (now - capture.runningSince) / 1000) : 0;
      return capture.elapsed + runningSeconds;
    }
    if (w?.caseRecord.label === 'private' && live?.startedAt && now) {
      return Math.max(0, (now - Date.parse(live.startedAt)) / 1000);
    }
    return lastLine?.t;
  });
  const back = $derived.by(() => {
    if (!w || !section) return { href: '/cases', label: en ? 'Cases' : 'Perkara' };
    if (page.url.pathname.split('/')[4]) return { href: base + '/' + section, label: active };
    return { href: base, label: en ? 'Overview' : 'Ringkasan' };
  });
  const caseCount = $derived(Array.isArray(page.data.cases) ? page.data.cases.length : 0);
  function sectionStatus(path: string) {
    if (path === 'hearings' && live)
      return w?.caseRecord.label === 'synthetic'
        ? en
          ? 'Example hearing in progress'
          : 'Contoh sidang berlangsung'
        : en
          ? 'Live hearing'
          : 'Sidang langsung';
    if (path === 'documents' && w?.documents.length)
      return w.documents.length + (en ? ' documents' : ' dokumen');
    if (path === 'findings' && reviewCount) return reviewCount + (en ? ' to review' : ' perlu diperiksa');
    return '';
  }
  const context = $derived.by((): ContextRef => {
    const parts = page.url.pathname.split('/'),
      id = parts[4];
    if (section === 'documents' && id)
      return page.url.searchParams.get('p')
        ? { kind: 'passage', id: page.url.searchParams.get('p')! }
        : { kind: 'document', id };
    if (section === 'hearings' && id) return { kind: 'hearing', id };
    if (section === 'findings' && id) return { kind: 'finding', id };
    if (section === 'findings' && page.url.searchParams.get('view') === 'board' && w?.boards.length)
      return { kind: 'board', id: page.url.searchParams.get('board') ?? w.boards[0].id };
    return section === 'documents' ? { kind: 'documents' } : { kind: 'case' };
  });
  let overlay = $state<'prefs' | 'search' | 'assistant' | 'tour' | 'shortcuts' | null>(null),
    tourFromOverview = $state(false),
    panelQuestion = $state(''),
    systemDark = $state(false),
    errorMsg = $state('');
  let viewportWidth = $state(0);
  const dockAssistant = $derived(viewportWidth >= 1280 && prefs.assistantMode !== 'overlay');
  const theme = $derived(
    prefs.theme === 'system' ? (systemDark ? 'night' : 'paper') : (prefs.theme ?? 'paper'),
  );
  onMount(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => (systemDark = m.matches);
    sync();
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  });
  $effect(() => watchWorkspace(workspaceScope(data.account), () => {
    void invalidate((key) => ['jude:session', 'jude:case', 'jude:case-library'].includes(key.href));
  }));
  $effect(() => {
    const id = w?.caseRecord.id;
    if (!id) return;
    const stream = new EventSource('/api/cases/' + id + '/events');
    const refresh = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        const version = msg.version ?? msg.data?.version;
        if (typeof version === 'number' && version !== page.data.workspace?.version)
          void invalidate('jude:case');
      } catch {}
    };
    stream.onmessage = refresh;
    stream.addEventListener('case.updated', refresh);
    stream.addEventListener('case.access-lost', () => { stream.close(); void workspaceAccessLost(); });
    stream.onerror = () => {
      // An HTTP permission failure during reconnect never delivers an SSE message.
      if (stream.readyState === EventSource.CLOSED) void invalidate('jude:case');
    };
    return () => stream.close();
  });
  async function save(options: Preferences) {
    try {
      await write('/api/me/prefs', 'PATCH', options);
      errorMsg = '';
    } catch {
      errorMsg = en ? 'Could not save preferences.' : 'Preferensi belum tersimpan.';
    }
  }
  async function logout() {
    try {
      await api('/api/auth/logout', 'POST');
      location.assign('/');
    } catch {
      errorMsg = en ? 'Could not sign out.' : 'Belum dapat keluar.';
    }
  }
  let noticeText = $state(''),
    noticePath = '',
    noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let chordUntil = 0,
    menuOpen = $state(false),
    menuAnchor = $state<HTMLDivElement>(),
    menuButton = $state<HTMLButtonElement>();
  afterNavigate(({ to, from }) => {
    if (to?.url.pathname.split('/')[3] === 'assistant' ||
        (from && to && from.url.pathname.split('/')[2] !== to.url.pathname.split('/')[2])) {
      if (overlay === 'assistant') closeAssistant();
    }
    chordUntil = 0;
    menuOpen = false;
    if (noticePath && noticePath !== to?.url.href) {
      clearTimeout(noticeTimer);
      noticeText = '';
      noticePath = '';
    }
  });
  function closeMenu(event: Event) {
    if (menuOpen && menuAnchor && !event.composedPath().includes(menuAnchor)) menuOpen = false;
  }
  function menuOverlay(next: 'prefs' | 'tour' | 'shortcuts') {
    menuOpen = false;
    menuButton?.focus();
    if (next === 'tour') tourFromOverview = false;
    overlay = next;
  }
  async function caseMenu() {
    menuOpen = false;
    menuButton?.focus();
    await goto(base, { keepFocus: true, state: { ...page.state, judeCaseMenu: true } });
  }
  $effect(() => {
    const { judeNotice, judeTour, judePanelQuestion, judeOpenAssistant, ...rest } = page.state as {
      judeNotice?: { text?: unknown };
      judeTour?: boolean;
      judePanelQuestion?: {caseId: string; text: string};
      judeOpenAssistant?: {caseId: string};
    };
    if (!judeNotice && !judeTour && !judePanelQuestion && !judeOpenAssistant) return;
    replaceState('', rest);
    if (judeOpenAssistant && judeOpenAssistant.caseId === w?.caseRecord.id) {
      panelQuestion = '';
      overlay = 'assistant';
    }
    if (judePanelQuestion?.caseId === w?.caseRecord.id && judePanelQuestion?.text) {
      panelQuestion = judePanelQuestion.text;
      overlay = 'assistant';
    }
    if (judeTour) {
      tourFromOverview = true;
      overlay = 'tour';
    }
    if (!judeNotice || typeof judeNotice.text !== 'string' || !judeNotice.text.trim()) return;
    clearTimeout(noticeTimer);
    noticePath = page.url.href;
    noticeText = judeNotice.text;
    noticeTimer = setTimeout(() => (noticeText = ''), 3600);
  });

  function closeAssistant() { overlay = null; panelQuestion = ''; }
  async function openSearch() {
    if (!w) {
      document.querySelector<HTMLInputElement>('#case-main input[type="search"]')?.focus();
      return;
    }
    overlay = 'search';
    await tick();
    document.querySelector<HTMLInputElement>('dialog[open] .search-in input')?.focus();
  }
  function consume(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape' && overlay === 'assistant' && dockAssistant &&
        !event.defaultPrevented && !document.querySelector('dialog:modal,.context-picker')) {
      consume(event);
      closeAssistant();
      return;
    }
    const typing = event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement &&
          (target.isContentEditable || target.matches('input,textarea,select,[role="textbox"]')),
      );
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || typing) {
      chordUntil = 0;
      return;
    }
    const key = event.key.toLowerCase();
    if (menuOpen) {
      chordUntil = 0;
      if (event.key === 'Escape') {
        consume(event);
        menuOpen = false;
        menuButton?.focus();
      }
      return;
    }
    if (overlay || document.querySelector('dialog[open],[aria-modal="true"],[role="menu"]')) {
      chordUntil = 0;
      if (
        overlay === 'assistant' &&
        key === 'a' &&
        !event.ctrlKey &&
        !event.metaKey &&
        document.querySelectorAll('dialog[open]').length === 1
      ) {
        consume(event);
        closeAssistant();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      chordUntil = 0;
      if (key === 'k' && !event.shiftKey && (w || page.url.pathname === '/cases')) {
        consume(event);
        void openSearch();
      }
      return;
    }
    if (chordUntil) {
      const link = performance.now() <= chordUntil && w ? nav.find((item) => item.key === key) : undefined;
      chordUntil = 0;
      if (link) {
        consume(event);
        void goto(base + (link.path ? '/' + link.path : ''));
        return;
      }
    }
    if (key === '/' && (w || page.url.pathname === '/cases')) {
      consume(event);
      void openSearch();
    } else if (key === '?') {
      consume(event);
      overlay = 'shortcuts';
    } else if (
      key === 'a' &&
      w &&
      section !== 'assistant' &&
      !document.querySelector('aside.quick,.inspector[open]')
    ) {
      consume(event);
      overlay = 'assistant';
    } else if (key === 'g' && w) {
      consume(event);
      chordUntil = performance.now() + 1200;
    }
  }
  onMount(() => {
    window.addEventListener('keydown', keys, true);
    document.addEventListener('pointerdown', closeMenu, true);
    document.addEventListener('focusin', closeMenu, true);
    return () => {
      window.removeEventListener('keydown', keys, true);
      document.removeEventListener('pointerdown', closeMenu, true);
      document.removeEventListener('focusin', closeMenu, true);
      clearTimeout(noticeTimer);
    };
  });
</script>

<svelte:window bind:innerWidth={viewportWidth}/>
<div
  class="desk"
  data-sveltekit-preload-data="tap"
  class:with-assistant={overlay === 'assistant' && dockAssistant}
  class:collapsed={prefs.railCollapsed}
  class:has-live={showLive}
  data-theme={theme}
  data-density={prefs.density ?? 'comfortable'}
>
  <a class="skip" href="#case-main">{en ? 'Skip to content' : 'Ke isi utama'}</a>
  <aside class="rail" id="workspace-rail">
    <a class="brand" href="/cases" aria-label="Jude"><BrandLockup monochrome/></a>
    {#if w}
      <a
        class="switch-case"
        href="/cases"
        title={(en ? 'Back to cases' : 'Kembali ke perkara') + ' · ' + displayTitle(w.caseRecord, data.lang)}
      >
        <span class="case-icon"><FolderOpen size={18} /></span><span class="tablet-label"
          >{en ? 'Cases' : 'Perkara'}</span
        >
        <span class="case-identity"
          ><strong>{displayTitle(w.caseRecord, data.lang)}</strong>{' '}<small
            >{w.caseRecord.reference ||
              (w.caseRecord.label === 'synthetic'
                ? en
                  ? 'Synthetic material'
                  : 'Materi sintetis'
                : en
                  ? 'Private case'
                  : 'Perkara privat')}</small
          ></span
        >
      </a>
      <nav aria-label={en ? 'Case sections' : 'Bagian perkara'} data-tour="sections">
        {#each nav as n}
          {@const status = sectionStatus(n.path)}
          <a
            class="rail-link section-link"
            href={base + (n.path ? '/' + n.path : '')}
            aria-label={n.name + (n.path === 'documents' && w.documents.length ? ' ' + w.documents.length : n.path === 'findings' && reviewCount ? ' ' + reviewCount : '')}
            aria-describedby={status ? 'rail-status-' + n.key : undefined}
            title={n.name + (status ? ' · ' + status : '')}
            aria-current={section === n.path ? 'page' : undefined}
          >
            <n.icon size={19} /><span class="section-name">{n.name}</span>
            {#if n.path === 'hearings' && live}<i class="rail-live" aria-hidden="true"></i>
            {:else if n.path === 'documents' && w.documents.length}<small
                class="rail-count"
                aria-hidden="true">{w.documents.length}</small
              >
            {:else if n.path === 'findings' && reviewCount}<small
                class="rail-count review-count"
                aria-hidden="true">{reviewCount}</small
              >{/if}
            {#if status}<span hidden id={'rail-status-' + n.key}>{status}</span>{/if}
          </a>
        {/each}
      </nav>
      <a
        class="rail-link assistant-link"
        href={base + '/assistant'}
        aria-label={en ? 'Case assistant' : 'Asisten perkara'}
        title={en ? 'Case assistant' : 'Asisten perkara'}
        aria-current={section === 'assistant' ? 'page' : undefined}
        ><MessageSquare size={19} /><span>{en ? 'Assistant' : 'Asisten'}</span></a
      >
    {:else}
      <a
        class="rail-link cases-link"
        aria-label={en ? 'My cases' : 'Daftar perkara'}
        title={en ? 'My cases' : 'Daftar perkara'}
        aria-current={page.url.pathname === '/cases' ? 'page' : undefined}
        href="/cases"
        ><FolderOpen size={19} /><span>{en ? 'Cases' : 'Perkara'}</span>{#if caseCount}<small
            class="rail-count">{caseCount}</small
          >{/if}</a
      >
    {/if}
    <div class="rail-foot">
      <button
        class="rail-link collapse-control"
        aria-controls="workspace-rail"
        aria-expanded={!prefs.railCollapsed}
        title={prefs.railCollapsed
          ? en
            ? 'Expand navigation'
            : 'Lebarkan navigasi'
          : en
            ? 'Collapse navigation'
            : 'Ciutkan navigasi'}
        aria-label={prefs.railCollapsed
          ? en
            ? 'Expand navigation'
            : 'Lebarkan navigasi'
          : en
            ? 'Collapse navigation'
            : 'Ciutkan navigasi'}
        onclick={() => save({ railCollapsed: !prefs.railCollapsed })}
      >
        {#if prefs.railCollapsed}<PanelLeftOpen size={18} />{:else}<PanelLeftClose size={18} />{/if}<span
          >{en ? 'Collapse navigation' : 'Ciutkan navigasi'}</span
        >
      </button>
      <div class="account-block">
        <button
          class="member"
          title={(en ? 'Preferences' : 'Preferensi') + ' · ' + accountName}
          onclick={() => (overlay = 'prefs')}
          ><span class="avatar" aria-hidden="true">{initials(accountName)}</span>{' '}<span class="tablet-label"
            >{en ? 'Account' : 'Akun'}</span
          >{' '}<span class="account-label"
            ><strong>{accountName}</strong>{' '}<small
              >{account.user.guest
                ? en
                  ? 'Guest workspace'
                  : 'Ruang tamu'
                : account.user.email || account.organization.name}</small
            ></span
          ></button
        >
        <a
          class="billing-link"
          href="/billing"
          title={planName + ' · ' + (en ? 'Plans and billing' : 'Paket dan tagihan')}
          ><span class="plate" data-plan={account.plan.id}>{planName}</span>{' '}<span class="tablet-label"
            >{en ? 'Plans' : 'Paket'}</span
          >{' '}<span class="billing-label">{en ? 'Plans and billing' : 'Paket dan tagihan'}</span></a
        >
      </div>
    </div>
  </aside>
  <div class="work">
    <header class="topbar">
      <nav class="breadcrumbs" aria-label={en ? 'Breadcrumb' : 'Lokasi halaman'}>
        {#if w}<a class="phone-back" href={back.href}><ChevronLeft size={17} />{back.label}</a>
          <a class="desktop-crumb" href={base} aria-current={!section ? 'page' : undefined}
            ><FolderOpen size={15} /><span>{displayTitle(w.caseRecord, data.lang)}</span></a
          >
          {#if section}<span class="crumb-section"><ChevronRight size={13} />{active}</span>{/if}
        {:else}<a class="outside-crumb" href="/cases"><FolderOpen size={16} />{en ? 'Cases' : 'Perkara'}</a
          >{/if}
      </nav>
      <div class="tools">
        {#if w}<button
            class="search-tool"
            aria-label={en ? 'Search hearings, findings, documents…' : 'Cari sidang, temuan, dokumen…'}
            aria-keyshortcuts="/ Control+K Meta+K"
            title={en ? 'Search the case' : 'Cari dalam perkara'}
            onclick={openSearch}
            ><Lens size={17} /><span
              >{en ? 'Search hearings, findings, documents…' : 'Cari sidang, temuan, dokumen…'}</span
            ><kbd>/</kbd></button
          >
          <button
            class="assistant-tool"
            aria-label={en ? 'Open case assistant' : 'Buka asisten perkara'}
            title={en ? 'Open case assistant' : 'Buka asisten perkara'}
            aria-keyshortcuts="A"
            aria-expanded={overlay === 'assistant'}
            onclick={() => { if (overlay === 'assistant') closeAssistant(); else { panelQuestion = ''; overlay = 'assistant'; } }}
            ><MessageSquare size={17} /><span>{en ? 'Assistant' : 'Asisten'}</span></button
          >
        {/if}
        <div class="menu-anchor" bind:this={menuAnchor}>
          <button
            class="menu-tool"
            bind:this={menuButton}
            aria-label={en ? 'Workspace menu' : 'Menu ruang kerja'}
            title={en ? 'Workspace menu' : 'Menu ruang kerja'}
            aria-expanded={menuOpen}
            aria-controls="workspace-actions"
            onclick={() => (menuOpen = !menuOpen)}><Ellipsis size={20} /></button
          >
          {#if menuOpen}
            <div
              class="menu-list"
              id="workspace-actions"
              role="group"
              aria-label={en ? 'Workspace actions' : 'Tindakan ruang kerja'}
            >
              {#if w}<button onclick={caseMenu}
                  ><FolderOpen size={16} />{en ? 'Case actions' : 'Tindakan perkara'}</button
                >{/if}
              <button onclick={() => menuOverlay('tour')}
                  ><Compass size={16} />{en ? 'Guided tours' : 'Panduan perkara'}</button
                >
              <button
                class="shortcut-tool"
                aria-keyshortcuts="Shift+/"
                onclick={() => menuOverlay('shortcuts')}
                ><Keyboard size={16} />{en ? 'Keyboard shortcuts' : 'Pintasan keyboard'}<kbd>?</kbd></button
              >
              <button onclick={() => menuOverlay('prefs')}
                ><Settings2 size={16} />{en ? 'Preferences' : 'Preferensi'}</button
              >
              <a class="phone-account" href="/billing"
                ><FileText size={16} />{en ? 'Plans and billing' : 'Paket dan tagihan'}</a
              >
              <button class="phone-account" onclick={logout}
                ><LogOut size={16} />{en ? 'Sign out' : 'Keluar'}</button
              >
            </div>
          {/if}
        </div>
      </div>
    </header>
    {#if w && live && showLive}
      <div class="session-strip">
        <a
          class="session-link"
          href={base + '/hearings/' + live.id}
          title={(en ? 'Open hearing' : 'Buka sidang') +
            ' ' +
            live.number +
            ' · ' +
            live.title[data.lang]}
        >
          <span class="session-state"
            ><i></i><strong
              >{w.caseRecord.label === 'synthetic'
                ? en
                  ? 'Example hearing'
                  : 'Sidang contoh'
                : capture?.state === 'paused'
                  ? en
                    ? 'Paused'
                    : 'Dijeda'
                  : en
                    ? 'Live'
                    : 'Langsung'}</strong
            ></span
          >
          {#if elapsed !== undefined}<time>{timecode(elapsed)}</time>{/if}
          {#if speaker}<span class="speaker-avatar" title={speaker} aria-hidden="true"
              >{initials(speaker).slice(0, 1)}</span
            >{/if}
          <span class="session-copy"
            ><b>{en ? 'Hearing' : 'Sidang'} {live.number} · {live.title[data.lang]}</b>{#if lastLine}{' '}<span
                >{lastLine.text}</span
              >{/if}</span
          >
          <span class="session-open"
            ><span>{en ? 'Return to hearing' : 'Kembali ke sidang'}</span><ArrowRight size={15} /></span
          >
        </a>
        {#if capture && ['recording', 'offline', 'paused'].includes(capture.state)}
          <button
            class="capture-toggle"
            aria-label={capture.state === 'paused'
              ? en
                ? 'Resume microphone'
                : 'Lanjutkan mikrofon'
              : en
                ? 'Pause microphone'
                : 'Jeda mikrofon'}
            title={capture.state === 'paused'
              ? en
                ? 'Resume microphone'
                : 'Lanjutkan mikrofon'
              : en
                ? 'Pause microphone'
                : 'Jeda mikrofon'}
            onclick={() => pauseCapture(captureKey, capture?.state !== 'paused')}
          >
            {#if capture.state === 'paused'}<Play size={16} />{:else}<Pause size={16} />{/if}
          </button>
        {/if}
      </div>
    {/if}
    <main id="case-main" tabindex="-1" class="content">
      {#if !account.prefs.tourSeen && overlay !== 'tour' && (account.demo || !w || !section)}<TourInvite {en} demo={!!account.demo} register={!w} compact={section === 'assistant' && !!page.params.threadId}/>{/if}
      <WorkspaceNavigation {en}>{@render children()}</WorkspaceNavigation>
    </main>
  </div>
  {#if w}
    <nav class="phone-nav" aria-label={en ? 'Case navigation' : 'Navigasi perkara'} data-tour="sections">
      {#each nav as n}
        {@const status = sectionStatus(n.path)}
        <a
          href={base + (n.path ? '/' + n.path : '')}
          aria-describedby={status ? 'phone-status-' + n.key : undefined}
          aria-current={section === n.path ? 'page' : undefined}
        >
          <span class="phone-icon"
            ><n.icon size={19} />
            {#if n.path === 'hearings' && live}<i class="phone-live" aria-hidden="true"></i>
            {:else if n.path === 'findings' && reviewCount}<small class="phone-count" aria-hidden="true"
                >{reviewCount}</small
              >{/if}
          </span><span class="phone-name">{n.name}</span>
          {#if status}<span hidden id={'phone-status-' + n.key}>{status}</span>{/if}
        </a>
      {/each}
    </nav>
  {/if}
  <div class="shell-feedback" role="status" aria-live="polite" aria-atomic="true">
    {#if noticeText}<div class="notice"><Check size={18} aria-hidden="true" />{noticeText}</div>{/if}
  </div>
  {#if overlay === 'shortcuts'}
    <Dialog
      title={en ? 'Keyboard shortcuts' : 'Pintasan keyboard'}
      lang={data.lang}
      close={() => (overlay = null)}
    >
      <dl class="shortcuts">
        <dt>{w ? (en ? 'Search this case' : 'Cari di perkara ini') : en ? 'Find a case' : 'Cari perkara'}</dt>
        <dd><kbd>/</kbd><span>{en ? 'or' : 'atau'}</span><kbd>Ctrl / ⌘</kbd><kbd>K</kbd></dd>
        {#if w}
          {#each nav as n}<dt>{n.name}</dt>
            <dd><kbd>G</kbd><span>{en ? 'then' : 'lalu'}</span><kbd>{n.key.toUpperCase()}</kbd></dd>{/each}
          <dt>{en ? 'Case assistant' : 'Asisten perkara'}</dt>
          <dd><kbd>A</kbd></dd>
        {/if}
        <dt>{en ? 'Close the dialog' : 'Tutup dialog'}</dt>
        <dd><kbd>Esc</kbd></dd>
        <dt>{en ? 'Show shortcuts' : 'Tampilkan pintasan'}</dt>
        <dd><kbd>?</kbd></dd>
      </dl>
    </Dialog>
  {/if}
  {#if overlay === 'search' && w}<Search workspace={w} lang={data.lang} close={() => (overlay = null)} />{/if}
  {#if overlay === 'tour'}<Tours
      workspace={w}
      cases={page.data.cases ?? []}
      startOverview={tourFromOverview}
      session={account}
      lang={data.lang}
      close={() => (overlay = null)}
    />{/if}
  {#if overlay === 'assistant' && w}<Dialog
      title={en ? 'Case assistant' : 'Asisten perkara'}
      lang={data.lang}
      close={closeAssistant}
      side docked={dockAssistant}
    >
      <SheetHandle dismiss={closeAssistant}/>
      <div class="assistant-wrap" data-tour="assistant-panel">
        <Assistant workspace={w} lang={data.lang} compact {context} initialQuestion={panelQuestion} onClose={closeAssistant}/>
      </div>
    </Dialog>{/if}
  {#if overlay === 'prefs'}<Dialog
      art="bookmark"
      title={en ? 'Preferences' : 'Preferensi'}
      lang={data.lang}
      close={() => (overlay = null)}
    >
      <div class="stack">
        <form method="POST" action="/language" class="field">
          <label for="ui-language">{en ? 'Interface language' : 'Bahasa antarmuka'}</label><input
            type="hidden"
            name="next"
            value={page.url.pathname + page.url.search}
          /><select
            id="ui-language"
            name="lang"
            value={data.lang}
            onchange={(e) => e.currentTarget.form?.requestSubmit()}
            ><option value="id">Bahasa Indonesia</option><option value="en">English</option></select
          >
        </form>
        <p class="small muted">{en
          ? 'Jude’s controls and explanations follow this language. Verbatim testimony, source documents, official legal references, names and your own notes keep their original wording.'
          : 'Kontrol dan penjelasan Jude mengikuti bahasa ini. Keterangan verbatim, dokumen sumber, rujukan hukum resmi, nama, dan catatan Anda tetap menggunakan redaksi aslinya.'}</p>
        <label class="field"
          >{en ? 'Appearance' : 'Tampilan'}<select
            value={prefs.theme ?? 'paper'}
            onchange={(e) => save({ theme: e.currentTarget.value as Preferences['theme'] })}
            ><option value="paper">{en ? 'Paper' : 'Kertas'}</option><option value="night"
              >{en ? 'Night' : 'Malam'}</option
            ><option value="system">{en ? 'Device setting' : 'Ikuti perangkat'}</option></select
          ></label
        >
        <label class="field"
          >{en ? 'Row spacing' : 'Jarak baris'}<select
            value={prefs.density ?? 'comfortable'}
            onchange={(e) => save({ density: e.currentTarget.value as Preferences['density'] })}
            ><option value="comfortable">{en ? 'Comfortable' : 'Lapang'}</option><option value="compact"
              >{en ? 'Compact' : 'Rapat'}</option
            ></select
          ></label
        >
        {#if errorMsg}<p class="error-text" role="alert">{errorMsg}</p>{/if}
        <div class="actions">
          <a class="button" href="/billing">{en ? 'Plan and usage' : 'Paket dan pemakaian'}</a><button
            class="button"
            onclick={logout}><LogOut size={16} />{en ? 'Sign out' : 'Keluar'}</button
          >
        </div>
      </div>
    </Dialog>{/if}
</div>

<style>
  .desk {
    --rail-width: 244px;
    --nav: #183b2d;
    --nav-ink: #f6f0e4;
    --nav-muted: #c2d0c0;
    --bar-height: 56px;
    --gutter: clamp(20px, 3vw, 40px);
    min-height: 100dvh;
    background: var(--paper);
    color: var(--ink);
  }
  .desk.collapsed {
    --rail-width: 72px;
  }
  .skip {
    position: fixed;
    top: -100px;
    left: 12px;
    z-index: 100;
    background: var(--surface);
    color: var(--ink);
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .skip:focus {
    top: 8px;
  }
  .rail {
    position: fixed;
    inset: 0 auto 0 0;
    width: var(--rail-width);
    background: var(--nav);
    color: var(--nav-ink);
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 20;
    overflow: auto;
  }
  .rail .brand {
    display: flex;
    align-items: center;
    padding: 0 6px 12px;
    margin: 0 0 4px;
    font:
      400 36px/1 Rufina,
      Georgia,
      serif;
    color: var(--nav-ink);
    letter-spacing: -0.045em;
  }
  .switch-case {
    display: flex;
    align-items: center;
    min-height: 52px;
    gap: 10px;
    padding: 8px;
    margin-bottom: 12px;
    text-decoration: none;
    border-radius: 8px;
    background: #29483b;
    box-shadow: inset 0 0 0 1px #ffffff0b;
  }
  .switch-case:hover,
  .rail-link:hover,
  .member:hover,
  .billing-link:hover {
    background: #315144;
    color: var(--nav-ink);
  }
  .case-icon,
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    background: var(--nav-ink);
    color: var(--nav);
  }
  .case-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }
  .case-identity,
  .account-label {
    min-width: 0;
  }
  .case-identity strong,
  .case-identity small,
  .account-label strong,
  .account-label small {
    display: block;
  }
  .case-identity strong {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-size: 13px;
    line-height: 1.3;
    font-weight: 600;
  }
  .case-identity small {
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--nav-muted);
    font: 400 12px/1.3 var(--sans);
  }
  .rail nav {
    display: grid;
    gap: 3px;
  }
  .rail-link,
  .member,
  .billing-link {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    text-align: left;
    text-decoration: none;
    color: var(--nav-muted);
    background: transparent;
    border: 0;
    border-radius: 8px;
  }
  .rail-link {
    position: relative;
    min-height: 40px;
    padding: 7px 12px;
    font: 500 14px/1.25 var(--sans);
  }
  .rail-link :global(svg) {
    flex: none;
    stroke-width: 1.65px;
  }
  .section-name {
    flex: 1;
  }
  .rail-link[aria-current='page'] {
    background: var(--nav-ink);
    color: var(--nav);
  }
  [data-theme='night'] .rail-link[aria-current='page'] {
    background: #345544;
    color: var(--nav-ink);
  }
  .rail-count,
  .rail-live {
    flex: none;
    margin-left: auto;
  }
  .rail-count,
  .phone-count {
    min-width: 20px;
    text-align: center;
    padding: 3px 6px;
    border-radius: 1em;
    font: 600 11px/1.2 var(--sans);
    font-variant-numeric: tabular-nums;
  }
  .rail-count {
    color: var(--nav-ink);
    background: #426153;
  }
  .review-count,
  .phone-count {
    color: #483113;
    background: #f2dcae;
  }
  .rail-live,
  .phone-live {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d27f61;
  }
  .rail-foot {
    margin-top: auto;
    padding-top: 24px;
  }
  .collapse-control {
    margin-bottom: 10px;
  }
  .account-block {
    border: 1px solid #496349;
    border-radius: 8px;
    padding: 4px;
  }
  .member {
    min-height: 46px;
    gap: 9px;
    padding: 5px;
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    font: 600 13px var(--sans);
  }
  .account-label strong,
  .account-label small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account-label strong {
    font: 600 13px/1.3 var(--sans);
    color: var(--nav-ink);
  }
  .account-label small {
    margin-top: 2px;
    font: 400 12px/1.35 var(--sans);
    color: var(--nav-muted);
  }
  .billing-link {
    min-height: 36px;
    padding: 4px 5px;
    justify-content: space-between;
    gap: 6px;
  }
  .billing-label {
    font-size: 12px;
  }
  .plate {
    border-radius: 4px;
    border: 1px solid #a6b5a3;
    padding: 2px 7px;
    color: var(--nav-ink);
    font: 400 14px/1.1 var(--display);
  }
  .plate[data-plan='pro'],
  .plate[data-plan='firm'] {
    border-color: #bfa479;
  }
  .plate[data-plan='partner'] {
    border-color: #c6c8c4;
  }
  .rail a:focus-visible,
  .rail button:focus-visible {
    outline: 2px solid #f0d293;
    outline-offset: 1px;
  }
  .work {
    margin-left: var(--rail-width);
    min-width: 0;
  }
  .with-assistant .work { margin-inline-end:404px; }
  .assistant-wrap { height:100%; min-height:0; }
  @media (max-width:719px) { .assistant-wrap { padding-top:16px; } }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: var(--bar-height);
    padding: 5px clamp(14px, 2.1vw, 28px);
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }
  .breadcrumbs,
  .desktop-crumb,
  .outside-crumb,
  .crumb-section,
  .tools {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .breadcrumbs {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .breadcrumbs a {
    min-width: 0;
    color: var(--ink);
    text-decoration: none;
  }
  .desktop-crumb {
    font-weight: 600;
  }
  .desktop-crumb span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .breadcrumbs :global(svg) {
    flex: none;
  }
  .crumb-section {
    color: var(--muted);
  }
  .tools {
    flex: none;
    gap: 6px;
  }
  .tools button,
  .menu-list a {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink);
    font-size: 13px;
  }
  .tools .search-tool,
  .tools .assistant-tool {
    height: 36px;
    min-width: 36px;
    padding: 0 10px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .tools .search-tool {
    color: var(--muted);
  }
  .tools .menu-tool {
    height: 36px;
    width: 36px;
    justify-content: center;
  }
  .tools kbd,
  .shortcuts kbd {
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--surface);
    font: 500 12px/1.25 var(--mono);
    padding: 2px 5px;
  }
  .tools .search-tool kbd {
    margin-left: 6px;
  }
  .menu-anchor {
    position: relative;
  }
  .menu-list {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 50;
    min-width: 202px;
    padding: 5px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
    box-shadow: 0 5px 16px #14251b24;
  }
  .menu-list button,
  .menu-list a {
    display: flex;
    width: 100%;
    min-height: 39px;
    padding: 7px 9px;
    text-align: left;
    text-decoration: none;
  }
  .menu-list kbd {
    margin-left: auto;
  }
  .menu-list .phone-account {
    display: none;
  }
  .tools button:hover,
  .menu-list a:hover,
  .tools button[aria-expanded='true'] {
    background: var(--wash);
  }
  .phone-back,
  .tablet-label,
  .phone-nav {
    display: none;
  }
  .session-strip {
    position: sticky;
    top: var(--bar-height);
    z-index: 14;
    min-height: 50px;
    display: flex;
    align-items: stretch;
    gap: 5px;
    padding: 0 clamp(14px, 2.1vw, 28px);
    border-bottom: 1px solid #d9c4b2;
    background: color-mix(in srgb, var(--paper) 92%, #bc7650);
  }
  .session-link {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 12px;
    padding-block: 5px;
    color: var(--ink);
    text-decoration: none;
    font-size: 12px;
  }
  .capture-toggle {
    display: grid;
    place-items: center;
    align-self: center;
    width: 44px;
    height: 44px;
    color: var(--ink);
    border: 0;
    border-radius: 6px;
    background: transparent;
  }
  .capture-toggle:hover {
    background: var(--wash);
  }
  .speaker-avatar {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    flex: none;
    border-radius: 50%;
    background: #795519;
    color: #fff7e5;
    font: 600 12px var(--sans);
  }
  .session-state,
  .session-open {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .session-state i {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: #b04f33;
  }
  .session-state strong {
    font-weight: 600;
  }
  .session-link time {
    white-space: nowrap;
    font: 400 12px var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .session-copy {
    display: grid;
    min-width: 0;
    line-height: 1.3;
  }
  .session-copy b,
  .session-copy > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-copy b {
    font-size: 13px;
    font-weight: 600;
  }
  .session-copy > span {
    color: var(--ink);
    font-size: 12px;
  }
  .session-open {
    margin-left: auto;
    font-weight: 600;
  }
  .content {
    margin: 0 auto;
    max-width: 1520px;
    min-width: 0;
    min-height: 55dvh;
    padding: clamp(24px, 3vw, 40px) var(--gutter) 80px;
    outline: none;
  }
  .shortcuts {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
  }
  .shortcuts dt,
  .shortcuts dd {
    min-height: 38px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
  }
  .shortcuts dd {
    justify-content: flex-end;
    gap: 5px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .shell-feedback {
    position: fixed;
    inset: auto var(--gutter) 18px auto;
    z-index: 80;
    pointer-events: none;
    max-width: min(440px, calc(100% - 28px));
  }
  .notice {
    display: flex;
    gap: 9px;
    align-items: center;
    background: #20392d;
    color: #faf7e9;
    padding: 12px 17px;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 18px #10211633;
  }
  .collapsed .rail-link > span,
  .collapsed .account-label,
  .collapsed .case-identity,
  .collapsed .billing-label,
  .collapsed .rail-count {
    display: none;
  }
  .collapsed .brand {
    --jude-name-display: none;
  }
  .collapsed .rail {
    padding-inline: 9px;
  }
  .collapsed .rail .brand,
  .collapsed .rail-link,
  .collapsed .switch-case,
  .collapsed .billing-link,
  .collapsed .member {
    justify-content: center;
    text-align: center;
    padding-inline: 0;
  }
  .collapsed .plate {
    overflow: hidden;
    text-indent: -100px;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    background: #546e54;
  }
  .collapsed .account-block {
    border-color: transparent;
  }
  .collapsed .rail .review-count,
  .collapsed .rail .rail-live {
    display: block;
    position: absolute;
    top: 6px;
    right: 7px;
    min-width: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    padding: 0;
    font-size: 0;
  }
  @media (min-width: 720px) and (max-width: 1059px) {
    .desk,
    .desk.collapsed {
      --rail-width: 72px;
    }
    .rail {
      padding-inline: 7px;
    }
    .rail .brand,
    .rail-link,
    .switch-case,
    .billing-link,
    .member {
      justify-content: center;
      text-align: center;
      padding-inline: 0;
    }
    .rail-link > span,
    .account-label,
    .case-identity,
    .billing-label,
    .rail-count,
    .collapse-control {
      display: none;
    }
    .rail .brand {
      --jude-name-display: none;
    }
    .account-block {
      border-color: transparent;
    }
    .plate {
      overflow: hidden;
      text-indent: -100px;
      width: 18px;
      height: 18px;
      padding: 0;
      border-radius: 50%;
      background: #546e54;
    }
    .rail .review-count,
    .rail .rail-live {
      display: block;
      position: absolute;
      top: 6px;
      right: 9px;
      min-width: 0;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      padding: 0;
      font-size: 0;
    }
    .session-copy {
      max-width: 57vw;
    }
  }
  @media (min-width: 720px) and (max-width: 1059px) and (pointer: coarse) {
    .section-link,
    .assistant-link,
    .cases-link,
    .member,
    .billing-link,
    .switch-case {
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      min-height: 54px;
      padding: 5px 0;
    }
    .rail .section-link .section-name,
    .rail .assistant-link > span,
    .rail .cases-link > span,
    .rail .tablet-label {
      display: block;
      flex: none;
      font-size: 11px;
      line-height: 1.25;
    }
    .section-link .rail-live,
    .section-link .review-count {
      right: 13px;
      top: 5px;
    }
  }
  @media (pointer: coarse) {
    .menu-list .shortcut-tool,
    .tools kbd {
      display: none;
    }
    .rail-link,
    .tools .search-tool,
    .tools .assistant-tool,
    .tools .menu-tool,
    .menu-list button,
    .menu-list a,
    .billing-link {
      min-height: 44px;
    }
    .tools .search-tool,
    .tools .assistant-tool,
    .tools .menu-tool {
      min-width: 44px;
    }
  }
  @media (max-width: 719px) {
    .desk,
    .desk.collapsed {
      --rail-width: 0px;
      --gutter: 16px;
    }
    .rail,
    .desktop-crumb,
    .crumb-section {
      display: none;
    }
    .topbar {
      padding: 4px 6px;
      gap: 2px;
    }
    .phone-back {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: 44px;
      padding: 0 5px;
      font-size: 14px;
    }
    .outside-crumb {
      margin-left: 7px;
    }
    .tools {
      gap: 0;
    }
    .tools .search-tool,
    .tools .assistant-tool,
    .tools .menu-tool {
      width: 42px;
      height: 44px;
      justify-content: center;
      padding: 0;
      border: 0;
      background: transparent;
    }
    .tools .search-tool > span,
    .tools .assistant-tool > span,
    .tools kbd {
      display: none;
    }
    .menu-list .phone-account {
      display: flex;
    }
    .content {
      padding: 18px var(--gutter) 95px;
    }
    .desk.has-live .content {
      padding-bottom: 156px;
    }
    .phone-nav {
      position: fixed;
      z-index: 30;
      left: 10px;
      right: 10px;
      bottom: max(10px, env(safe-area-inset-bottom));
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      height: 60px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 30px;
      background: var(--surface);
      box-shadow: 0 3px 13px #14251b22;
    }
    .phone-nav a {
      display: grid;
      justify-items: center;
      align-content: center;
      gap: 2px;
      min-width: 0;
      min-height: 44px;
      text-decoration: none;
      color: var(--muted);
      font: 600 10.5px/1.2 var(--sans);
      border-radius: 24px;
    }
    .phone-nav a[aria-current='page'] {
      color: var(--ink);
      background: var(--wash);
    }
    .phone-nav a:focus-visible {
      outline: 2px solid var(--ink);
      outline-offset: -2px;
    }
    .phone-icon {
      position: relative;
      display: grid;
      place-items: center;
      width: 28px;
      height: 23px;
    }
    .phone-live,
    .phone-count {
      position: absolute;
      right: -1px;
      top: 0;
      outline: 2px solid var(--surface);
    }
    .phone-live {
      background: #b04f33;
    }
    .phone-count {
      right: -5px;
      top: -2px;
      min-width: 15px;
      padding: 1px 4px;
      font-size: 10px;
    }
    .phone-name {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-strip {
      position: fixed;
      inset: auto 10px calc(max(10px, env(safe-area-inset-bottom)) + 65px);
      min-height: 50px;
      padding: 0 10px;
      z-index: 29;
      border: 1px solid #d8c4b5;
      border-radius: 14px;
      box-shadow: 0 2px 9px #251b1317;
    }
    .session-link {
      gap: 7px;
    }
    .speaker-avatar {
      width: 28px;
      height: 28px;
    }
    .session-state {
      gap: 4px;
    }
    .session-state strong,
    .session-copy > span,
    .session-open > span {
      display: none;
    }
    .session-copy b {
      font-size: 12px;
    }
    .session-open {
      flex: none;
    }
    .shell-feedback {
      inset: auto 10px calc(max(10px, env(safe-area-inset-bottom)) + 68px) auto;
    }
    .has-live .shell-feedback {
      bottom: calc(max(10px, env(safe-area-inset-bottom)) + 116px);
    }
  }
</style>
