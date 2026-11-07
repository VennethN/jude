import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { attachVoice } from './transport';
import { transaction } from '@jude/core/server/db';

process.env.BODY_SIZE_LIMIT ??= '64M';
const webHandler=new URL('../../web/build/handler.js',import.meta.url);
const {handler}=await import(webHandler.href) as {handler:(req:IncomingMessage,res:ServerResponse)=>void};
const server=createServer((req,res)=>{
 if(req.url==='/healthz'){
  void transaction(db=>db.query('SELECT 1')).then(()=>{res.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});res.end('ok')}).catch(()=>{res.writeHead(503);res.end('unavailable')});
 }else handler(req,res);
});
attachVoice(server);
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0');
function close(){server.close();const timer=setTimeout(()=>process.exit(0),10000);timer.unref();}
process.once('SIGTERM',close);process.once('SIGINT',close);
