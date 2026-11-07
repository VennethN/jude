import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { voiceProxy } from '../scripts/voice-proxy.ts';

const env = { JUDE_VOICE_REMOTE: 'true', ORIGIN: 'http://localhost:5173', VOICE_ORIGIN: 'https://voice.example.com' };
function forward(event, headers, method = 'POST') {
  const options = voiceProxy(env);
  const proxy = new EventEmitter();
  options.configure(proxy, options);
  const result = { headers: {}, destroyed: false, status: undefined, body: undefined };
  proxy.emit(event, {
    setHeader: (key, value) => { result.headers[key] = value; },
    destroy: () => { result.destroyed = true; },
  }, { headers, method }, {
    writeHead: (status) => { result.status = status; },
    end: (body) => { result.body = body; },
  });
  return result;
}

test('same-origin web and socket traffic uses the hosted origin', () => {
  for (const event of ['proxyReq', 'proxyReqWs']) {
    const result = forward(event, { host: 'localhost:5173', origin: env.ORIGIN });
    assert.equal(result.headers.Origin, env.VOICE_ORIGIN);
    assert.equal(result.destroyed, false);
  }
});

test('cross-site and forged host requests cannot gain a trusted upstream origin', () => {
  for (const event of ['proxyReq', 'proxyReqWs']) {
    for (const headers of [
      { host: 'localhost:5173', origin: 'https://attacker.example' },
      { host: 'attacker.example', origin: env.ORIGIN },
      { host: 'localhost:5173', origin: env.ORIGIN, 'sec-fetch-site': 'cross-site' },
      { host: 'localhost:5173' },
    ]) {
      const result = forward(event, headers);
      assert.equal(result.destroyed, true);
      assert.equal(result.headers.Origin, undefined);
      assert.match(result.body, /403|denied/);
    }
  }
});

test('originless reads work but originless WebSocket upgrades are rejected', () => {
  const headers = { host: 'localhost:5173' };
  assert.equal(forward('proxyReq', headers, 'GET').destroyed, false);
  assert.equal(forward('proxyReqWs', headers, 'GET').destroyed, true);
});

test('remote mode requires TLS and loopback; ordinary local voice is unchanged', () => {
  assert.throws(() => voiceProxy({ ...env, VOICE_ORIGIN: 'http://voice.example.com' }));
  assert.throws(() => voiceProxy({ ...env, ORIGIN: 'http://0.0.0.0:5173' }));
  assert.deepEqual(voiceProxy({}), { target: 'http://127.0.0.1:3001', ws: true, changeOrigin: false });
});

test('a local transcription trial selects GPT for new hosted recording sockets', () => {
  const socket = '/api/live/case-1/hearing-1/socket?lang=id';
  const trial = voiceProxy({ ...env, CHATGPT_TRANSCRIBE: 'true' });
  assert.equal(trial.rewrite(socket), socket + '&transcription=gpt-transcribe');
  assert.equal(trial.rewrite(socket + '&transcription=other'), socket + '&transcription=gpt-transcribe');
  for (const path of ['/api/live/case-1/upload', '/api/live/capabilities', '/api/live/case-1/hearing-1/audio']) {
    assert.equal(trial.rewrite(path), path);
  }
  assert.equal(voiceProxy(env).rewrite(socket), socket);
  assert.equal(voiceProxy({ ...env, CHATGPT_TRANSCRIBE: 'false' }).rewrite(socket), socket);
});
