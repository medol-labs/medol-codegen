import {useContext, useEffect, useRef} from 'react';
import type {FieldValues} from 'react-hook-form';
import {AgentContext} from './context';
import {createFormSession, type AgentFormOptions} from './form-session';
export function useAgentForm<T extends FieldValues>(options: AgentFormOptions<T>) {
  const store=useContext(AgentContext);
  const current=useRef(options);current.current=options;
  useEffect(()=>{
    if(!store)return;
    const form=createFormSession(()=>current.current);
    const unregister=store.register(options.capability,form.session);
    return ()=>{form.dispose();unregister();};
  },[store,options.capability]);
}
