import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PropsWithChildren} from 'react';
import {useDataProvider} from '@refinedev/core';
import {useNavigate} from 'react-router';
import {useChat, fetchServerSentEvents} from '@tanstack/ai-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {authHeaders, fetchCurrentUser, authFetch, AUTH_STATE_CHANGE_EVENT} from '@/providers/api-auth';
import {accessControlProvider} from '@/providers/permify-access-control-provider';
import {getAppConfig} from '@/providers/app-config';
import manifestJson from './capabilities.generated.json';
import configuration from './assistants.custom.json';
import {resolveConfiguration, type Manifest, type Configuration} from './policy.mjs';
import {createAgentStore, type AgentStore} from './store';
import {AgentContext} from './context';
import {createBrowserTools} from './browser-tools';
import type {RuntimeCapability} from './types';
import {currentAgentScope} from './scope';

const manifest = manifestJson as Manifest;
const config = configuration as Configuration;
const profiles = resolveConfiguration(manifest,config);

export function AgentProvider({children}: PropsWithChildren) {
  const [session,setSession]=useState(()=>JSON.stringify(currentAgentScope()));
  useEffect(()=>{
    const changed=()=>setSession(JSON.stringify(currentAgentScope()));
    window.addEventListener(AUTH_STATE_CHANGE_EVENT,changed);
    window.addEventListener('storage',changed);
    return ()=>{window.removeEventListener(AUTH_STATE_CHANGE_EVENT,changed);window.removeEventListener('storage',changed);};
  },[]);
  return <AgentScope key={session}>{children}</AgentScope>;
}
function AgentScope({children}: PropsWithChildren) {
  const [store]=useState(createAgentStore);
  const [assistant,setAssistant]=useState(profiles[0]?.id ?? '');
  const [open,setOpen]=useState(false);
  useEffect(()=>()=>store.dispose(),[store]);
  useEffect(()=>{store.cancel();},[assistant,store]);
  if (!profiles.length) return <>{children}</>;
  return <AgentContext.Provider value={store}>
    {children}
    <Button className="fixed bottom-5 right-5 z-50" onClick={()=>setOpen(!open)} aria-expanded={open}>Assistant</Button>
    <section aria-label="Assistant" className={`${open?'flex':'hidden'} fixed right-4 bottom-20 z-50 h-[min(75vh,720px)] w-[min(440px,calc(100vw-32px))] flex-col rounded-lg border bg-background p-4 shadow-xl`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <select aria-label="Assistant profile" className="min-w-0 rounded border bg-background p-2" value={assistant} onChange={event=>setAssistant(event.target.value)}>
          {profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.id} ({profile.mode})</option>)}
        </select>
        <Button variant="ghost" onClick={()=>setOpen(false)}>Close</Button>
      </div>
      <AgentConversation key={assistant} store={store} assistant={assistant}/>
    </section>
  </AgentContext.Provider>;
}

function agentUrl(path: string) {
  return getAppConfig('VITE_AGENT_API_URL','/api/agent/chat').replace(/\/chat(?:\?.*)?$/,path);
}
function AgentConversation({store,assistant}:{store:AgentStore;assistant:string}) {
  const [threadId,setThreadId]=useState<string>(()=>crypto.randomUUID());
  const [sessions,setSessions]=useState<Array<{threadId:string;updatedAt:string}>>([]);
  useEffect(()=>{
    const abort=new AbortController();
    void authFetch(`${agentUrl('/sessions')}?assistantId=${encodeURIComponent(assistant)}`,{signal:abort.signal})
      .then(response=>response.ok?response.json():[]).then(setSessions).catch(()=>{});
    return ()=>abort.abort();
  },[assistant,threadId]);
  return <>
    <div className="mb-2 flex gap-2">
      <select aria-label="Conversation" className="min-w-0 flex-1 rounded border bg-background p-1 text-sm" value={threadId} onChange={event=>{store.cancel();setThreadId(event.target.value);}}>
        <option value={threadId}>Current conversation</option>
        {sessions.filter(session=>session.threadId!==threadId).map(session=><option key={session.threadId} value={session.threadId}>{new Date(session.updatedAt).toLocaleString()}</option>)}
      </select>
      <Button variant="outline" size="sm" onClick={()=>{store.cancel();setThreadId(crypto.randomUUID());}}>New</Button>
    </div>
    <AgentThread key={threadId} store={store} assistant={assistant} threadId={threadId}/>
  </>;
}
function AgentThread({store,assistant,threadId}:{store:AgentStore;assistant:string;threadId:string}) {
  const navigate=useNavigate();
  const provider=useDataProvider();
  const [text,setText]=useState('');
  const historyRevision=useRef(0);
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const [historyError,setHistoryError]=useState('');
  useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
  const pending=store.pending();
  const profile=profiles.find(p=>p.id===assistant)!;
  const capabilities=profile.capabilities as RuntimeCapability[];
  const authorize=useCallback(async (capability:RuntimeCapability)=>{
    const before=currentAgentScope();
    const user=await fetchCurrentUser();
    const after=currentAgentScope();
    if (before.user!==user.id || before.user!==after.user || before.tenant!==after.tenant) return false;
    const binding=capability.binding;
    if (!binding) return false;
    return (await accessControlProvider.can({resource:binding.resource,action:capability.kind==='query'?'list':'create',params:{command:binding.command}})).can;
  },[]);
  const tools=useMemo(()=>createBrowserTools({capabilities,assistant,store,threadId,manifest,configuration:config,scope:currentAgentScope,authorize,navigate,
    getList:(binding,input)=>provider(binding.dataProviderName).getList({resource:binding.resource,meta:binding.meta,pagination:{currentPage:input.page as number,pageSize:input.pageSize as number,mode:'server'},filters:input.filters as never}),
  }),[assistant,authorize,capabilities,navigate,provider,store,threadId]);
  const connection=useMemo(()=>fetchServerSentEvents(getAppConfig('VITE_AGENT_API_URL','/api/agent/chat'),async()=>({headers:await authHeaders(),body:{assistantId:assistant}})),[assistant]);
  const chat=useChat({connection,threadId,tools});
  useEffect(()=>{
    const abort=new AbortController();
    void authFetch(`${agentUrl('/history')}?assistantId=${encodeURIComponent(assistant)}&threadId=${encodeURIComponent(threadId)}`,{signal:abort.signal})
      .then(async response=>{if(!response.ok)throw new Error('Conversation history could not be loaded');return response.json();})
      .then(snapshot=>{
        if(abort.signal.aborted)return;
        historyRevision.current=snapshot.revision ?? 0;
        for(const message of snapshot.messages ?? []) for(const part of message.parts ?? []) {
          if(part.type==='tool-call' && part.output?.status==='unknown') {
            const capability=capabilities.find(cap=>part.name===`prepare_${cap.id}`);
            if(capability)store.recordResult(capability.id,'restored',0,{status:'unknown'});
          }
        }
        chat.setMessages(snapshot.messages ?? []);setHistoryLoaded(true);
      })
      .catch(error=>{if(!abort.signal.aborted)setHistoryError(error.message);});
    return ()=>{abort.abort();chat.stop();store.cancel();};
  },[assistant,threadId,store]);
  useEffect(()=>{
    if(!historyLoaded || chat.isLoading || pending || chat.interrupts.length || !chat.messages.length) return;
    const abort=new AbortController();
    const timer=setTimeout(()=>{
      void authFetch(agentUrl('/history'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assistantId:assistant,threadId,messages:chat.messages,expectedRevision:historyRevision.current}),signal:abort.signal})
        .then(async response=>{if(!response.ok)throw new Error(response.status===409?'Conversation changed in another session; reopen it before saving.':'Conversation could not be saved');const saved=await response.json();historyRevision.current=saved.revision;setHistoryError('');})
        .catch(error=>{if(!abort.signal.aborted)setHistoryError(error.message);});
    },500);
    return ()=>{clearTimeout(timer);abort.abort();};
  },[assistant,threadId,historyLoaded,chat.isLoading,chat.messages,chat.interrupts.length,pending]);
  return <>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
      {chat.messages.map(message=><article key={message.id} className="rounded border p-2 text-sm">
        <strong>{message.role}</strong>
        {message.parts.map((part,index)=>part.type==='text'?<p className="whitespace-pre-wrap break-words" key={index}>{part.content}</p>:part.type==='tool-call'?<div key={index} className="text-xs text-muted-foreground">{capabilities.find(cap=>part.name.includes(cap.id))?.reference.element ?? 'Assistant action'}</div>:part.type==='tool-result'?<ToolOutput key={index} content={part.content}/>:null)}
      </article>)}
      {historyError && <p role="alert" className="text-sm text-destructive">{historyError}</p>}
      {chat.error && <p role="alert" className="text-sm text-destructive">{chat.error.message}</p>}
      {chat.interrupts.map(interrupt=><div key={interrupt.id} className="rounded border p-3 text-sm">
        <p>Allow this tool step? Submission requires a separate review of the final values.</p>
        <pre className="max-h-40 overflow-auto text-xs">{JSON.stringify('originalArgs' in interrupt ? interrupt.originalArgs : interrupt.message,null,2)}</pre>
        <div className="mt-2 flex gap-2"><Button size="sm" onClick={()=>{if(interrupt.kind==='tool-approval')interrupt.resolveInterrupt(true);}}>Allow</Button><Button size="sm" variant="outline" onClick={()=>{if('cancel' in interrupt)interrupt.cancel();}}>Deny</Button></div>
      </div>)}
      {[...store.uncertain].map(id=><div key={id} className="rounded border p-2 text-sm">
        <p>The result of {capabilities.find(cap=>cap.id===id)?.reference.element ?? 'a command'} is unknown. Review the business record before allowing another attempt.</p>
        <Button variant="outline" size="sm" onClick={()=>store.acknowledgeUnknown(id)}>I checked the result; allow another attempt</Button>
      </div>)}
      {pending && <div className="rounded border p-3 text-sm">
        <strong>Confirm {pending.label}</strong>
        <p>Review the final values. Changing the form invalidates this confirmation.</p>
        <pre className="my-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(pending.proposal.payload,null,2)}</pre>
        <div className="flex gap-2"><Button size="sm" disabled={pending.executing()} onClick={()=>void pending.confirm()}>{pending.executing()?'Submitting…':'Confirm'}</Button><Button size="sm" variant="outline" onClick={pending.cancel}>Cancel</Button></div>
      </div>}
    </div>
    <form className="mt-3 space-y-2" onSubmit={event=>{event.preventDefault();if(text.trim()){const message=text;setText('');void chat.sendMessage(message);}}}>
      <Textarea aria-label="Message" value={text} onChange={event=>setText(event.target.value)} maxLength={12000}/>
      <div className="flex gap-2"><Button type="submit" disabled={!historyLoaded || chat.isLoading || !!pending || chat.interrupts.length>0 || !text.trim()}>Send</Button><Button type="button" variant="outline" onClick={()=>{chat.stop();chat.cancelInterrupts();store.cancel();}}>Stop</Button></div>
    </form>
  </>;
}

function ToolOutput({content}:{content:unknown}) {
  let value: unknown=content;
  if(typeof content==='string') {try{value=JSON.parse(content);}catch{value=content;}}
  const result=value && typeof value==='object' ? value as Record<string,unknown> : undefined;
  const rows=Array.isArray(result?.data) ? result.data : undefined;
  if(rows && rows.every(row=>row && typeof row==='object' && !Array.isArray(row))) {
    const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,10);
    return <div className="max-h-64 overflow-auto text-xs"><p>{typeof result?.total==='number'?`${result.total} records`:''}</p><table className="w-full border-collapse"><thead><tr>{columns.map(key=><th key={key} className="border p-1 text-left">{key}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{columns.map(key=><td key={key} className="max-w-48 truncate border p-1">{typeof row[key]==='object'?JSON.stringify(row[key]):String(row[key] ?? '')}</td>)}</tr>)}</tbody></table></div>;
  }
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{typeof value==='string'?value:JSON.stringify(value,null,2)}</pre>;
}
