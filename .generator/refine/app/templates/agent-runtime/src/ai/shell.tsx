import {lazy,Suspense,type PropsWithChildren} from 'react';
import configuration from './assistants.custom.json';
const Provider=lazy(()=>import('./provider').then(module=>({default:module.AgentProvider})));
export function AgentShell({children}:PropsWithChildren) {
  if(!configuration.enabled || !configuration.profiles.length)return <>{children}</>;
  return <Suspense fallback={<div role="status" className="p-4">Loading workspace…</div>}><Provider>{children}</Provider></Suspense>;
}
