<script lang="ts">
  import { invalidate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    CalendarDays,
    Check,
    ChevronRight,
    MessageSquareReply,
    FileText,
    Mic,
    Moon,
    Pause,
    Play,
    Radio,
    Search,
    SlidersHorizontal,
    Square,
    Sun,
    Volume2
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
  import { api, write } from '$lib/client';
  import Inspector from '$lib/evidence/Inspector.svelte';
  import { apiPath, assistantPath, casePath, statuses } from '$lib/evidence/records';
  import '$lib/evidence/evidence.css';
  import Dialog from '../Dialog.svelte';
  import HearingForm from '../HearingForm.svelte';
  import { formatDate, timecode } from '../format';
  import Transcript from './Transcript.svelte';
  import Timeline from './Timeline.svelte';
  import QuickLook from './QuickLook.svelte';
  import HearingFindings from './HearingFindings.svelte';
  import VoiceDialog from './VoiceDialog.svelte';
  import { getCapture, connectCapture, pauseCapture, stopCapture } from './active-recording.svelte';
  import { voice } from './people';
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
  let now = $state(0);
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
      ? (lines.at(-1)?.t ?? 0)
      : capture
        ? capture.elapsed + (capture.runningSince ? Math.max(0, (now - capture.runningSince) / 1000) : 0)
        : h.startedAt && now
          ? Math.max(0, (now - Date.parse(h.startedAt)) / 1000)
          : (lines.at(-1)?.t ?? 0)
  );
  let replayPaused = $state(false),
    replayDone = $state(false),
    retry = $state(0),
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
  let audio = $state<HTMLAudioElement>(),
    transcript = $state<Transcript>(),
    pos = $state(0),
    picked = $state(''),
    playing = $state(false),
    audioError = $state(false);
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
            connecting: en ? 'Connecting' : 'Menghubungkan',
            recording: en ? 'Recording' : 'Merekam',
            offline: en ? 'Offline · buffering' : 'Luring · menyimpan lokal',
            paused: en ? 'Microphone paused' : 'Mikrofon dijeda',
            draining: en ? 'Saving audio' : 'Menyimpan audio',
            stopped: en ? 'Stopped' : 'Berhenti',
            error: en ? 'Check microphone' : 'Periksa mikrofon'
          }[capture.state]
        : en
          ? 'Live transcript'
          : 'Transkrip langsung'
  );
  function weight(f: Finding) {
    return (f.isNew ? 4 : 0) + (f.status === 'potential_inconsistency' ? 2 : 1);
  }
  function showFinding(id: string, remember = true) {
    const f = findings.find((f) => f.id === id);
    if (f) {
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
        if (next.href !== page.url.href) replaceState(next, page.state);
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
    brief = '';
    replyId = '';
    if (page.url.searchParams.has('f')) {
      const next = new URL(page.url);
      next.searchParams.delete('f');
      if (picked) next.searchParams.set('s', picked);
      replaceState(next, page.state);
    }
  }
  function peek(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    showFinding(id);
  }
  function issueFrom(e: unknown) {
    const reason = e instanceof Error ? e.message : '';
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
    pos = Math.max(0, t);
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = Math.min(pos, audio.duration);
    const s = lines.findLast((s) => s.t <= pos);
    picked = s?.id ?? '';
    if (scroll && s) transcript?.reveal(s.id);
  }
  async function playAt(t: number) {
    seek(t);
    if (!audio) return;
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
      if (playing) transcript?.reveal(line.id);
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
      if (play && h.audio) void playAt(line.t);
      else seek(line.t);
    });
  });
  $effect(() => {
    const hId = h.id,
      cId = w.caseRecord.id,
      enabled = live && synthetic && !replayPaused && !replayDone,
      attempt = retry;
    if (!enabled) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    let cursor = untrack(() => lines.filter((s) => s.id.startsWith('replay-' + hId + '-')).length);
    const advance = async () => {
      try {
        const next = await api<{ cursor: number; done: boolean; pause?: number }>(
          '/api/live/' + encodeURIComponent(cId) + '/' + encodeURIComponent(hId) + '/replay',
          'POST',
          { cursor }
        );
        cursor = next.cursor;
        await invalidate('jude:case');
        if (cancelled) return;
        replayDone = next.done;
        if (!next.done) timer = setTimeout(advance, Math.max(900, next.pause ?? 3600));
      } catch {
        if (!cancelled) {
          replayPaused = true;
          issue = en
            ? 'Replay paused. Resume to reconnect.'
            : 'Putar ulang dijeda. Lanjutkan untuk menghubungkan kembali.';
        }
      }
    };
    timer = setTimeout(advance, attempt ? 500 : 3200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
    if (e.key === ' ' && audio && !quick && !/button|a|audio/i.test(t.tagName)) {
      e.preventDefault();
      if (audio.paused) void playAt(pos);
      else audio.pause();
    }
    if (e.key.toLowerCase() === 'f' && !quick) {
      e.preventDefault();
      void transcript?.openSearch();
    }
  }
</script>

<svelte:window onkeydown={keys} />
<svelte:head><title>{h.title[lang]} · Jude</title></svelte:head>

<article class="hearing-detail">
  <a class="back" href={base + '/hearings'}><ArrowLeft size={15} />{en ? 'All hearings' : 'Semua sidang'}</a>
  <header class="hearing-heading">
    <div>
      <p class="folio-line">
        <span>{en ? 'Hearing' : 'Sidang'} {String(h.number).padStart(2, '0')}</span><i></i>{formatDate(
          h.date,
          lang,
          true
        )}{#if synthetic}<i></i>{en ? 'Synthetic material' : 'Materi sintetis'}{/if}
      </p>
      <h1>{h.title[lang]}</h1>
    </div>
    {#if !scheduled}<button
        class="icon-button options"
        aria-label={en ? 'Hearing view options' : 'Opsi tampilan sidang'}
        title={en ? 'View options' : 'Opsi tampilan'}
        onclick={() => (dialog = 'view')}><SlidersHorizontal size={18} /></button
      >{/if}
  </header>
  {#if issue && dialog !== 'capture'}<div class="notice" role="alert">{issue}</div>{/if}
  {#if scheduled}
    <div class="appointment">
      <div class="date-leaf">
        <CalendarDays size={19} /><strong>{h.date.slice(-2)}</strong><span
          >{new Intl.DateTimeFormat(en ? 'en-GB' : 'id-ID', {
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Jakarta'
          }).format(new Date(h.date))}</span
        >
      </div>
      <section>
        <p class="folio-line">{modeName}</p>
        <h2>{formatDate(h.date, lang)}</h2>
        <p>
          {[h.time ? h.time.replace('.', ':') + ' WIB' : '', w.caseRecord.court].filter(Boolean).join(' · ')}
        </p>
        {#if activeOther}<p class="muted">
            {en ? 'Another hearing is already in progress.' : 'Sidang lain sedang berlangsung.'}
          </p>
          <a class="button" href={base + '/hearings/' + activeOther.id}
            >{en ? 'Go to live hearing' : 'Buka sidang berjalan'}<ArrowRight size={15} /></a
          >
        {:else if synthetic || (!account.user.guest && transcription && !h.closed)}<button
            class="button primary"
            onclick={() => (dialog = 'start')}
            ><Mic size={16} />{en ? 'Start hearing' : 'Mulai sidang'}</button
          >
        {:else}<p class="muted">
            {h.closed
              ? en
                ? 'This hearing is closed to recording.'
                : 'Perekaman tidak tersedia dalam sidang tertutup.'
              : en
                ? 'Live transcription is unavailable for this account.'
                : 'Transkripsi langsung tidak tersedia untuk akun ini.'}
          </p>{/if}
      </section>
    </div>
  {:else}
    {#if live}<div class="session-control" data-tour="live-controls">
        <div class="session-label">
          <Radio size={17} /><b>{liveStatus}</b><span>{timecode(elapsed)}</span>
        </div>
        <div class="control-actions">
          {#if synthetic && !replayDone}<button
              class="button"
              onclick={() => {
                replayPaused = !replayPaused;
                if (!replayPaused) {
                  issue = '';
                  retry++;
                }
              }}
              >{#if replayPaused}<Play size={14} />{en ? 'Resume' : 'Lanjutkan'}{:else}<Pause size={14} />{en
                  ? 'Pause'
                  : 'Jeda'}{/if}</button
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
      {#if currentReply}<button class="turn" onclick={() => showReply(currentReply.id)}
          ><MessageSquareReply size={16} />{en ? 'Your turn' : 'Giliran Anda'} · {currentReply.suggestions
            .length}
          {en ? 'suggestions' : 'saran'}<ChevronRight size={14} /></button
        >{/if}
    {:else}<div class="mode-head">
        <span
          >{#if h.audio}<Volume2 size={16} />{:else}<FileText size={16} />{/if}{modeName}</span
        >
        {#if !h.audio}<small
            >{h.mode === 'imported'
              ? en
                ? 'Text from the filed transcript'
                : 'Teks dari risalah yang diimpor'
              : synthetic
                ? en
                  ? 'Example transcript · no audio recording'
                  : 'Transkrip contoh · tanpa rekaman audio'
                : en
                  ? 'Transcript retained without audio'
                  : 'Transkrip tersimpan tanpa audio'}</small
          >{/if}
      </div>{/if}
    <div class="hearing-stage" class:open={quick}>
      <div class="hear-reading">
        {#if !live && lines.length}<Timeline
            hearing={h}
            {lines}
            {findings}
            openFinding={showFinding}
            speakers={w.speakers}
            {lang}
            current={pos}
            seek={(n) => seek(n)}
          />{/if}
        {#if h.audio && !live}<div class="audio-row">
            <audio
              controls
              preload="metadata"
              src={h.audio}
              bind:this={audio}
              onloadedmetadata={() => {
                if (audio && pos > 0) audio.currentTime = pos;
              }}
              ontimeupdate={heard}
              onplay={() => (playing = true)}
              onpause={() => (playing = false)}
              onerror={() => (audioError = true)}
            ></audio>{#if audioError}<p role="alert">
                {en
                  ? 'Audio could not be opened. The transcript is available below.'
                  : 'Audio belum dapat diputar. Transkrip tersedia di bawah.'}
              </p>{/if}
          </div>{/if}
        {#if live && alerts[0]}{@const top = alerts[0]}<a
            class="live-finding"
            href={base + '/findings/' + top.id}
            onclick={(e) => peek(e, top.id)}
            data-tour="live-attention"
            ><p>{statuses[top.status][lang]} <span>· {timecode(times.get(top.statementId) ?? 0)}</span></p>
            <strong>{top.title[lang]}</strong><span>{top.question}</span><ChevronRight size={16} /></a
          >{/if}
        <Transcript
          bind:this={transcript}
          workspace={w}
          {lang}
          {lines}
          {findings}
          {replies}
          {live}
          partial={capture?.partial ?? ''}
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
      </div>
      {#if quick}<QuickLook
          workspace={w}
          {lang}
          {finding}
          {reply}
          {findings}
          select={showFinding}
          close={closeQuick}
        />
      {:else}<aside class="hearing-margin" aria-label={en ? 'Hearing context' : 'Konteks sidang'}>
        <HearingFindings {findings} {times} {lang} {live} casePath={base} hearingId={h.id}
          bookmarked={lines.some((line) => line.flagged)} onPreview={(item) => showFinding(item.id)} />
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
          setPrefs({ theme: document.documentElement.dataset.theme === 'night' ? 'paper' : 'night' })}
        >{#if account.prefs.theme === 'night'}<Sun size={16} />{en
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
      ><a class="button" href={assistantPath(w, { kind: 'hearing', id: h.id })}
        >{en ? 'Ask about this hearing' : 'Tanyakan sidang ini'}<ArrowUpRight size={15} /></a
      >
    </div></Dialog
  >{/if}
