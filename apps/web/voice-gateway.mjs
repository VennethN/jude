// Authenticate the browser origin at Jude Web before forwarding to the TLS voice gateway.
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const forwarded = [
  'accept', 'accept-language', 'content-length', 'content-type', 'range', 'if-range', 'if-none-match',
  'idempotency-key', 'connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version',
  'sec-websocket-protocol', 'sec-websocket-extensions', 'sec-fetch-site', 'user-agent',
];

/** Local HTTP transports already receive and check the original browser headers. */
export function voiceHeaders(req, target, webOrigin) {
  if (target.protocol !== 'https:') return req.headers;
  const { origin, host, upgrade } = req.headers;
  if (req.headers['sec-fetch-site'] === 'cross-site') return null;
  if (origin) {
    let caller;
    try { caller = new URL(origin); } catch { return null; }
    const local = loopback.has(caller.hostname) && caller.host === host && ['http:', 'https:'].includes(caller.protocol);
    const expected = webOrigin ? origin === webOrigin : local;
    if (!expected || origin !== caller.origin) return null;
  } else if (upgrade || !['GET', 'HEAD'].includes(req.method)) {
    return null;
  }
  const headers = { host: target.host };
  for (const name of forwarded) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  const session = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('jude_session='));
  if (session) headers.cookie = session;
  if (origin) headers.origin = target.origin;
  return headers;
}
