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
const f = window.captureFixture = { received:0, status:'idle' };
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:async () => {
  const audio = new AudioContext({sampleRate:24000});
  const input=audio.createOscillator(), gain=audio.createGain(), stream=audio.createMediaStreamDestination();
  f.tone=gain; gain.gain.value=location.search.includes('silent') ? 0 : .15;
  input.frequency.value=330; input.connect(gain).connect(stream);
  await audio.resume(); input.start(); return stream.stream;
}});
start.onclick=async()=>{
  f.began=performance.now();
  f.recorder=await capture('case-1','hearing-1','member-1',true,undefined,
    (state)=>{f.status=state; document.querySelector('#status').textContent=state},
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
  const compiled = ts.transpileModule(file, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
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
  await expect.poll(() => page.evaluate(() => window.captureFixture.status)).toBe('recording');
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

test('live speech reaches the provider in 2.4 seconds and an unacknowledged turn survives a reconnect', async ({
  page,
}) => {
  let first: Packet | undefined;
  let firstSocket: WebSocketRoute | undefined;
  const attempted: Packet[] = [];
  await setup(page, (ws) => {
    ws.onMessage((raw) => {
      const packet = JSON.parse(String(raw)) as Packet;
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
    ws.send(JSON.stringify({ type: 'ready' }));
  });
  await expect
    .poll(() => page.evaluate(() => window.captureFixture.current?.text), { timeout: 6000 })
    .toBe('Saya melihat dokumen itu.');
  expect(first).toBeDefined();
  expect(duration(first!)).toBeCloseTo(2.4, 3);
  const caption = await page.evaluate(() => ({
    turn: window.captureFixture.current,
    elapsed: window.captureFixture.received,
  }));
  expect(caption.turn?.id).toBe('mic-hearing-1-' + first!.id);
  expect(caption.turn?.speakerId).toBeUndefined();
  expect(caption.elapsed).toBeLessThan(4500);
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

test('idle silence avoids short turns, a pause drains the worklet tail and resume keeps a continuous timeline', async ({
  page,
}) => {
  const packets: Packet[] = [];
  await setup(
    page,
    (ws) => {
      ws.onMessage((raw) => {
        const packet = JSON.parse(String(raw)) as Packet;
        packets.push(packet);
        acknowledge(ws, packet);
      });
      ws.send(JSON.stringify({ type: 'ready' }));
    },
    true,
  );
  await expect
    .poll(() => page.evaluate(() => performance.now() - window.captureFixture.began))
    .toBeGreaterThan(2600);
  expect(packets).toHaveLength(0);
  await page.evaluate(() => {
    window.captureFixture.tone.gain.value = 0.18;
  });
  await expect.poll(() => packets.length, { timeout: 5000 }).toBe(1);
  const original = Buffer.from(packets[0].pcm, 'base64');
  expect(original.subarray(0, 96_000).every((byte) => byte === 0)).toBe(true);
  expect(original.subarray(-48_000).some((byte) => byte !== 0)).toBe(true);
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

test('a slow provider has one in-flight turn while continuous speech is saved in eight-second windows', async ({
  page,
}) => {
  let connection: WebSocketRoute | undefined;
  const packets: Packet[] = [];
  await setup(page, (ws) => {
    connection = ws;
    ws.onMessage((message) => {
      const packet = JSON.parse(String(message)) as Packet;
      packets.push(packet);
      if (packets.length > 1) acknowledge(ws, packet);
    });
    ws.send(JSON.stringify({ type: 'ready' }));
  });
  await expect.poll(() => packets.length, { timeout: 6000 }).toBe(1);
  await expect.poll(() => stored(page), { timeout: 12_000, intervals: [250] }).toHaveLength(2);
  expect(packets).toHaveLength(1);
  acknowledge(connection!, packets[0]);
  await expect.poll(() => packets.length).toBe(2);
  expect(duration(packets[0])).toBeCloseTo(2.4, 3);
  expect(duration(packets[1])).toBeCloseTo(8, 3);
  expect(packets[1].t).toBeCloseTo(2.4, 3);
  await page.evaluate(() => window.captureFixture.recorder.stop());
});

test('a previous recorder version drains the current hearing in timestamp order', async ({ page }) => {
  const attempts: Packet[] = [];
  await setup(
    page,
    (ws) => {
      ws.onMessage((message) => {
        const packet = JSON.parse(String(message)) as Packet;
        attempts.push(packet);
        acknowledge(ws, packet);
      });
      ws.send(JSON.stringify({ type: 'ready' }));
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
  await expect.poll(() => attempts.map((p) => p.id)).toEqual(['z-earlier', 'a-later']);
  await page.evaluate(() => window.captureFixture.recorder.stop());
  const remaining = await stored(page);
  expect(remaining).toEqual(['separate']);
});
