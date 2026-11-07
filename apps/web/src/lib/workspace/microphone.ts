import { invalidate } from '$app/navigation';

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
const liveCaptionSamples = 2.4 * sampleRate;
const queuedTurnSamples = 8 * sampleRate;
const minimumVoicedWindow = 1.2 * sampleRate;
const speechEndSilence = 0.55 * sampleRate;
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
): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
    throw new Error('Microphone requires HTTPS and a supported browser.');
  const scope = [userId, caseId, hearingId].join('/'),
    db = await database();
  state('permission');
  const stream = await navigator.mediaDevices
    .getUserMedia({
      audio: { channelCount: 1, noiseSuppression: true, echoCancellation: false },
    })
    .catch((cause) => {
      db.close();
      throw cause;
    });
  state('connecting');
  const context = new AudioContext({ sampleRate });
  try {
    await context.audioWorklet.addModule('/voice-capture.js');
    await context.resume();
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    db.close();
    throw e;
  }
  const source = context.createMediaStreamSource(stream),
    node = new AudioWorkletNode(context, 'jude-capture');
  source.connect(node);
  node.connect(context.destination);
  let ws: WebSocket | undefined,
    ready = false,
    windowSize = 1,
    stopped = false,
    paused = false,
    draining = false,
    retry: ReturnType<typeof setTimeout> | undefined,
    pumpBusy = false,
    pumpRequested = false,
    saveChain = Promise.resolve();
  const inFlight = new Map<string, number>();
  // Sent captures stay in IndexedDB until transcript completion, including keep=false.
  const submitted = new Map<string, number>();
  let rotating = false, stopSent = false, providerStopped = false;
  let captureSettled = false, terminalError = false, reconnects = 0;
  let lastProgress = Date.now();
  function requestDrain() {
    if (!ready || !ws || stopSent || inFlight.size || (!rotating && !captureSettled)) return;
    stopSent = true;
    ws.send(JSON.stringify({ type: 'stop' }));
  }
  let caption: { turn: string; time: number; committed: boolean } | undefined;
  let refreshing = false, refreshNeeded = false, latestCaptionTime = -1;
  let chunks: Int16Array<ArrayBuffer>[] = [],
    samples = 0,
    silent = 0,
    firstVoicedSample = -1,
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
  // Refreshing a large case can be slower than the next microphone turn.
  async function refreshTranscript() {
    refreshNeeded = true;
    if (refreshing) return;
    refreshing = true;
    try {
      while (refreshNeeded && !stopped) {
        refreshNeeded = false;
        const displayed = caption?.committed ? caption : undefined;
        await invalidate('jude:case');
        if (displayed && displayed === caption) { caption = undefined; partial(); }
      }
    } catch {
      // The turn is durable. Workspace events can still reconcile its caption.
    } finally { refreshing = false; }
  }
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
          if (m.protocol !== 2) { terminalError = true; connected.close(); state('error'); return; }
          windowSize = Number.isSafeInteger(m.maxInFlight) ? Math.max(1, Math.min(3, m.maxInFlight)) : 1;
          ready = true;
          state(draining ? 'draining' : paused ? 'paused' : 'recording');
          await pump();
        } else if (m.type === 'partial' && typeof m.text === 'string') {
          const turn = m.turnId ?? [...submitted.keys()].find(id => m.id === 'mic-' + hearingId + '-' + id || m.id === id);
          const time = submitted.get(turn);
          if (time === undefined || time < latestCaptionTime) return;
          latestCaptionTime = time;
          caption = { turn, time, committed: false };
          partial({
            id: m.statementId ?? 'mic-' + hearingId + '-' + turn,
            text: m.text,
            speakerId: typeof m.speakerId === 'string' ? m.speakerId : undefined,
            t: time,
          });
        } else if (m.type === 'accepted' && submitted.has(m.id)) {
          lastProgress = Date.now();
          inFlight.delete(m.id);
          await pump();
          if (rotating) requestDrain();
        } else if (m.type === 'rotate') {
          rotating = true;
          requestDrain();
        } else if (m.type === 'transcript') {
          void refreshTranscript();
        } else if (m.type === 'stopped') {
          providerStopped = true;
          ready = false;
          connected.close();
        } else if (m.type === 'error') {
          terminalError = m.code !== 'transcription_interrupted';
          connected.close();
          state('error');
        } else if (m.type === 'ack' && submitted.has(m.id)) {
          lastProgress = Date.now();
          reconnects = 0;
          await storeTurn(db, m.id);
          if (stopped || connected !== ws) return;
          inFlight.delete(m.id);
          submitted.delete(m.id);
          if (caption && caption.turn === m.id) caption.committed = true;
          void refreshTranscript();
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
      if (!stopped) {
        if ([1008, 1003].includes(event.code) || terminalError || (!providerStopped && ++reconnects > 2)) {
          terminalError = true;
          paused = true;
          node.port.postMessage({ type: 'pause' });
          flush();
          state('error');
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
    silent = 0;
    firstVoicedSample = -1;
    saveChain = saveChain
      .then(() => storeTurn(db, turn))
      .then(() => pump())
      .catch(() => {
        storageError = true;
        state('error');
        paused = true;
        node.port.postMessage({ type: 'pause' });
      });
  }
  // Worklet messages are ordered. Its boundary follows all captured blocks, including its final
  // partial block, so a pause or stop cannot truncate the last word at a 100 ms block boundary.
  function closeWindow() {
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
  node.port.onmessage = (e: MessageEvent<ArrayBuffer | { boundary: number }>) => {
    if (!(e.data instanceof ArrayBuffer)) {
      boundaries.get(e.data.boundary)?.();
      return;
    }
    if (stopped || storageError) return;
    const a = new Int16Array(e.data);
    if (!samples) turnStart = elapsed;
    let peak = 0;
    for (let i = 0; i < a.length; i += 8) peak = Math.max(peak, Math.abs(a[i]));
    if (peak >= 280 && firstVoicedSample < 0) firstVoicedSample = samples;
    chunks.push(a);
    samples += a.length;
    elapsed += a.length / sampleRate;
    silent = peak < 280 ? silent + a.length : 0;
    if (firstVoicedSample < 0) {
      if (samples >= queuedTurnSamples) flush();
      return;
    }
    const voicedWindow = samples - firstVoicedSample;
    const limit = ready && inFlight.size < windowSize ? liveCaptionSamples : queuedTurnSamples;
    if (
      voicedWindow >= limit ||
      (voicedWindow >= minimumVoicedWindow && (silent >= speechEndSilence || samples >= queuedTurnSamples))
    )
      flush();
  };
  connect();
  async function finish() {
    paused = true;
    draining = true;
    captureSettled = false;
    await closeWindow();
    stream.getTracks().forEach((t) => t.stop());
    source.disconnect();
    node.disconnect();
    if (context.state !== 'closed') await context.close();
    await saveChain;
    await lock?.release();
    captureSettled = true;
    state(terminalError ? 'error' : 'draining');
    await pump();
    lastProgress = Date.now();
    while (!terminalError && Date.now() - lastProgress < 45000 && (!providerStopped || (await queuedCount(db, scope)))) {
      await new Promise((r) => setTimeout(r, 160));
    }
    const remaining = await queuedCount(db, scope);
    stopped = true;
    clearTimeout(retry);
    ws?.close();
    db.close();
    window.removeEventListener('beforeunload', checkUnload);
    state(storageError || terminalError ? 'error' : remaining || !providerStopped ? 'offline' : 'stopped');
    if (storageError) throw new Error('audio_storage_failed');
    if (remaining || !providerStopped) throw new Error('audio_pending');
  }
  let finishing: Promise<void> | undefined;
  return {
    stop: () => (finishing ??= finish()),
    async paused(value) {
      if (stopped || draining || storageError || terminalError || value === paused) return;
      paused = value;
      captureSettled = false;
      state(value ? 'paused' : ready ? 'recording' : 'offline');
      if (value) {
        await closeWindow();
        await saveChain;
        captureSettled = true;
        await pump();
      } else {
        if (!ready || stopSent) { ws?.close(); clearTimeout(retry); connect(); }
        node.port.postMessage({ type: 'resume' });
      }
    },
  };
}
