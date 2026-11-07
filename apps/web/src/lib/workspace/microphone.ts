interface CapturedTurn {
  scope: string;
  id: string;
  t: number;
  pcm: ArrayBuffer;
  keep: boolean;
}
export interface Recorder {
  stop: () => Promise<void>;
  paused: (value: boolean) => void;
}
export type CaptureState =
  'connecting' | 'recording' | 'offline' | 'paused' | 'draining' | 'stopped' | 'error';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jude-voice', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('turns', { keyPath: 'id' });
      store.createIndex('scope', 'scope');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function pending(db: IDBDatabase, scope: string): Promise<CapturedTurn[]> {
  return new Promise((resolve, reject) => {
    const r = db.transaction('turns').objectStore('turns').index('scope').getAll(scope);
    r.onsuccess = () => resolve((r.result as CapturedTurn[]).sort((a, b) => a.t - b.t));
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
  partial: (text: string) => void,
  language: 'id' | 'en' = 'id',
): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
    throw new Error('Microphone requires HTTPS and a supported browser.');
  const scope = [userId, caseId, hearingId].join('/'),
    db = await database();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, noiseSuppression: true, echoCancellation: false },
  });
  const context = new AudioContext({ sampleRate: 24000 });
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
    inFlight = '',
    stopped = false,
    paused = false,
    draining = false,
    retry: ReturnType<typeof setTimeout> | undefined,
    pumpBusy = false,
    saveChain = Promise.resolve();
  let chunks: Int16Array<ArrayBuffer>[] = [],
    samples = 0,
    silent = 0,
    turnStart = 0;
  const initial = startedAt ? Math.max(0, (Date.now() - Date.parse(startedAt)) / 1000) : 0;
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
    if (!ready || inFlight || pumpBusy || stopped) return;
    pumpBusy = true;
    try {
      const [next] = await pending(db, scope);
      if (!next || !ready || ws?.readyState !== WebSocket.OPEN) return;
      inFlight = next.id;
      ws.send(JSON.stringify({ id: next.id, t: next.t, keep: next.keep, pcm: base64(next.pcm) }));
    } finally {
      pumpBusy = false;
    }
  }
  function connect() {
    if (stopped) return;
    state(draining ? 'draining' : 'connecting');
    ready = false;
    inFlight = '';
    ws = new WebSocket(
      (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host +
        '/api/live/' +
        caseId +
        '/' +
        hearingId +
        '/socket?lang=' +
        language,
    );
    ws.onmessage = async (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'ready') {
          ready = true;
          state(draining ? 'draining' : paused ? 'paused' : 'recording');
          await pump();
        } else if (m.type === 'partial') partial(m.text);
        else if (m.type === 'ack' && m.id === inFlight) {
          await storeTurn(db, m.id);
          inFlight = '';
          partial('');
          await pump();
        }
      } catch {
        state('error');
      }
    };
    ws.onclose = () => {
      ready = false;
      inFlight = '';
      if (!stopped) {
        state('offline');
        retry = setTimeout(connect, 3000);
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
    saveChain = saveChain
      .then(() => storeTurn(db, turn))
      .then(() => pump())
      .catch(() => {
        state('error');
        paused = true;
      });
  }
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (paused || draining || stopped) return;
    const a = new Int16Array(e.data);
    if (!samples) turnStart = elapsed;
    chunks.push(a);
    samples += a.length;
    elapsed += a.length / 24000;
    let peak = 0;
    for (let i = 0; i < a.length; i += 8) peak = Math.max(peak, Math.abs(a[i]));
    silent = peak < 280 ? silent + a.length : 0;
    if (samples >= 24000 * 8 || (samples >= 24000 * 2 && silent >= 24000 * 0.55)) flush();
  };
  connect();
  async function finish() {
    paused = true;
    draining = true;
    flush();
    stream.getTracks().forEach((t) => t.stop());
    source.disconnect();
    node.disconnect();
    if (context.state !== 'closed') await context.close();
    await saveChain;
    await lock?.release();
    state('draining');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && (await pending(db, scope)).length) {
      await new Promise((r) => setTimeout(r, 160));
    }
    const remaining = (await pending(db, scope)).length;
    stopped = true;
    clearTimeout(retry);
    ws?.close();
    db.close();
    window.removeEventListener('beforeunload', checkUnload);
    state(remaining ? 'offline' : 'stopped');
    if (remaining) throw new Error('audio_pending');
  }
  return {
    stop: finish,
    paused(value) {
      if (value) flush();
      paused = value;
      state(value ? 'paused' : ready ? 'recording' : 'offline');
    },
  };
}
