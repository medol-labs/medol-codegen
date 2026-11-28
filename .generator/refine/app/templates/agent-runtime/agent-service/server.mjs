import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {openaiText} from '@tanstack/ai-openai';
import {createAgentHandler,backendAuthenticator} from './handler.mjs';
import {createSessionRepository} from './sessions.mjs';

if(!process.env.AGENT_AUTH_BASE_URL || !process.env.OPENAI_API_KEY || !process.env.AGENT_MODEL) {
  throw new Error('AGENT_AUTH_BASE_URL, AGENT_MODEL and OPENAI_API_KEY are required');
}
const load=async name=>JSON.parse(await readFile(new URL(`../src/ai/${name}`,import.meta.url),'utf8'));
const handler=createAgentHandler({
  manifest:await load('capabilities.generated.json'),configuration:await load('assistants.custom.json'),
  authenticate:backendAuthenticator(process.env.AGENT_AUTH_BASE_URL),
  adapter:openaiText(process.env.AGENT_MODEL),allowedOrigin:process.env.AGENT_ALLOWED_ORIGIN,
  repository:createSessionRepository(process.env.AGENT_DATA_DIR ?? new URL('./data',import.meta.url).pathname),
});
const server=createServer(async(req,res)=>{
  try {
    const controller=new AbortController();
    res.on('close',()=>controller.abort());
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>262144){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    const request=new Request(`http://localhost:${process.env.AGENT_PORT ?? 3100}${req.url}`,{
      method:req.method,headers:req.headers,signal:controller.signal,
      ...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)}),
    });
    const response=await handler(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body) Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();
  } catch(error) {console.error('Agent request failed:',error instanceof Error?error.message:'Unknown error');if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Assistant service failed'}));}
});
server.requestTimeout=30000;
server.listen(Number(process.env.AGENT_PORT ?? 3100),process.env.AGENT_HOST ?? '127.0.0.1',()=>console.log('Agent service listening'));
