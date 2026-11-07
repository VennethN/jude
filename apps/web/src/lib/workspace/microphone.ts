import { prepareMicrophone, type PreparedMicrophone } from './microphone-input';

export interface LiveTranscriptTurn {
  id: string;
  text: string;
  speakerId?: string;
  t?: number;
}

interface CapturedTurn {
  scope: string;
  id: string;
  t: number;
  pcm: ArrayBuffer;
  keep: boolean;
}
const sampleRate = 24_000;
// Amazon needs continuous audio, including silence, to finalize a speaker turn.
const liveCaptionSamples = 0.2 * sampleRate;
const queuedTurnSamples = 8 * sampleRate;
export interface Recorder {
  stop: () => Promise<void>;
  paused: (value: boolean) => Promise<void>;
}
export type CaptureState =
  | 'permission'
  | 'connecting'
  | 'recording'
  | 'offline'
  | 'paused'
  | 'draining'
  | 'stopped'
  | 'service_error'
  | 'guest_limit'
  | 'error';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jude-voice', 2);
    req.onupgradeneeded = () => {
      const store = req.result.objectStoreNames.contains('turns')
        ? req.transaction!.objectStore('turns')
        : req.result.createObjectStore('turns', { keyPath: 'id' });
      if (!store.indexNames.contains('scope')) store.createIndex('scope', 'scope');
      store.createIndex('timeInScope', ['scope', 't']);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}
async function nextTurn(db: IDBDatabase, scope: string, sent: ReadonlyMap<string, number>): Promise<CapturedTurn | undefined> {
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([scope, 0], [scope, Number.MAX_SAFE_INTEGER]);
    const r = db.transaction('turns').objectStore('turns').index('timeInScope').openCursor(range);
    r.onsuccess = () => {
      const cursor = r.result;
      if (cursor && sent.has(String(cursor.primaryKey))) cursor.continue();
      else resolve(cursor?.value);
    };
    r.onerror = () => reject(r.error);
  });
}
async function queuedCount(db: IDBDatabase, scope: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = db.transaction('turns').objectStore('turns').index('scope').count(scope);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function storeTurn(db: IDBDatabase, turn: CapturedTurn | string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('turns', 'readwrite'),
      s = tx.objectStore('turns');
    if (typeof turn === 'string') s.delete(turn);
    else s.put(turn);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function base64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export async function capture(
  caseId: string,
  hearingId: string,
  userId: string,
  keep: boolean,
  startedAt: string | undefined,
  state: (status: CaptureState) => void,
  partial: (turn?: LiveTranscriptTurn) => void,
  language: 'id' | 'en' = 'id',
  guestPractice = false,
  recoverOnly = false,
  prepared?: PreparedMicrophone,
): Promise<Recorder> {
  const input = recoverOnly ? undefined : prepared ?? prepareMicrophone();
  const scope = [userId, caseId, hearingId].join('/');
  state(recoverOnly ? 'draining' : 'permission');
  const db = await database().catch(error => { input?.release(); throw error; });
  if (recoverOnly && !(await queuedCount(db, scope))) {
    db.close();
    state('stopped');
    return { stop: async () => {}, paused: async () => {} };
  }
  const media = await input?.ready.catch(error => { db.close(); throw error; });
  const stream = media?.stream, context = media?.context;
  state('connecting');
  let source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  if (context && stream) {
    try {
      await context.audioWorklet.addModule('/voice-capture.js');
      source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, 'jude-capture');
      source.connect(node);
      node.connect(context.destination);
    } catch {
      input?.release();
      db.close();
      throw new Error('microphone_worklet');
    }
  }
  let ws: WebSocket | undefined,
    ready = false,
    windowSize = 1,
    stopped = false,
    paused = recoverOnly,
    draining = recoverOnly,
    retry: ReturnType<typeof setTimeout> | undefined,
    pumpBusy = false,
    pumpRequested = false,
    saveChain = Promise.resolve();
  const inFlight = new Map<string, number>();
  // Sent captures stay in IndexedDB until transcript completion, including keep=false.
  const submitted = new Map<string, number>();
  let rotating = false, stopSent = false, providerStopped = false;
  let captureSettled = recoverOnly, terminalError = false, reconnects = 0;
  let inputClosed = recoverOnly;
  let lastProgress = Date.now();
  let handoffRetries = 0;
  let guestLimitReached = false;
  let pauseTransition = Promise.resolve();
  function stopGuestPractice() {
    if (guestLimitReached) return;
    terminalError = guestLimitReached = true;
    ready = false;
    partial();
    void (finishing ??= finish()).catch(() => state('error'));
  }
  function requestDrain() {
    if (!ready || !ws || stopSent || inFlight.size || (!rotating && !captureSettled)) return;
    stopSent = true;
    ws.send(JSON.stringify({ type: 'stop' }));
  }
  let caption: { resultId: string; value: LiveTranscriptTurn } | undefined;
  let latestCaptionTime = -1;
  let chunks: Int16Array<ArrayBuffer>[] = [],
    samples = 0,
    turnStart = 0;
  let storageError = false;
  let boundaryNumber = 0;
  const boundaries = new Map<number, () => void>();
  const beginning = Date.parse(startedAt ?? '');
  const initial = Number.isFinite(beginning) ? Math.max(0, (Date.now() - beginning) / 1000) : 0;
  let elapsed = initial;
  const checkUnload = (e: BeforeUnloadEvent) => {
    if (!stopped) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', checkUnload);
  let lock: WakeLockSentinel | undefined;
  try {
    lock = await navigator.wakeLock?.request('screen');
  } catch {}
  async function pump() {
    if (pumpBusy) { pumpRequested = true; return; }
    if (!ready || stopped || !ws || stopSent || inFlight.size >= windowSize) return;
    if (rotating) { requestDrain(); return; }
    const socket = ws;
    pumpBusy = true;
    try {
      while (socket === ws && ready && !stopped && !rotating && !stopSent && inFlight.size < windowSize) {
        const next = await nextTurn(db, scope, submitted);
        if (!next || rotating || stopSent || socket !== ws || socket.readyState !== WebSocket.OPEN) {
          if (!next && (draining || paused)) requestDrain();
          break;
        }
        inFlight.set(next.id, next.t);
        submitted.set(next.id, next.t);
        try {
          socket.send(JSON.stringify({ id: next.id, t: next.t, keep: next.keep, pcm: base64(next.pcm) }));
        } catch {
          inFlight.delete(next.id);
          submitted.delete(next.id);
          socket.close();
          break;
        }
      }
    } finally {
      pumpBusy = false;
      if (pumpRequested) {
        pumpRequested = false;
        void pump().catch(() => state('error'));
      }
    }
  }
  function connect() {
    if (stopped || terminalError) return;
    state(draining ? 'draining' : 'connecting');
    ready = false;
    inFlight.clear();
    submitted.clear();
    stopSent = false;
    providerStopped = false;
    rotating = false;
    const connected = new WebSocket(
      (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host +
        '/api/live/' +
        caseId +
        '/' +
        hearingId +
        '/socket?lang=' +
        language,
    );
    ws = connected;
    connected.onmessage = async (e) => {
      if (stopped || connected !== ws) return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'ready') {
          if (m.protocol !== 2) { terminalError = true; connected.close(); state('service_error'); return; }
          handoffRetries = 0;
          windowSize = Number.isSafeInteger(m.maxInFlight) ? Math.max(1, Math.min(3, m.maxInFlight)) : 1;
          ready = true;
          state(draining ? 'draining' : paused ? 'paused' : 'recording');
          await pump();
        } else if (m.type === 'partial' && typeof m.text === 'string') {
          const turn = m.turnId ?? [...submitted.keys()].find(id => m.id === 'mic-' + hearingId + '-' + id || m.id === id);
          const packetStart = submitted.get(turn);
          if (packetStart === undefined) return;
          const time = typeof m.t === 'number' && Number.isFinite(m.t) ? m.t : packetStart;
          if (time < latestCaptionTime) return;
          latestCaptionTime = time;
          const value = {
            id: m.statementId ?? 'mic-' + hearingId + '-' + turn,
            text: m.text,
            speakerId: typeof m.speakerId === 'string' ? m.speakerId : undefined,
            t: time,
          };
          caption = { resultId: m.id, value };
          partial(value);
        } else if (m.type === 'accepted' && submitted.has(m.id)) {
          lastProgress = Date.now();
          inFlight.delete(m.id);
          await pump();
          if (rotating) requestDrain();
        } else if (m.type === 'rotate') {
          rotating = true;
          requestDrain();
        } else if (m.type === 'transcript') {
          // Keep the last words visible until the case event delivers the saved row.
          // Transcript.svelte reconciles the provisional row by this durable ID.
          if (caption && m.id === caption.resultId && typeof m.statementId === 'string') {
            partial({ ...caption.value, id: m.statementId });
            caption = undefined;
          }
        } else if (m.type === 'stopped') {
          providerStopped = true;
          ready = false;
          connected.close();
        } else if (m.type === 'error') {
          if (guestPractice && m.code === 'guest_live_limit') {
            stopGuestPractice();
            return;
          }
          terminalError = m.code !== 'transcription_interrupted';
          connected.close();
          state(terminalError ? 'service_error' : 'offline');
        } else if (m.type === 'ack' && submitted.has(m.id)) {
          lastProgress = Date.now();
          reconnects = 0;
          await storeTurn(db, m.id);
          if (stopped || connected !== ws) return;
          inFlight.delete(m.id);
          submitted.delete(m.id);
          await pump();
        }
      } catch {
        state('error');
      }
    };
    connected.onclose = (event) => {
      if (connected !== ws) return;
      ready = false;
      inFlight.clear();
      if (!stopped && !guestLimitReached) {
        if (guestPractice && event.code === 1008 && event.reason === 'guest_live_limit') {
          stopGuestPractice();
          return;
        }
        // A clean pause drain can close just before Python releases its lease.
        // Retry only this bounded handoff, never an explicit policy-error frame.
        if (!terminalError && handoffRetries > 0 && [1006, 1008].includes(event.code)) {
          handoffRetries--;
          state('connecting');
          retry = setTimeout(connect, 500);
          return;
        }
        if ([1008, 1003].includes(event.code) || terminalError || (!providerStopped && ++reconnects > 2)) {
          terminalError = true;
          paused = true;
          void stopInput();
          state('service_error');
          return;
        }
        if (providerStopped && (draining || paused) && !rotating) return;
        state(providerStopped ? 'connecting' : 'offline');
        retry = setTimeout(connect, providerStopped ? 0 : 3000);
      }
    };
  }
  function flush() {
    if (!samples) return;
    const pcm = new Int16Array(samples);
    let offset = 0;
    for (const c of chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    const turn = { scope, id: crypto.randomUUID(), t: turnStart, keep, pcm: pcm.buffer };
    chunks = [];
    samples = 0;
    saveChain = saveChain
      .then(() => storeTurn(db, turn))
      .then(() => pump())
      .catch(() => {
        storageError = true;
        state('error');
        paused = true;
        void stopInput();
      });
  }
  // Worklet messages are ordered. Its boundary follows all captured blocks, including its final
  // partial block, so a pause or stop cannot truncate the last word at a 100 ms block boundary.
  function closeWindow() {
    if (!node || inputClosed) return Promise.resolve();
    const boundary = ++boundaryNumber;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        boundaries.delete(boundary);
        flush();
        resolve();
      };
      // A suspended/removed device can stop responding. Already delivered audio still drains.
      const timer = setTimeout(done, 350);
      boundaries.set(boundary, done);
      node.port.postMessage({ type: 'pause', boundary });
    });
  }
  if (node) node.port.onmessage = (e: MessageEvent<ArrayBuffer | { boundary: number }>) => {
    if (!(e.data instanceof ArrayBuffer)) {
      boundaries.get(e.data.boundary)?.();
      return;
    }
    if (stopped || storageError || inputClosed) return;
    const a = new Int16Array(e.data);
    if (!samples) turnStart = elapsed;
    chunks.push(a);
    samples += a.length;
    elapsed += a.length / sampleRate;
    // Provider backpressure controls pump(), not microphone batching. Waiting for
    // a voice threshold here holds silence and delays AWS's final speaker result.
    if (samples >= (ready ? liveCaptionSamples : queuedTurnSamples)) flush();
  };
  let inputShutdown: Promise<void> | undefined;
  function stopInput() {
    if (inputShutdown) return inputShutdown;
    const boundary = closeWindow();
    // Release the physical microphone immediately, independently of network or
    // provider drain. The worklet still delivers its already-captured tail.
    stream?.getTracks().forEach((track) => track.stop());
    inputShutdown = boundary.then(() => {
      inputClosed = true;
      source?.disconnect();
      node?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      void lock?.release().catch(() => {});
    });
    return inputShutdown;
  }
  connect();
  async function finish() {
    paused = true;
    draining = true;
    captureSettled = false;
    state('draining');
    await stopInput();
    await saveChain;
    captureSettled = true;
    if (!guestLimitReached) state(terminalError ? 'service_error' : 'draining');
    await pump();
    lastProgress = Date.now();
    const deadline = Date.now() + 120000;
    while (!terminalError && Date.now() < deadline && Date.now() - lastProgress < 45000 && (!providerStopped || (await queuedCount(db, scope)))) {
      await new Promise((r) => setTimeout(r, 160));
    }
    if (guestLimitReached) {
      // The provider has finished admitted audio. Only this guest hearing's rejected or unsent PCM remains.
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('turns', 'readwrite');
        const store = tx.objectStore('turns');
        const keys = store.index('scope').getAllKeys(scope);
        keys.onsuccess = () => { for (const key of keys.result) store.delete(key); };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    }
    const remaining = await queuedCount(db, scope);
    stopped = true;
    clearTimeout(retry);
    ws?.close();
    db.close();
    window.removeEventListener('beforeunload', checkUnload);
    if (guestLimitReached) { state('guest_limit'); return; }
    state(storageError ? 'error' : terminalError ? 'service_error' : remaining || !providerStopped ? 'offline' : 'stopped');
    if (storageError) throw new Error('audio_storage_failed');
    if (remaining || !providerStopped) throw new Error('audio_pending');
  }
  let finishing: Promise<void> | undefined;
  return {
    stop: () => (finishing ??= finish()),
    paused(value) {
      // Serialize rapid toggles so resume cannot race the worklet's pause boundary.
      const transition = pauseTransition.then(async () => {
        if (stopped || draining || storageError || terminalError || value === paused) return;
        if (value) {
          paused = true;
          captureSettled = false;
          state('paused');
          await closeWindow();
          await saveChain;
          captureSettled = true;
          await pump();
          return;
        }
        // Remain paused while all accepted captures finalize. Closing this socket
        // early interrupts the provider and competes with the existing lease.
        lastProgress = Date.now();
        while (!stopped && !draining && !terminalError &&
               !(providerStopped && ws?.readyState === WebSocket.CLOSED)) {
          if (Date.now() - lastProgress >= 45000) {
            state('error');
            throw new Error('audio_pending');
          }
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        if (stopped || draining || terminalError) return;
        paused = false;
        captureSettled = false;
        handoffRetries = 3;
        clearTimeout(retry);
        connect();
        node?.port.postMessage({ type: 'resume' });
      });
      pauseTransition = transition.catch(() => {});
      return transition;
    },
  };
}
