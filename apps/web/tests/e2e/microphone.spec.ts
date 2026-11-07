import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import ts from 'typescript';

type Packet = { id: string; t: number; keep: boolean; pcm: string };
type ClientTurn = { id: string; text: string; t?: number; speakerId?: string };
interface CaptureFixture {
  recorder: { stop: () => Promise<void>; paused: (value: boolean) => Promise<void> };
  tone: GainNode;
  began: number;
  current?: ClientTurn;
  received: number;
  status: string;
  states: string[];
  stream: MediaStream;
  mediaRequests: number;
  recover: () => Promise<void>;
}
declare global {
  interface Window {
    captureFixture: CaptureFixture;
  }
}

const harness = `<!doctype html><meta charset="utf-8">
<button id="start">Start</button><output id="status"></output>
<script type="importmap">{"imports":{"$app/navigation":"/__capture-test__/navigation.js"}}</script>
<script type="module">
import {capture} from '/__capture-test__/microphone.js';
const f = window.captureFixture = { received:0, status:'idle', states:[], mediaRequests:0 };
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:async () => {
  f.mediaRequests++;
  const audio = new AudioContext({sampleRate:24000});
  const input=audio.createOscillator(), gain=audio.createGain(), stream=audio.createMediaStreamDestination();
  f.tone=gain; gain.gain.value=location.search.includes('silent') ? 0 : .15;
  input.frequency.value=330; input.connect(gain).connect(stream);
  await audio.resume(); input.start(); f.stream=stream.stream; return stream.stream;
}});
f.recover=async()=>{
  const retry=await capture('case-1','hearing-1','member-1',false,undefined,
    (state)=>{f.status=state;document.querySelector('#status').textContent=state},()=>{},'id',false,true);
  await retry.stop();
};
start.onclick=async()=>{
  f.began=performance.now();
  f.recorder=await capture('case-1','hearing-1','member-1',true,undefined,
    (state)=>{f.status=state; f.states.push(state); document.querySelector('#status').textContent=state},
    (turn)=>{f.current=turn;if(turn){f.received=performance.now()-f.began}},'id');
};
</script>`;

async function setup(
  page: Page,
  socket: (ws: WebSocketRoute) => void,
  silent = false,
  beforeStart?: () => Promise<void>,
) {
  const file = await readFile(new URL('../../src/lib/workspace/microphone.ts', import.meta.url), 'utf8');
  const input = await readFile(new URL('../../src/lib/workspace/microphone-input.ts', import.meta.url), 'utf8');
  await page.route('**/__capture-test__/microphone-input', route => route.fulfill({
    contentType: 'application/javascript', body: ts.transpileModule(input, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
  }));
  const compiled = ts.transpileModule(file, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const worklet = await readFile(new URL('../../static/voice-capture.js', import.meta.url), 'utf8');
  await page.route('**/voice-capture.js', route =>
    route.fulfill({ contentType: 'application/javascript', body: worklet }),
  );
  await page.route('**/__capture-test__/microphone.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: compiled }),
  );
  await page.route('**/__capture-test__/navigation.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'export async function invalidate() {}' }),
  );
  await page.route('**/__capture-test__/index*', (route) =>
    route.fulfill({ contentType: 'text/html', body: harness }),
  );
  await page.routeWebSocket('**/api/live/*/*/socket*', socket);
  await page.goto('/__capture-test__/index' + (silent ? '?silent' : ''));
  await beforeStart?.();
  await page.getByRole('button', { name: 'Start' }).click();
  // A rejection can follow the first 200 ms block before a polling tick sees recording.
  await expect.poll(() => page.evaluate(() => window.captureFixture.states)).toContain('recording');
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const r = indexedDB.open('jude-voice');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    try {
      return await new Promise<string[]>((ok, fail) => {
        const r = db.transaction('turns').objectStore('turns').getAllKeys();
        r.onsuccess = () => ok(r.result.map(String));
        r.onerror = () => fail(r.error);
      });
    } finally {
      db.close();
    }
  });
}
const duration = (packet: Packet) => Buffer.from(packet.pcm, 'base64').byteLength / 48_000;
function acknowledge(ws: WebSocketRoute, packet: Packet) {
  ws.send(JSON.stringify({ type: 'ack', id: packet.id, statementId: 'mic-hearing-1-' + packet.id }));
}

test('live speech streams in 200 ms blocks and an unacknowledged turn survives a reconnect', async ({
  page,
}) => {
  let first: Packet | undefined;
  let firstSocket: WebSocketRoute | undefined;
  const attempted: Packet[] = [];
  await setup(page, (ws) => {
    ws.onMessage((raw) => {
      const packet = JSON.parse(String(raw)) as Packet & { type?: string };
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
      attempted.push(packet);
      if (!first) {
        first = packet;
        firstSocket = ws;
        ws.send(
          JSON.stringify({
            type: 'partial',
            id: 'mic-hearing-1-' + packet.id,
            t: packet.t,
            text: 'Saya melihat dokumen itu.',
          }),
        );
      } else acknowledge(ws, packet);
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2 }));
  });
  await expect
    .poll(() => page.evaluate(() => window.captureFixture.current?.text), { timeout: 6000 })
    .toBe('Saya melihat dokumen itu.');
  expect(first).toBeDefined();
  expect(duration(first!)).toBeCloseTo(0.2, 3);
  const caption = await page.evaluate(() => ({
    turn: window.captureFixture.current,
    elapsed: window.captureFixture.received,
  }));
  expect(caption.turn?.id).toBe('mic-hearing-1-' + first!.id);
  expect(caption.turn?.speakerId).toBeUndefined();
  expect(caption.elapsed).toBeLessThan(1800);
  await page.evaluate(() => window.captureFixture.recorder.paused(true));
  expect(await stored(page)).toContain(first!.id);
  firstSocket!.close({ code: 1011 });
  await expect.poll(() => attempted.length, { timeout: 8000 }).toBeGreaterThan(1);
  expect(attempted[1]).toEqual(first);
  await expect.poll(() => stored(page)).toEqual([]);
  await page.evaluate(() => window.captureFixture.recorder.stop());
  await expect.poll(() => page.evaluate(() => window.captureFixture.status)).toBe('stopped');
  await test.info().attach('caption-timing.json', {
    body: JSON.stringify({
      capturedSeconds: duration(first!),
      fixtureEndToEndMs: Math.round(caption.elapsed),
    }),
    contentType: 'application/json',
  });
});

test('silence streams promptly so AWS can finish turns, while pause and resume preserve every sample', async ({
  page,
}) => {
  const packets: Packet[] = [];
  await setup(
    page,
    (ws) => {
      ws.onMessage((raw) => {
        const packet = JSON.parse(String(raw)) as Packet & { type?: string };
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
        packets.push(packet);
        acknowledge(ws, packet);
      });
      ws.send(JSON.stringify({ type: 'ready', protocol: 2 }));
    },
    true,
  );
  await expect.poll(() => packets.length, { timeout: 1800 }).toBeGreaterThanOrEqual(2);
  expect(duration(packets[0])).toBeCloseTo(0.2, 3);
  expect(Buffer.from(packets[0].pcm, 'base64').every(byte => byte === 0)).toBe(true);
  await page.evaluate(() => {
    window.captureFixture.tone.gain.value = 0.18;
  });
  await expect.poll(() => packets.some(p => Buffer.from(p.pcm, 'base64').some(byte => byte !== 0)),
    { timeout: 1800 }).toBe(true);
  await page.evaluate(() => window.captureFixture.recorder.paused(true));
  await expect.poll(() => stored(page)).toEqual([]);
  const boundary = packets.length;
  await page.waitForTimeout(350);
  expect(packets).toHaveLength(boundary);
  await page.evaluate(() => window.captureFixture.recorder.paused(false));
  await expect.poll(() => packets.length, { timeout: 4500 }).toBeGreaterThan(boundary);
  await page.evaluate(() => window.captureFixture.recorder.stop());
  await expect.poll(() => stored(page)).toEqual([]);
  let total = 0;
  for (const packet of packets) {
    expect(packet.t).toBeCloseTo(total, 4);
    total += duration(packet);
    expect(packet.keep).toBe(true);
  }
});

test('provider backpressure keeps one turn in flight while later speech stays durable', async ({
  page,
}) => {
  let connection: WebSocketRoute | undefined;
  const packets: Packet[] = [];
  await setup(page, (ws) => {
    connection = ws;
    ws.onMessage((message) => {
      const packet = JSON.parse(String(message)) as Packet & { type?: string };
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
      packets.push(packet);
      if (packets.length > 1) acknowledge(ws, packet);
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2 }));
  });
  await expect.poll(() => packets.length, { timeout: 6000 }).toBe(1);
  await expect.poll(async () => (await stored(page)).length, { timeout: 3000 }).toBeGreaterThanOrEqual(2);
  expect(packets).toHaveLength(1);
  acknowledge(connection!, packets[0]);
  await expect.poll(() => packets.length).toBeGreaterThanOrEqual(2);
  expect(duration(packets[0])).toBeCloseTo(0.2, 3);
  expect(duration(packets[1])).toBeCloseTo(0.2, 3);
  expect(packets[1].t).toBeCloseTo(0.2, 3);
  await page.evaluate(() => window.captureFixture.recorder.stop());
});

test('three turns reach recognition before the first ACK and further speech stays recorded', async ({ page }) => {
  const packets: Packet[] = [];
  let socket!: WebSocketRoute;
  let draining = false;
  await setup(page, ws => {
    socket = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw)) as Packet & { type?: string };
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
      packets.push(packet);
      if (draining) acknowledge(ws, packet);
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
  });

  await expect.poll(() => packets.length, { timeout: 12_000 }).toBe(3);
  for (const [index, packet] of packets.entries()) {
    expect(packet.t).toBeCloseTo(index * 0.2, 3);
    expect(duration(packet)).toBeCloseTo(0.2, 3);
  }
  const [first, second, third] = packets;
  socket.send(JSON.stringify({ type: 'partial', id: 'mic-hearing-1-' + third.id, t: third.t, text: 'Turn three is audible.' }));
  await expect.poll(() => page.evaluate(() => window.captureFixture.current?.text)).toBe('Turn three is audible.');

  // With every slot occupied, subsequent audio still reaches durable storage.
  await expect.poll(async () => (await stored(page)).length, { timeout: 3000 }).toBeGreaterThanOrEqual(4);
  expect(packets).toHaveLength(3);
  await expect(page.locator('#status')).toHaveText('recording');
  await page.evaluate(() => window.captureFixture.recorder.paused(true));

  acknowledge(socket, second);
  await expect.poll(() => packets.length).toBe(4);
  const fourth = packets[3];
  expect(fourth.t).toBeCloseTo(0.6, 3);
  expect(duration(fourth)).toBeCloseTo(0.2, 3);
  const pending = await stored(page);
  expect(pending).toEqual(expect.arrayContaining([first.id, third.id, fourth.id]));
  expect(pending).not.toContain(second.id);
  expect(new Set(packets.map(packet => packet.id)).size).toBe(4);

  draining = true;
  for (const packet of [third, fourth, first]) acknowledge(socket, packet);
  await expect.poll(() => stored(page)).toEqual([]);
  await page.evaluate(() => window.captureFixture.recorder.stop());
  await expect(page.locator('#status')).toHaveText('stopped');
});

test('a previous recorder version drains the current hearing in timestamp order', async ({ page }) => {
  const attempts: Packet[] = [];
  await setup(
    page,
    (ws) => {
      ws.onMessage((message) => {
        const packet = JSON.parse(String(message)) as Packet & { type?: string };
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
        attempts.push(packet);
        acknowledge(ws, packet);
      });
      ws.send(JSON.stringify({ type: 'ready', protocol: 2 }));
    },
    true,
    () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('jude-voice', 1);
          req.onupgradeneeded = () =>
            req.result.createObjectStore('turns', { keyPath: 'id' }).createIndex('scope', 'scope');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('turns', 'readwrite'),
              turns = tx.objectStore('turns');
            for (const [id, t, scope] of [
              ['a-later', 6, 'member-1/case-1/hearing-1'],
              ['z-earlier', 1, 'member-1/case-1/hearing-1'],
              ['separate', 0, 'another-member/another-case/hearing-1'],
            ]) {
              turns.add({ id, t, scope, keep: true, pcm: new Int16Array(2400).buffer });
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      }),
  );
  await expect.poll(() => attempts.slice(0, 2).map((p) => p.id)).toEqual(['z-earlier', 'a-later']);
  await page.evaluate(() => window.captureFixture.recorder.stop());
  const remaining = await stored(page);
  expect(remaining).toEqual(['separate']);
});

test('capture acceptance retains replay audio while freeing slots, then stop drains final completion', async ({ page }) => {
  const packets: Packet[] = [];
  let socket!: WebSocketRoute;
  await setup(page, ws => {
    socket = ws;
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw)) as Packet & { type?: string };
      if (message.type === 'stop') {
        for (const packet of packets) acknowledge(ws, packet);
        ws.send(JSON.stringify({ type: 'stopped' }));
        return;
      }
      packets.push(message);
      ws.send(JSON.stringify({ type: 'accepted', id: message.id }));
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 1 }));
  });
  await expect.poll(() => packets.length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const captured = packets.slice();
  expect(await stored(page)).toEqual(expect.arrayContaining(captured.map(p => p.id)));
  // Acceptance must permit later capture without acknowledging its transcript.
  expect(new Set(captured.map(p => p.id)).size).toBe(captured.length);
  socket.send(JSON.stringify({ type: 'partial', id: 'provider-result', turnId: captured[0].id, text: 'Still pending.' }));
  await expect.poll(() => page.evaluate(() => window.captureFixture.current?.text)).toBe('Still pending.');
  await page.evaluate(() => window.captureFixture.recorder.stop());
  expect(await stored(page)).toEqual([]);
  await expect(page.locator('#status')).toHaveText('stopped');
});

test('policy rejection preserves pending audio and stops automatic retries without a drain timeout', async ({ page }) => {
  let connections = 0;
  await setup(page, ws => {
    connections++;
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.id) ws.close({ code: 1008 });
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 1 }));
  });
  await expect(page.locator('#status')).toHaveText('service_error', { timeout: 6000 });
  expect((await stored(page)).length).toBeGreaterThan(0);
  const started = Date.now();
  const result = await page.evaluate(() => window.captureFixture.recorder.stop().then(() => 'done', () => 'pending'));
  expect(result).toBe('pending');
  expect(Date.now() - started).toBeLessThan(3000);
  await page.waitForTimeout(3200);
  expect(connections).toBe(1);
  expect((await stored(page)).length).toBeGreaterThan(0);
});

test('rapid pause and resume waits for final drain before opening the next stream', async ({ page }) => {
  let connections = 0;
  let finishFirst: (() => void) | undefined;
  const packets: Packet[] = [];
  await setup(page, ws => {
    const number = ++connections;
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw)) as Packet & { type?: string };
      if (message.type === 'stop') {
        const finish = () => {
          for (const packet of packets) acknowledge(ws, packet);
          ws.send(JSON.stringify({ type: 'stopped' }));
        };
        if (number === 1) finishFirst = finish;
        else finish();
        return;
      }
      packets.push(message);
      ws.send(JSON.stringify({ type: 'accepted', id: message.id }));
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
  });
  await expect.poll(() => packets.length, { timeout: 6000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    void window.captureFixture.recorder.paused(true);
    void window.captureFixture.recorder.paused(false);
  });
  await expect.poll(() => !!finishFirst).toBe(true);
  await page.waitForTimeout(500);
  expect(connections).toBe(1);
  expect((await stored(page)).length).toBeGreaterThan(0);
  finishFirst!();
  await expect.poll(() => connections).toBe(2);
  await expect(page.locator('#status')).toHaveText('recording');
  await page.evaluate(() => window.captureFixture.recorder.stop());
  expect(await stored(page)).toEqual([]);
});

test('ending releases the microphone before delayed transcript completion and records no further audio', async ({ page }) => {
  const packets: Packet[] = [];
  let finish: (() => void) | undefined;
  await setup(page, ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw)) as Packet & { type?: string };
      if (packet.type === 'stop') {
        finish = () => {
          for (const item of packets) acknowledge(ws, item);
          ws.send(JSON.stringify({ type: 'stopped' }));
        };
      } else {
        packets.push(packet);
        ws.send(JSON.stringify({ type: 'accepted', id: packet.id }));
      }
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
  });
  await expect.poll(() => packets.length).toBeGreaterThan(0);
  const tracks = await page.evaluate(() => {
    void window.captureFixture.recorder.stop();
    return window.captureFixture.stream.getTracks().map(t => t.readyState);
  });
  expect(tracks).toEqual(['ended']);
  await expect.poll(() => !!finish).toBe(true);
  await expect(page.locator('#status')).toHaveText('draining');
  const frozen = packets.length;
  await page.waitForTimeout(2800);
  expect(packets).toHaveLength(frozen);
  expect((await stored(page)).length).toBeGreaterThan(0);
  finish!();
  await expect(page.locator('#status')).toHaveText('stopped');
  expect(await stored(page)).toEqual([]);
});

test('failed ending can retry stored audio without obtaining another microphone stream', async ({ page }) => {
  let connection = 0;
  const retried: Packet[] = [];
  await setup(page, ws => {
    const attempt = ++connection;
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw)) as Packet & { type?: string };
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
      if (attempt === 1) {
        ws.send(JSON.stringify({ type: 'error', code: 'validation' }));
        return;
      }
      retried.push(packet);
      acknowledge(ws, packet);
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
  });
  await expect(page.locator('#status')).toHaveText('service_error', { timeout: 6000 });
  expect(await page.evaluate(() => window.captureFixture.stream.getTracks().map(t => t.readyState))).toEqual(['ended']);
  expect(await page.evaluate(() => window.captureFixture.recorder.stop().then(() => 'done', e => e.message))).toBe('audio_pending');
  const pending = await stored(page);
  expect(pending.length).toBeGreaterThan(0);
  await page.evaluate(() => window.captureFixture.recover());
  expect(retried.map(p => p.id)).toEqual(expect.arrayContaining(pending));
  expect(await stored(page)).toEqual([]);
  expect(await page.evaluate(() => window.captureFixture.mediaRequests)).toBe(1);
  await expect(page.locator('#status')).toHaveText('stopped');
});
