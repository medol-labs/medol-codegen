import type {ExecutionProposal, ExecutionResult} from './execution';

export type FormSession = {
  instance: string;
  revision: number;
  inspect: () => Record<string, unknown>;
  fill: (values: Record<string, unknown>, revision: number) => unknown;
  undo: (revision: number) => unknown;
  validate: () => Promise<boolean>;
  prepare: () => Promise<{payload: unknown; execute: () => Promise<unknown>}>;
};
export type PendingConfirmation = {
  proposal: ExecutionProposal;
  label: string;
  executing: () => boolean;
  confirm: () => Promise<void>;
  cancel: () => void;
};
export function createAgentStore() {
  const forms = new Map<string, FormSession>();
  const uncertain = new Set<string>();
  const submitted = new Set<string>();
  const listeners = new Set<() => void>();
  let pending: PendingConfirmation | null = null;
  let version = 0;
  const changed = () => { version++; listeners.forEach(listener => listener()); };
  return {
    forms,
    uncertain,
    assertCanPrepare(id: string, instance: string, revision: number) {
      if(uncertain.has(id) || submitted.has(`${id}:${instance}:${revision}`)) throw new Error('This command was already submitted or has an unknown outcome. Review its business result before another attempt.');
    },
    recordResult(id: string, instance: string, revision: number, result: ExecutionResult) {
      if(result.status==='unknown') uncertain.add(id);
      if(['accepted','completed','unknown'].includes(result.status)) submitted.add(`${id}:${instance}:${revision}`);
      changed();
    },
    acknowledgeUnknown(id: string) {uncertain.delete(id);for(const key of submitted)if(key.startsWith(id+':'))submitted.delete(key);changed();},
    subscribe(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; },
    snapshot: () => version,
    pending: () => pending,
    register(id: string, form: FormSession) {
      if (forms.has(id)) throw new Error('Two active forms expose the same capability');
      forms.set(id, form); changed();
      return () => {
        if (forms.get(id) !== form) return;
        forms.delete(id);
        if (pending?.proposal.scope.instance === form.instance && !pending.executing()) pending.cancel();
        changed();
      };
    },
    ask(proposal: ExecutionProposal, label: string, execute: () => Promise<ExecutionResult>, cancel: () => void, signal?: AbortSignal) {
      if (pending || signal?.aborted) { cancel(); return Promise.resolve({status:'rejected',message:'Another confirmation is pending or the request was cancelled'} as ExecutionResult); }
      return new Promise<ExecutionResult>(resolve => {
        let settled = false;
        let executing = false;
        const finish = (result: ExecutionResult) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', deny);
          pending = null; changed(); resolve(result);
        };
        const deny = () => { cancel(); finish({status:executing?'unknown':'rejected',message:executing?'Stopped waiting; the submitted operation may still complete':'Cancelled by user'}); };
        pending = {proposal, label, executing:()=>executing, cancel:deny, confirm:async () => {
          if (settled || executing) return;
          executing = true; changed();
          try { finish(await execute()); }
          catch(error) { finish({status:'rejected',message:error instanceof Error?error.message:String(error)}); }
        }};
        signal?.addEventListener('abort', deny, {once:true});
        changed();
      });
    },
    cancel() { pending?.cancel(); },
    dispose() { pending?.cancel(); forms.clear(); uncertain.clear(); submitted.clear(); changed(); },
  };
}
export type AgentStore = ReturnType<typeof createAgentStore>;
