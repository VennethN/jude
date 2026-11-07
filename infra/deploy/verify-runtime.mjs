import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const web = 'http://127.0.0.1:3000';
const voice = process.env.VOICE_ORIGIN || 'http://127.0.0.1:3001';

async function waitForHealth(origin) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(origin + '/healthz', { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      // The other process may still be starting or applying its migrations.
    }
    await delay(250);
  }
  throw new Error('Service did not become ready at ' + origin);
}

async function nextCaseVersion(reader, caseId) {
  const decoder = new TextDecoder();
  let event = '';
  while (!event.includes('\n\n')) {
    const { value, done } = await reader.read();
    assert(!done, 'Case event stream closed');
    event += decoder.decode(value, { stream: true });
  }
  assert.match(event, /event: case\.updated/);
  const data = JSON.parse(event.match(/^data: (.+)$/m)[1]);
  assert.equal(data.caseId, caseId);
  return data.version;
}

function checkUpgrade(url, cookie) {
  return new Promise((resolve, reject) => {
    const req = request(url, { signal: AbortSignal.timeout(10000), headers: {
      connection: 'upgrade', upgrade: 'websocket', origin: web, cookie,
      'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64')
    } });
    req.on('response', (res) => {
      resolve(res.statusCode);
      res.resume();
    });
    req.on('upgrade', (_, socket) => {
      socket.destroy();
      reject(new Error('A live recorder opened without a configured transcription provider'));
    });
    req.on('error', reject);
    req.end();
  });
}

await Promise.all([waitForHealth(web), waitForHealth(voice)]);
for (const path of ['/', '/pricing', '/login']) {
  const page = await fetch(web + path);
  assert.equal(page.status, 200, path);
  assert.match(await page.text(), /jude\./);
}
if (process.env.SMOKE_STANDALONE) {
  assert(!existsSync('/app/apps/voice/jude_voice/__main__.py'));
}

const demo = await fetch(web + '/api/auth/demo', { method: 'POST', headers: { origin: web } });
assert.equal(demo.status, 200);
const session = await demo.json();
const cookie = demo.headers.get('set-cookie').split(';')[0];
const caseId = session.demo.caseId;
const prefix = web + '/api/cases/' + caseId;
const original = await fetch(prefix + '/documents/' + session.demo.refs.d1 + '/original', { headers: { cookie } });
assert.equal(original.status, 200);
assert.equal(Buffer.from(await original.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

const readWorkspace = async () => {
  const response = await fetch(prefix + '/workspace', { headers: { cookie } });
  assert.equal(response.status, 200);
  return response.json();
};
const initial = await readWorkspace();
assert(initial.findings.length > 0);
const hearing = initial.hearings.find((entry) => entry.mode === 'live');
const hearingPath = '/api/live/' + caseId + '/' + hearing.id;
const events = await fetch(prefix + '/events', {
  headers: { cookie, accept: 'text/event-stream' }, signal: AbortSignal.timeout(20000)
});
assert.equal(events.status, 200);
assert.match(events.headers.get('content-type'), /text\/event-stream/);
const reader = events.body.getReader();
try {
  const firstVersion = await nextCaseVersion(reader, caseId);
  const replay = await fetch(web + hearingPath + '/replay', {
    method: 'POST', headers: { origin: web, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ cursor: 0 })
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).cursor, 1);
  assert((await nextCaseVersion(reader, caseId)) > firstVersion);
} finally {
  await reader.cancel();
}
const refreshed = await readWorkspace();
assert.equal(refreshed.statements.length, initial.statements.length + 1);
assert(refreshed.statements.some((line) => line.hearingId === hearing.id && line.id === 'replay-' + hearing.id + '-0' && line.text.length > 0));

const anonymous = await fetch(voice + hearingPath + '/replay', {
  method: 'POST', headers: { origin: web, 'content-type': 'application/json' }, body: '{"cursor":1}'
});
assert.equal(anonymous.status, 401);
assert.equal(await checkUpgrade(web + hearingPath + '/socket', cookie), 403);
const deployment = process.env.SMOKE_STANDALONE ? 'Independent web and Python voice images' : 'Combined release';
console.log(deployment + ' passed database health, SSR, session, original PDF, hearing replay, SSE and WebSocket admission checks.');
