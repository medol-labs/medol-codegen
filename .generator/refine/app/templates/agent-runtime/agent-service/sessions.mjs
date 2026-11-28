import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export function createSessionRepository(directory) {
  const locks=new Map();
  const ownerPath=owner=>join(directory,createHash('sha256').update(JSON.stringify([owner.user,owner.tenant,owner.assistant])).digest('hex'));
  const file=(owner,id)=>{
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id ?? '')) throw new Error('Invalid thread identifier');
    return join(ownerPath(owner),`${id}.json`);
  };
  const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return {messages:[],revision:0};throw error;}};
  return {
    async load(owner,id) {return read(file(owner,id));},
    async save(owner,id,messages,expectedRevision=0) {
      const target=file(owner,id);
      const previous=locks.get(target) ?? Promise.resolve();
      let release;
      const locked=new Promise(resolve=>{release=resolve;});
      const queue=previous.then(()=>locked);
      locks.set(target,queue);
      await previous;
      try {
      const current=await read(target);
      if(!Number.isSafeInteger(expectedRevision) || expectedRevision<0 || expectedRevision!==(current.revision ?? 0)) throw Object.assign(new Error('Conversation changed in another session'),{status:409});
      if(!Array.isArray(messages)||messages.length>100||messages.some(m=>!m||!['user','assistant','tool'].includes(m.role)||!Array.isArray(m.parts))) throw new Error('Invalid snapshot');
      if(messages.some(m=>m.parts.some(part=>part.type==='tool-call' && !['complete','error'].includes(part.state)))) throw new Error('Pending tool calls cannot be restored as completed history');
      const value=JSON.stringify({threadId:id,revision:expectedRevision+1,updatedAt:new Date().toISOString(),messages});
      if(Buffer.byteLength(value)>262144) throw new Error('Conversation is too large');
      const folder=ownerPath(owner);await mkdir(folder,{recursive:true,mode:0o700});
      const temp=join(folder,`${randomUUID()}.tmp`);
      try {await writeFile(temp,value,{mode:0o600,flag:'wx'});await rename(temp,target);} finally {await unlink(temp).catch(()=>{});}
      return {revision:expectedRevision+1};
      } finally {release();if(locks.get(target)===queue)locks.delete(target);}
    },
    async list(owner) {
      const folder=ownerPath(owner);
      const names=await readdir(folder).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      const entries=await Promise.all(names.filter(name=>name.endsWith('.json')).map(async name=>({threadId:name.slice(0,-5),updatedAt:(await stat(join(folder,name))).mtime.toISOString()})));
      return entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,50);
    },
  };
}
