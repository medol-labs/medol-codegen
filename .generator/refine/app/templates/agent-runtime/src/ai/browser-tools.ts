import {buildToolDefinitions} from './tools.mjs';
import {createAgentExecution} from './execution.ts';
import type {Manifest,Configuration} from './policy.mjs';
import type {AgentStore} from './store';
import type {RuntimeCapability} from './types';

export function createBrowserTools(options:{
 capabilities:RuntimeCapability[]; assistant:string; store:AgentStore; threadId:string;
 manifest:Manifest; configuration:Configuration;
 scope:()=>{user:string;tenant:string};
 authorize:(capability:RuntimeCapability)=>Promise<boolean>;
 navigate:(route:string)=>void;
 getList:(binding:NonNullable<RuntimeCapability['binding']>,input:Record<string,unknown>)=>Promise<unknown>;
}) {
 const {capabilities,assistant,store,threadId,manifest,configuration:config,scope:currentAgentScope,authorize,navigate,getList}=options;
 return buildToolDefinitions(capabilities).map(({capability,action,definition})=>definition.client(async (raw,ctx)=>{
    try {
      if (ctx?.abortSignal?.aborted) throw new Error('Request cancelled');
      if(action==='context') {
        const active=[];
        for(const cap of capabilities) {
          const form=store.forms.get(cap.id);
          if(form && await authorize(cap)) active.push({capability:cap.id,name:`${cap.reference.context}.${cap.reference.element}`,revision:form.revision});
        }
        return {forms:active};
      }
      if(!capability) throw new Error('Missing capability binding');
      if (!await authorize(capability)) throw new Error('Access denied');
      const input=raw as Record<string,unknown>;
      const binding=capability.binding!;
      if (action==='open') {
        if (binding.route.includes(':id') && !input.recordId) throw new Error('Select an existing recordId first');
        navigate(binding.route.replace(':id',encodeURIComponent(String(input.recordId ?? ''))));
        return {status:'opened',message:'Inspect the form after it mounts. No command has been submitted.'};
      }
      const session=store.forms.get(capability.id);
      if (action==='form') {
        if (!session) throw new Error('Open the modeled form first; no matching form is mounted');
        switch(input.operation) {
          case 'inspect': return {instance:session.instance,revision:session.revision,values:session.inspect()};
          case 'fill': return session.fill((input.values ?? {}) as Record<string,unknown>,input.revision as number);
          case 'undo': return session.undo(input.revision as number);
          case 'validate': return {valid:await session.validate(),revision:session.revision};
          default: throw new Error('Unsupported form operation');
        }
      }
      if (action==='prepare' && !session) throw new Error('Open the modeled form first');
      const query=async()=>{
        const identity=currentAgentScope();
        const result=await getList(binding,input);
        const now=currentAgentScope();
        if(identity.user!==now.user || identity.tenant!==now.tenant) throw new Error('Session changed during query');
        const serialized=JSON.stringify(result);
        if(serialized.length>64000) return {status:'too_large',message:'Narrow the query or reduce the page size; no rows were returned to the model.'};
        return result;
      };
      if(action==='query' && capability.confirmation==='none') return await query();
      if(session) store.assertCanPrepare(capability.id,session.instance,session.revision);
      const execution=createAgentExecution({
        policy:()=>({manifest,configuration:config}),
        scope:()=>({...currentAgentScope(),policyRevision:'generated',instance:session?.instance ?? threadId,revision:session?.revision ?? 0}),
        authorize:()=>authorize(capability),
      });
      const unregister=execution.register(capability.id,{prepare:()=>session?session.prepare():Promise.resolve({payload:input,execute:query})});
      try {
        const proposal=await execution.prepare(assistant,capability.id,input);
        const result=await store.ask(proposal,capability.reference.element,()=>execution.confirm(proposal.id),()=>execution.cancel(proposal.id),ctx?.abortSignal);
        if(session) store.recordResult(capability.id,proposal.scope.instance,proposal.scope.revision,result);
        return result;
      } finally {unregister();execution.dispose();}
    } catch(error) { return {status:'rejected',message:error instanceof Error?error.message:String(error)}; }
  }));
}
