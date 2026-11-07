import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
process.env.BODY_SIZE_LIMIT ??= '64M';
const { handler } = await import('./build/handler.js');
const target = process.env.VOICE_ORIGIN ? new URL(process.env.VOICE_ORIGIN) : null;
if (target && !['http:', 'https:'].includes(target.protocol))
  throw new Error('VOICE_ORIGIN must be an HTTP origin.');
const request = target?.protocol === 'https:' ? httpsRequest : httpRequest;
function upstream(req) {
  return request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: req.headers,
  });
}
function noVoice(res) {
  res.writeHead(503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'voice_unavailable', message: 'Voice service is unavailable.' } }));
}
const server = createServer((req, res) => {
  if (!req.url?.startsWith('/api/live/')) {
    handler(req, res);
    return;
  }
  if (!target) {
    noVoice(res);
    return;
  }
  const out = upstream(req);
  out.on('response', (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
    res.on('close', () => r.destroy());
  });
  out.on('error', () => {
    if (!res.headersSent) noVoice(res);
    else res.destroy();
  });
  req.on('aborted', () => out.destroy());
  req.pipe(out);
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/api/live/') || !target) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }
  const out = upstream(req);
  out.on('upgrade', (r, other, upHead) => {
    let headers = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (let i = 0; i < r.rawHeaders.length; i += 2)
      headers += r.rawHeaders[i] + ': ' + r.rawHeaders[i + 1] + '\r\n';
    socket.write(headers + '\r\n');
    if (upHead.length) socket.write(upHead);
    if (head.length) other.write(head);
    socket.pipe(other).pipe(socket);
    other.on('error', () => socket.destroy());
    socket.on('error', () => other.destroy());
    socket.on('close', () => other.destroy());
    other.on('close', () => socket.destroy());
  });
  out.on('response', (r) => {
    socket.end('HTTP/1.1 ' + r.statusCode + ' Unavailable\r\nConnection: close\r\n\r\n');
    r.resume();
  });
  out.on('error', () => socket.destroy());
  out.end();
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1');
function close() {
  server.close();
  setTimeout(() => process.exit(0), 10000).unref();
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
