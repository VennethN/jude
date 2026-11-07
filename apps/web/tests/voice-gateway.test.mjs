import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceHeaders } from '../voice-gateway.mjs';

const remote = new URL('https://voice.example.org');
const local = 'http://localhost:5173';
const browser = { host: 'localhost:5173', origin: local, 'sec-fetch-site': 'same-origin', cookie: 'other_app=outside; jude_session=example; theme=green' };

test('a local browser forwards its Jude session and the recording handshake to the configured HTTPS gateway', () => {
  const req = { method: 'GET', headers: { ...browser, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'test', authorization: 'unused' } };
  assert.deepEqual(voiceHeaders(req, remote), {
    host: remote.host, origin: remote.origin, cookie: 'jude_session=example', upgrade: 'websocket',
    connection: 'Upgrade', 'sec-websocket-key': 'test', 'sec-fetch-site': 'same-origin',
  });
  const audio = voiceHeaders({ method:'GET', headers:{ host: browser.host, range: 'bytes=0-44', cookie:browser.cookie } }, remote);
  assert.equal(audio.range, 'bytes=0-44');
  const upload = voiceHeaders({ method:'POST', headers: { ...browser, 'content-type':'multipart/form-data; boundary=test', 'idempotency-key':'one' } }, remote);
  assert.equal(upload['content-type'], 'multipart/form-data; boundary=test');
  assert.equal(upload['idempotency-key'], 'one');
});

test('origin translation rejects mismatched browser origins and cross-site requests', () => {
  for (const change of [{ origin: 'https://unrelated.example' }, { origin: undefined }, {origin:'null'}, { origin: 'http://localhost:9000' }, {'sec-fetch-site':'cross-site'}]) {
    assert.equal(voiceHeaders({method:'POST',headers:{...browser,...change}}, remote), null);
  }
  assert.equal(voiceHeaders({method:'GET',headers:{...browser,upgrade:'websocket',origin:undefined}}, remote), null);
  assert.equal(voiceHeaders({method:'GET',headers:{...browser,host:'unrelated.example',origin:'https://unrelated.example'}}, remote), null);
  assert.equal(voiceHeaders({method:'POST',headers:browser}, remote, 'https://app.example.org'), null);
});

test('the internal Python service receives browser headers unchanged', () => {
  assert.equal(voiceHeaders({method: 'POST', headers: browser}, new URL('http://127.0.0.1:3001'), local), browser);
});
