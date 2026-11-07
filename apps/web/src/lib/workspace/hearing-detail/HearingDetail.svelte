<script lang="ts">
  import PageHeading from '$lib/workspace/PageHeading.svelte';
  import { goto, invalidate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick, untrack } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    CalendarDays,
    Check,
    ChevronRight,
    MessageSquareReply,
    FileText,
    Ellipsis,
    MessageSquare,
    Mic,
    Moon,
    Pause,
    Play,
    Radio,
    Search,
    SlidersHorizontal,
    Square,
    Sun
  } from '@lucide/svelte';
  import type {
    Finding,
    Hearing,
    InspectTarget,
    Lang,
    Preferences,
    SessionInfo,
    Speaker,
    Statement,
    Workspace
  } from '@jude/core/domain';
  import { needsReview } from '@jude/core/domain';
  import { api, write, ApiError } from '$lib/client';
  import Inspector from '$lib/evidence/Inspector.svelte';
  import { apiPath, assistantPath, casePath } from '$lib/evidence/records';
  import '$lib/evidence/evidence.css';
  import Dialog from '../Dialog.svelte';
  import HearingForm from '../HearingForm.svelte';
  import { formatDate, timecode } from '../format';
  import Transcript from './Transcript.svelte';
  import HearingTransport from './HearingTransport.svelte';
  import QuickLook from './QuickLook.svelte';
  import LiveFindingCallout from './LiveFindingCallout.svelte';
  import HearingFindings from './HearingFindings.svelte';
  import VoiceDialog from './VoiceDialog.svelte';
  import type { LiveTranscriptTurn } from '../microphone';
  import { runReplay } from './replay';
  import { getCapture, connectCapture, pauseCapture, stopCapture } from './active-recording.svelte';
  import { speakerShares, speakerTurns, voice } from './people';
  import './hearing.css';

  let {
    workspace: w,
    hearingId,
    lang,
    account,
    transcription
  }: {
    workspace: Workspace;
    hearingId: string;
    lang: Lang;
    account: SessionInfo;
    transcription: boolean;
  } = $props();
  let en = $derived(lang === 'en'),
    h = $derived(w.hearings.find((h) => h.id === hearingId)!),
    base = $derived(casePath(w));
  let live = $derived(h.mode === 'live'),
    scheduled = $derived(h.mode === 'scheduled'),
    synthetic = $derived(w.caseRecord.label === 'synthetic');
  let canRecord = $derived(
    !synthetic && !h.closed && !account.user.guest && h.recordingPermission?.by === account.user.id
  );
  let ownSession = $derived(synthetic || canRecord),
    key = $derived([account.user.id, w.caseRecord.id, h.id].join('/')),
    capture = $derived(getCapture(key));
  let lines = $derived(w.statements.filter((s) => s.hearingId === h.id).sort((a, b) => a.t - b.t));
  let findings = $derived(
    w.findings
      .filter((f) => f.hearingId === h.id)
      .sort((a, b) => (times.get(a.statementId) ?? 0) - (times.get(b.statementId) ?? 0))
  );
  let times = $derived(new Map(lines.map((s) => [s.id, s.t]))),
    replies = $derived(
      w.replies.filter((r) => r.hearingId === h.id && voice(w.speakers, r.forId, lang).role === 'counsel')
    );
  let alerts = $derived(
    findings
      .filter(needsReview)
      .sort(
        (a, b) => weight(b) - weight(a) || (times.get(b.statementId) ?? 0) - (times.get(a.statementId) ?? 0)
      )
  );
  let currentReply = $derived(replies.find((r) => r.statementId === lines.at(-1)?.id));
  let now = $state(0), replayClock = $state(0), spoken = $state<LiveTranscriptTurn>();
  $effect(() => {
    if (!live || !synthetic || replayPaused || replayDone) return;
    const initial = untrack(() => Math.max(replayClock, lines.at(-1)?.t ?? 0));
    const started = performance.now();
    replayClock = initial;
    const timer = setInterval(() => replayClock = initial + (performance.now() - started) / 1000, 200);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (!live || synthetic) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  let elapsed = $derived(
    synthetic
      ? Math.max(replayClock, lines.at(-1)?.t ?? 0)
      : capture
        ? capture.elapsed + (capture.runningSince ? Math.max(0, (now - capture.runningSince) / 1000) : 0)
        : h.startedAt && now
          ? Math.max(0, (now - Date.parse(h.startedAt)) / 1000)
          : (lines.at(-1)?.t ?? 0)
  );
  let replayPaused = $state(false),
    replayDone = $state(false),
    busy = $state(false),
    issue = $state(''),
    boardNotice = $state('');
  let dialog = $state<'' | 'start' | 'end' | 'capture' | 'view' | 'counsel'>(''),
    keep = $state(false),
    edit = $state<Speaker>(),
    inspect = $state<InspectTarget>(),
    brief = $state(''),
    replyId = $state('');
  let finding = $derived(findings.find((f) => f.id === brief)),
    reply = $derived(replies.find((r) => r.id === replyId)),
    quick = $derived(!!(finding || reply));
  let stageWidth = $state(0), ready = $state(false);
  let systemDark = $state(false);
  const night = $derived(account.prefs.theme === 'night' || (account.prefs.theme === 'system' && systemDark));
  onMount(() => {
    ready = true;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => systemDark = media.matches;
    changed();
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  });
  let findingOpener: HTMLElement | undefined;
  let audio = $state<HTMLAudioElement>(),
    transcript = $state<Transcript>(),
    pos = $state(0),
    picked = $state(''),
    playing = $state(false),
    audioError = $state(false);
  let playbackRate = $state(1), audioLength = $state(0);
  const replay = $derived(synthetic && h.mode === 'recorded' && !h.audio && lines.length > 0);
  const canPlay = $derived(!!h.audio || replay);
  const trackLength = $derived(audioLength || h.duration || lines.at(-1)?.t || 0);
  const participants = $derived(speakerShares(speakerTurns(lines, w.speakers, lang, trackLength)));
  const hasContext = $derived(findings.length > 0 || participants.length > 0 || lines.some(line => line.flagged));
  const findingQueue = $derived(finding && needsReview(finding) ? findings.filter(needsReview) : findings);
  function setRate(value: number) {
    playbackRate = value;
    if (audio) audio.playbackRate = value;
  }
  function togglePlayer() {
    if (playing) {
      if (audio) audio.pause();
      else playing = false;
    } else void playAt(pos >= trackLength ? 0 : pos, false);
  }
  $effect(() => {
    if (!replay || !playing) return;
    const rate = playbackRate;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      pos = Math.min(trackLength, pos + ((now - last) / 1000) * rate);
      last = now;
      picked = lines.findLast((line) => line.t <= pos)?.id ?? '';
      if (pos >= trackLength) playing = false;
    }, 150);
    return () => clearInterval(timer);
  });
  function askHearing(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    replaceState(page.url, { ...page.state, judeOpenAssistant: { caseId: w.caseRecord.id } });
  }
  let sizes = [14, 16, 19, 23],
    textSize = $derived(sizes[account.prefs.liveTextSize ?? 1] ?? 16);
  let queryLine = $derived(page.url.searchParams.get('s') || ''),
    queryFinding = $derived(page.url.searchParams.get('f') || ''),
    queryPlay = $derived(page.url.searchParams.get('play') === '1');
  let activeOther = $derived(w.hearings.find((other) => other.id !== h.id && other.mode === 'live'));
  let modeName = $derived(
    scheduled
      ? en
        ? 'Scheduled'
        : 'Terjadwal'
      : live
        ? synthetic
          ? en
            ? 'Example replay'
            : 'Putar ulang contoh'
          : en
            ? 'Live hearing'
            : 'Sidang langsung'
        : h.mode === 'recorded'
          ? en
            ? 'Recorded hearing'
            : 'Sidang terekam'
          : en
            ? 'Imported transcript'
            : 'Transkrip impor'
  );
  let liveStatus = $derived(
    synthetic
      ? replayDone
        ? en
          ? 'Replay complete'
          : 'Putar ulang selesai'
        : replayPaused
          ? en
            ? 'Replay paused'
            : 'Putar ulang dijeda'
          : en
            ? 'Replaying'
            : 'Memutar ulang'
      : capture
        ? {
            permission: en ? 'Waiting for microphone permission' : 'Menunggu izin mikrofon',
            connecting: en ? 'Connecting' : 'Menghubungkan',
            recording: en ? 'Recording' : 'Merekam',
            offline: en ? 'Offline · buffering' : 'Luring · menyimpan lokal',
            paused: en ? 'Microphone paused' : 'Mikrofon dijeda',
            draining: en ? 'Saving audio' : 'Menyimpan audio',
            stopped: en ? 'Stopped' : 'Berhenti',
            error: en ? 'Check microphone' : 'Periksa mikrofon'
          }[capture.state]
        : en
          ? 'Waiting for microphone'
          : 'Menunggu mikrofon'
  );
  function weight(f: Finding) {
    return (f.isNew ? 4 : 0) + (f.status === 'potential_inconsistency' ? 2 : 1);
  }
  function showFinding(id: string, remember = true) {
    const f = findings.find((f) => f.id === id);
    if (f) {
      if (remember && !brief && document.activeElement instanceof HTMLElement) findingOpener = document.activeElement;
      const changed = brief !== id;
      brief = id;
      replyId = '';
      picked = f.statementId;
      transcript?.reveal(picked);
      if (remember) {
        const next = new URL(page.url);
        next.searchParams.set('f', id);
        next.searchParams.set('s', picked);
        next.searchParams.delete('play');
        if (next.href !== page.url.href) void goto(next, { replaceState:true, keepFocus:true, noScroll:true, state:page.state });
      }
      if (changed && f.isNew)
        void write(apiPath(w, 'findings/' + encodeURIComponent(f.id)), 'PATCH', {}).catch(() => {});
    }
  }
  function showReply(id: string) {
    replyId = id;
    brief = '';
    const r = replies.find((r) => r.id === id);
    if (r) {
      picked = r.statementId;
      transcript?.reveal(picked);
    }
  }
  function closeQuick() {
    const id = brief;
    const opener = findingOpener;
    findingOpener = undefined;
    brief = '';
    if (id) void tick().then(() => {
      const fallback = document.querySelector<HTMLElement>(`.finding-index a[href$="/${CSS.escape(id)}"],.finding-link[data-fid="${CSS.escape(id)}"]`);
      (opener?.isConnected && opener !== document.body ? opener : fallback)?.focus({ preventScroll:true });
    });
    replyId = '';
    if (page.url.searchParams.has('f')) {
      const next = new URL(page.url);
      next.searchParams.delete('f');
      if (picked) next.searchParams.set('s', picked);
      void goto(next, { replaceState:true, keepFocus:true, noScroll:true, state:page.state });
    }
  }
  function issueFrom(e: unknown) {
    const reason = e instanceof ApiError ? e.code : e instanceof Error ? e.message : '';
    if (reason === 'capture_in_use')
      return en
        ? 'A microphone is already in use in another hearing or tab.'
        : 'Mikrofon sedang digunakan di sidang atau tab lain.';
    if (reason === 'audio_pending')
      return en
        ? 'Audio remains on this device. Reconnect the microphone to finish sending it.'
        : 'Audio masih ada di perangkat ini. Hubungkan kembali mikrofon untuk menyelesaikan pengiriman.';
    if (reason === 'capture_connecting')
      return en ? 'Wait for the microphone to connect.' : 'Tunggu sampai mikrofon terhubung.';
    return en
      ? 'Could not complete the action. Check your connection and try again.'
      : 'Tindakan belum selesai. Periksa koneksi dan coba lagi.';
  }
  function seek(t: number, scroll = true) {
    pos = Math.max(0, trackLength ? Math.min(trackLength, t) : t);
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = Math.min(pos, audio.duration);
    const s = lines.findLast((s) => s.t <= pos);
    picked = s?.id ?? '';
    if (scroll && s) transcript?.reveal(s.id);
  }
  async function playAt(t: number, scroll = true) {
    seek(t, scroll);
    if (!audio) {
      if (replay) playing = true;
      return;
    }
    try {
      await audio.play();
      issue = '';
    } catch {
      issue = en
        ? 'Press Play in the audio player to continue.'
        : 'Tekan Putar pada pemutar audio untuk melanjutkan.';
    }
  }
  function jump(s: Statement, play: boolean) {
    if (play) void playAt(s.t);
    else seek(s.t);
  }
  function heard() {
    if (!audio || !Number.isFinite(audio.currentTime)) return;
    pos = audio.currentTime;
    const line = lines.findLast((s) => s.t <= pos);
    if (line && line.id !== picked) {
      picked = line.id;
    }
  }
  $effect(() => {
    const s = queryLine,
      f = queryFinding,
      play = queryPlay,
      available = !!transcript;
    if (!available || (!s && !f)) return;
    untrack(() => {
      const found = f ? findings.find((x) => x.id === f) : undefined;
      const line = lines.find((row) => row.id === (s || found?.statementId));
      if (!line) {
        issue = en
          ? 'The linked statement is unavailable in this hearing.'
          : 'Ucapan yang ditautkan tidak tersedia dalam sidang ini.';
        return;
      }
      if (found && brief !== found.id) showFinding(found.id, false);
      if (play && canPlay) void playAt(line.t);
      else seek(line.t);
    });
  });
  $effect(() => {
    const hId = h.id,
      cId = w.caseRecord.id,
      enabled = live && synthetic && !replayPaused && !replayDone;
    if (!enabled) return;
    const controller = new AbortController();
    const path = '/api/live/' + encodeURIComponent(cId) + '/' + encodeURIComponent(hId) + '/replay';
    const cursor = untrack(() => lines.filter(line => line.id.startsWith('replay-' + hId + '-')).length);
    const previous = untrack(() => spoken);
    void runReplay(path, cursor, previous, controller.signal, turn => spoken = turn,
      () => invalidate('jude:case')).then(() => {
        if (!controller.signal.aborted) replayDone = true;
      }).catch(() => {
        if (controller.signal.aborted) return;
        replayPaused = true;
        issue = en ? 'Replay paused. Resume to reconnect.' : 'Putar ulang dijeda. Lanjutkan untuk menghubungkan kembali.';
      });
    return () => controller.abort();
  });
  async function setPrefs(p: Preferences) {
    try {
      await write('/api/me/prefs', 'PATCH', p);
    } catch (e) {
      issue = issueFrom(e);
    }
  }
  async function connect() {
    if (!canRecord || !live || busy || !h.recordingPermission?.at) return;
    busy = true;
    issue = '';
    try {
      await connectCapture(w.caseRecord.id, h.id, account.user.id, keep, h.startedAt, h.language);
      dialog = '';
    } catch (e) {
      issue =
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? en
            ? 'Microphone access was declined. You can enable it in browser settings.'
            : 'Izin mikrofon ditolak. Anda dapat mengaktifkannya di pengaturan peramban.'
          : issueFrom(e);
    } finally {
      busy = false;
    }
  }
  async function end() {
    if (!ownSession || busy) return;
    busy = true;
    issue = '';
    try {
      if (capture) await stopCapture(key);
      await write(apiPath(w, 'hearings/' + encodeURIComponent(h.id) + '/end'), 'POST', {});
      dialog = '';
      closeQuick();
    } catch (e) {
      issue = issueFrom(e);
      dialog = '';
    } finally {
      busy = false;
    }
  }
  async function assignCounsel(id: string) {
    busy = true;
    try {
      await write(apiPath(w, 'speakers/' + encodeURIComponent(id)), 'PATCH', {
        role: 'counsel',
        confirmed: true
      });
      dialog = '';
      boardNotice = en ? 'Counsel perspective saved.' : 'Sudut pandang kuasa hukum tersimpan.';
    } catch (e) {
      issue = issueFrom(e);
    } finally {
      busy = false;
    }
  }
  function keys(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (
      e.defaultPrevented ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      dialog ||
      edit ||
      inspect ||
      document.querySelector('dialog[open]') ||
      t.isContentEditable ||
      /input|textarea|select/i.test(t.tagName)
    )
      return;
    if (e.key === ' ' && canPlay && !quick && !/button|a|audio/i.test(t.tagName)) {
      e.preventDefault();
      togglePlayer();
    }
    if (e.key.toLowerCase() === 'f' && !quick) {
      e.preventDefault();
      void transcript?.openSearch();
    }
  }
</script>

<svelte:window onkeydown={keys} />
<svelte:head><title>{h.title[lang]} · Jude</title></svelte:head>

{#snippet liveControls()}
  <div class="session-control" data-tour="live-controls">
        <div class="session-label">
          <Radio size={17} /><b class="status-word">{liveStatus}</b>
          {#if synthetic}<small class="compact-status">{en ? 'Replay' : 'Contoh'}</small>{/if}<span>{timecode(elapsed)}</span>
        </div>
        <div class="control-actions">
          {#if synthetic && !replayDone}<button
              class="button playback-toggle"
              aria-label={replayPaused ? (en ? 'Resume' : 'Lanjutkan') : (en ? 'Pause' : 'Jeda')}
              onclick={() => {
                replayPaused = !replayPaused;
                if (!replayPaused) {
                  issue = '';
                }
              }}
              >{#if replayPaused}<Play size={14}/><span>{en ? 'Resume' : 'Lanjutkan'}</span>{:else}<Pause size={14}/><span>{en ? 'Pause' : 'Jeda'}</span>{/if}</button
            >
          {:else if canRecord && !capture}<button
              class="button"
              onclick={() => {
                issue = '';
                dialog = 'capture';
              }}><Mic size={15} />{en ? 'Connect microphone' : 'Hubungkan mikrofon'}</button
            >
          {:else if capture && canRecord}<button
              class="button"
              disabled={['connecting', 'draining'].includes(capture.state)}
              onclick={() => pauseCapture(key, capture?.state !== 'paused')}
              >{#if capture.state === 'paused'}<Play size={14} />{en ? 'Resume' : 'Lanjutkan'}{:else}<Pause
                  size={14}
                />{en ? 'Pause' : 'Jeda'}{/if}</button
            >{/if}
          {#if ownSession}<button class="button end" onclick={() => (dialog = 'end')}
              ><Square size={12} />{en ? 'End hearing' : 'Akhiri sidang'}</button
            >{/if}
        </div>
      </div>
{/snippet}

<article class="hearing-detail" class:live-view={live || scheduled} class:running={live}>
  <a class="back" href={base + '/hearings'}><ArrowLeft size={15} />{en ? 'All hearings' : 'Semua sidang'}</a>
  <header class="hearing-heading">
    <PageHeading art="speech" compact>
      <h1><span>{en ? 'Hearing' : 'Sidang'} {h.number}</span> {h.title[lang]}</h1>
    </PageHeading>
    {#if !scheduled}<div class="head-actions">
      {#if !live}<a class="button ask-hearing" href={assistantPath(w, {kind:'hearing', id:h.id})} onclick={askHearing}>
        <MessageSquare size={15}/>{en ? 'Ask assistant' : 'Tanya asisten'}
      </a>{/if}
      <button class="icon-button options" aria-label={en ? 'Hearing view options' : 'Opsi tampilan sidang'}
        title={en ? 'View options' : 'Opsi tampilan'} onclick={() => (dialog = 'view')}>
        {#if live}<SlidersHorizontal size={17}/>{:else}<Ellipsis size={18}/>{/if}
      </button>
    </div>{/if}
  </header>
  {#if live}{@render liveControls()}{/if}
  {#if !live && !scheduled}<p class="hearing-meta">
    {new Intl.DateTimeFormat(en ? 'en-GB' : 'id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Asia/Jakarta'}).format(new Date(h.date))}
    · {modeName}{h.duration ? ' · ' + Math.round(h.duration / 60) + (en ? ' min' : ' mnt') : ''}{#if synthetic}
      <span class="meta-sample"> · {en ? 'Synthetic material' : 'Materi sintetis'}</span>{/if}
  </p>{/if}
  {#if issue && dialog !== 'capture'}<div class="notice" role="alert">{issue}</div>{/if}
  {#if scheduled}
    <div class="appointment">
      <section>
        <h2>{en ? 'This hearing has not started.' : 'Sidang ini belum dimulai.'}</h2>
        <p class="schedule-meta"><CalendarDays size={15} /> {formatDate(h.date, lang)}{h.time ? ' · ' + h.time + ' WIB' : ''}
          {w.caseRecord.court ? ' · ' + w.caseRecord.court : ''}</p>
        {#if w.speakers.some(person => !person.alias && ['counsel','opposing'].includes(person.role))}
          <div class="schedule-counsel"><h3>{en ? 'Counsel in this case' : 'Kuasa hukum perkara ini'}</h3>
            <p>{en ? 'Select your side to see responses prepared for your counsel.' : 'Pilih pihak Anda untuk melihat tanggapan yang disiapkan bagi kuasa hukum Anda.'}</p>
            <button class="button" onclick={() => dialog = 'counsel'}>{en ? 'Choose counsel' : 'Pilih kuasa hukum'}</button>
          </div>
        {/if}
        {#if activeOther}<p class="muted">
            {en ? 'Another hearing is already in progress.' : 'Sidang lain sedang berlangsung.'}
          </p>
          <a class="button" href={base + '/hearings/' + activeOther.id}
            >{en ? 'Go to live hearing' : 'Buka sidang berjalan'}<ArrowRight size={15} /></a
          >
        {:else if !h.closed && (synthetic || (!account.user.guest && account.plan.id !== 'basic' && transcription))}<button
            class="button primary"
            onclick={() => (dialog = 'start')}
            ><Mic size={16} />{en ? 'Start hearing' : 'Mulai sidang'}</button
          >
        {:else}<p class="muted">
            {h.closed
              ? en
                ? 'This hearing is closed to recording.'
                : 'Perekaman tidak tersedia dalam sidang tertutup.'
              : account.user.guest
                ? (en ? 'Sign in to record a private hearing.' : 'Masuk untuk merekam sidang privat.')
                : account.plan.id === 'basic'
                  ? (en ? 'Live recording requires Advocate Pro or higher.' : 'Rekam langsung tersedia mulai paket Advokat Pro.')
                  : (en ? 'The voice service has not enabled transcription.' : 'Transkripsi belum aktif pada layanan suara.')}
          </p>{/if}
      </section>
    </div>
  {:else}
    {#if live}
      {#if currentReply}<button class="turn" onclick={() => showReply(currentReply.id)}
          ><MessageSquareReply size={16} />{en ? 'Your turn' : 'Giliran Anda'} · {currentReply.suggestions
            .length}
          {en ? 'suggestions' : 'saran'}<ChevronRight size={14} /></button
        >{/if}
    {/if}
    {#if !live && canPlay}
      {#if h.audio}<audio class="hearing-audio" preload="metadata" src={h.audio} bind:this={audio}
        onloadedmetadata={() => {
          if (audio && Number.isFinite(audio.duration)) audioLength = audio.duration;
          if (audio) { audio.playbackRate = playbackRate; if (pos > 0) audio.currentTime = pos; }
        }} ontimeupdate={heard} onplay={() => (playing = true)} onpause={() => (playing = false)}
        onerror={() => { audioError = true; playing = false; }}></audio>{/if}
      <HearingTransport hearing={h} {lines} {findings} speakers={w.speakers} {lang} {ready} current={pos} duration={trackLength}
        {playing} rate={playbackRate} error={audioError} seek={(time) => seek(time, false)} toggle={togglePlayer}
        {setRate} openFinding={showFinding}/>
    {:else if !live}
      <div class="text-notice"><FileText size={15}/>
        <span>{h.mode === 'imported' ? (en ? 'Text from imported minutes' : 'Teks dari risalah yang diimpor') :
          (synthetic ? (en ? 'Example transcript · no audio recording' : 'Transkrip contoh · tanpa rekaman audio') :
          (en ? 'Transcript retained without audio' : 'Transkrip tersimpan tanpa audio'))}</span>
        {#if synthetic && h.mode === 'imported'}<small class="compact-status">{en ? 'Sample' : 'Contoh'}</small>{/if}
        {#if lines.length}<input type="range" min="0" max={Math.max(1,trackLength)} step="1" value={pos} disabled={!ready}
          aria-label={en ? 'Seek transcript timeline' : 'Geser linimasa transkrip'} aria-valuetext={timecode(pos)}
          oninput={(event) => seek(Number(event.currentTarget.value))}
          onkeydown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault(); seek(pos + (event.key === 'ArrowRight' ? 10 : -10));
            }
          }}/>{/if}
      </div>
    {/if}
    <div class="hearing-stage" class:open={quick} class:has-context={!live && !quick && hasContext} class:inline={stageWidth >= 850} bind:clientWidth={stageWidth}>
      <div class="hear-reading">
        {#if live}<LiveFindingCallout workspace={w} {lang} {alerts} hearingId={h.id} selected={brief}
          onPreview={(finding) => showFinding(finding.id)} />{/if}
        <Transcript
          bind:this={transcript}
          workspace={w}
          {lang}
          {lines}
          {findings}
          {replies}
          {live}
          partial={synthetic ? spoken : capture?.partial}
          speaking={synthetic ? !replayPaused && !replayDone : capture?.state === 'recording'}
          partialStatus={synthetic ? (en ? 'Paused' : 'Dijeda') : capture?.state === 'offline' ? (en ? 'Reconnecting…' : 'Menghubungkan kembali…') : liveStatus}
          selected={picked}
          audio={!!h.audio}
          {textSize}
          anchored={!!queryLine || !!queryFinding}
          inspect={(kind, id) => (inspect = { kind, id })}
          {showFinding}
          {showReply}
          editVoice={(p) => (edit = p)}
          chooseCounsel={() => (dialog = 'counsel')}
          {jump}
        />
        {#if live}<HearingFindings {findings} {times} {lang} {live} casePath={base} hearingId={h.id}
          onPreview={(item) => showFinding(item.id)} />{/if}
      </div>
      {#if quick && stageWidth}<QuickLook
          inline={stageWidth >= 850}
          workspace={w}
          {lang}
          {finding}
          {reply}
          findings={findingQueue}
          select={showFinding}
          close={closeQuick}
        />
      {:else if !quick && !live && hasContext}<aside class="hearing-margin" aria-label={en ? 'Hearing context' : 'Konteks sidang'}>
        <HearingFindings {findings} {times} {lang} {live} casePath={base} hearingId={h.id}
          bookmarked={lines.some((line) => line.flagged)} onPreview={(item) => showFinding(item.id)} />
        {#if !live && participants.length}<section class="participants" aria-label={en ? 'Participants' : 'Peserta'}>
          <h2>{en ? 'Participants' : 'Peserta'}</h2>
          {#each participants as person (person.id)}
            <div class="participant" data-tone={person.role}>
              <span class="person-disc" aria-hidden="true">{person.letters}</span>
              <button disabled={!person.raw} onclick={() => (edit = person.raw)}>{person.name}
                <span class="share-bar"><i style:width={person.share + '%'}></i></span>
              </button>
              <small title={en ? 'Estimated speaking time' : 'Perkiraan waktu bicara'}>{person.share}%</small>
            </div>
          {/each}
        </section>{/if}
      </aside>{/if}
    </div>
  {/if}
</article>
<span role="status" class="ev-only">{boardNotice}</span>
{#if edit}<VoiceDialog workspace={w} speaker={edit} {lang} close={() => (edit = undefined)} />{/if}
{#if inspect}<Inspector workspace={w} {lang} target={inspect} close={() => (inspect = undefined)} />{/if}
{#if dialog === 'start'}<HearingForm
    workspace={w}
    {lang}
    {transcription}
    scheduled={h}
    guest={account.user.guest}
    livePlan={account.plan.id !== 'basic'}
    close={() => (dialog = '')}
  />
{:else if dialog === 'end'}<Dialog
    title={en ? 'End this hearing?' : 'Akhiri sidang ini?'}
    {lang}
    close={() => (dialog = '')}
    ><div class="stack">
      <p>
        {synthetic
          ? en
            ? 'The example stops here. All testimony and findings remain available for review.'
            : 'Contoh berhenti di sini. Ucapan dan temuan tetap dapat diperiksa.'
          : en
            ? 'The microphone will stop and remaining audio will be sent before the transcript is filed.'
            : 'Mikrofon akan dihentikan dan sisa audio dikirim sebelum transkrip disimpan.'}
      </p>
      <div class="actions">
        <button class="button primary" disabled={busy} onclick={end}
          >{busy ? (en ? 'Saving…' : 'Menyimpan…') : en ? 'End and review' : 'Akhiri dan tinjau'}</button
        ><button class="button" disabled={busy} onclick={() => (dialog = '')}
          >{en ? 'Continue hearing' : 'Lanjutkan sidang'}</button
        >
      </div>
    </div></Dialog
  >
{:else if dialog === 'capture'}<Dialog
    title={en ? 'Connect this microphone' : 'Hubungkan mikrofon perangkat ini'}
    {lang}
    close={() => {
      if (!busy) dialog = '';
    }}
    ><div class="stack">
      <p>
        {en
          ? 'This device will send speech from the hearing for transcription.'
          : 'Perangkat ini akan mengirim suara sidang untuk ditranskripsikan.'}
      </p>
      <label class="check"
        ><input type="checkbox" bind:checked={keep} />
        {en
          ? 'Also retain the audio recording in this case.'
          : 'Simpan juga rekaman audio dalam perkara ini.'}</label
      >{#if issue}<p class="error-text" role="alert">{issue}</p>{/if}<button
        class="button primary"
        disabled={busy}
        onclick={connect}
        ><Mic size={16} />{busy
          ? en
            ? 'Connecting…'
            : 'Menghubungkan…'
          : en
            ? 'Enable microphone'
            : 'Aktifkan mikrofon'}</button
      >
    </div></Dialog
  >
{:else if dialog === 'counsel'}<Dialog
    title={en ? 'Counsel’s perspective' : 'Sudut pandang kuasa hukum'}
    {lang}
    close={() => (dialog = '')}
    ><div class="stack">
      <p>
        {en
          ? 'Choose counsel on your side. Responses are prepared for counsel while the hearing runs.'
          : 'Pilih kuasa hukum di pihak Anda. Tanggapan disiapkan untuk kuasa hukum saat sidang berlangsung.'}
      </p>
      {#each w.speakers.filter((p) => !p.alias && (p.role === 'counsel' || p.role === 'opposing')) as p (p.id)}<button
          class="button"
          aria-pressed={p.role === 'counsel'}
          disabled={busy}
          onclick={() => assignCounsel(p.id)}
          >{p.label}{#if p.role === 'counsel'}<Check size={15} />{/if}</button
        >{:else}<p class="small muted">
          {en
            ? 'Identify a lawyer from their name in the transcript first.'
            : 'Tetapkan peran kuasa hukum dari nama pembicara dalam transkrip terlebih dahulu.'}
        </p>{/each}
    </div></Dialog
  >
{:else if dialog === 'view'}<Dialog
    title={en ? 'Hearing view' : 'Tampilan sidang'}
    {lang}
    close={() => (dialog = '')}
    ><div class="stack">
      <label class="field"
        >{en ? 'Transcript text size' : 'Ukuran teks transkrip'}<select
          value={account.prefs.liveTextSize ?? 1}
          onchange={(e) => setPrefs({ liveTextSize: Number(e.currentTarget.value) })}
          >{#each sizes as size, i}<option value={i}>{size} px</option>{/each}</select
        ></label
      ><button
        class="button"
        onclick={() =>
          setPrefs({ theme: night ? 'paper' : 'night' })}
        >{#if night}<Sun size={16} />{en
            ? 'Paper appearance'
            : 'Tampilan kertas'}{:else}<Moon size={16} />{en
            ? 'Courtroom night mode'
            : 'Mode malam ruang sidang'}{/if}</button
      ><button
        class="button"
        onclick={async () => {
          dialog = '';
          await tick();
          await transcript?.openSearch();
        }}><Search size={16} />{en ? 'Search transcript' : 'Cari transkrip'}</button
      ><a class="button" href={assistantPath(w, { kind: 'hearing', id: h.id })} onclick={(event) => { askHearing(event); if (event.defaultPrevented) dialog = ''; }}
        >{en ? 'Ask about this hearing' : 'Tanyakan sidang ini'}<ArrowUpRight size={15} /></a>
      {#if !live && stageWidth < 1000 && hasContext}<HearingFindings {findings} {times} {lang} casePath={base} hearingId={h.id}
        bookmarked={lines.some(line => line.flagged)} onPreview={item => { dialog = ''; showFinding(item.id); }} />{/if}
    </div></Dialog
  >{/if}
