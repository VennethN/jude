// Local capability fixture. The compiled application still handles every case, session and consent write.
import { createServer } from 'node:http';
import { once } from 'node:events';

const voice = createServer((req, res) => {
  if (req.url !== '/capabilities') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ transcription: true }));
});
const web = createServer();
await Promise.all([voice, web].map(server => {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening');
}));
process.env.VOICE_ORIGIN = 'http://127.0.0.1:' + voice.address().port;
process.env.ORIGIN = 'http://127.0.0.1:' + web.address().port;
const { handler } = await import('../../../build/handler.js');
web.on('request', handler);
process.send(process.env.ORIGIN);
