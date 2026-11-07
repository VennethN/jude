import type { ClientRequest, IncomingMessage } from 'node:http';
import { voiceHeaders } from '../voice-gateway.mjs';
import type { ProxyOptions } from 'vite';

/** Remote voice keeps production origin checks; the local gateway checks its own origin first. */
export function voiceProxy(env: NodeJS.ProcessEnv): ProxyOptions {
  const target = env.VOICE_ORIGIN || 'http://127.0.0.1:3001';
  if (env.JUDE_VOICE_REMOTE !== 'true') return { target, ws: true, changeOrigin: false };
  const upstream = new URL(target);
  const local = new URL(env.ORIGIN || 'http://localhost:5173');
  if (upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.username || upstream.password)
    throw new Error('Remote VOICE_ORIGIN must be an HTTPS origin without a path or credentials.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname))
    throw new Error('Remote voice development requires a loopback ORIGIN.');
  const allowed = (req: IncomingMessage, socket = false) =>
    req.headers.host === local.host &&
    req.headers['sec-fetch-site'] !== 'cross-site' &&
    (req.headers.origin === local.origin || (!socket && !req.headers.origin && ['GET', 'HEAD'].includes(req.method || '')));
  function forward(out: ClientRequest, req: IncomingMessage) {
    const headers = voiceHeaders(req, upstream, local.origin);
    if (!headers) return;
    for (const name of Object.keys(req.headers)) {
      if (!(name in headers)) out.removeHeader(name);
    }
    if (headers.cookie) out.setHeader('cookie', headers.cookie);
    out.setHeader('Origin', upstream.origin);
  }
  return {
    target: upstream.origin,
    ws: true,
    changeOrigin: true,
    rewrite(path) {
      if (env.CHATGPT_TRANSCRIBE?.trim().toLowerCase() !== 'true') return path;
      const url = new URL(path, local);
      if (!/^\/api\/live\/[^/]+\/[^/]+\/socket$/.test(url.pathname)) return path;
      url.searchParams.set('transcription', 'gpt-transcribe');
      return url.pathname + url.search;
    },
    configure(proxy) {
      proxy.on('proxyReq', (out, req, res) => {
        if (!allowed(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          res.end('Local voice proxy denied origin.');
          out.destroy();
          return;
        }
        forward(out, req);
      });
      proxy.on('proxyReqWs', (out, req, socket) => {
        if (!allowed(req, true)) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          out.destroy();
          return;
        }
        forward(out, req);
      });
    },
  };
}
