import {resolveConfiguration} from './policy.mjs';
import type {Manifest, Configuration, Capability} from './policy.mjs';

export type ExecutionScope = {
  user: string;
  tenant: string;
  policyRevision: string;
  instance: string;
  revision: number;
};
export type ExecutionResult = {
  status: 'accepted' | 'completed' | 'rejected' | 'unknown';
  data?: unknown;
  message?: string;
};
export type PreparedOperation = {
  payload: unknown;
  // Must execute precisely payload, after preparing normal form/domain extensions.
  execute: () => Promise<unknown>;
};
export type CapabilityAdapter = {
  prepare: (input: unknown) => Promise<PreparedOperation>;
  // Optional authoritative completion check; a successful HTTP response alone is acceptance.
  verify?: (result: unknown) => Promise<boolean>;
};
export type ExecutionProposal = {
  id: string;
  capability: string;
  payload: unknown;
  scope: ExecutionScope;
  expiresAt: number;
};
const same = (a: ExecutionScope, b: ExecutionScope) =>
  a.user === b.user && a.tenant === b.tenant && a.policyRevision === b.policyRevision &&
  a.instance === b.instance && a.revision === b.revision;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Instance-scoped execution coordinator. Backend authorization remains authoritative.
 * Do not expose confirm() as an LLM tool: only a trusted confirmation UI may call it.
 */
export function createAgentExecution(options: {
  policy: () => {manifest: Manifest; configuration: Configuration};
  scope: () => ExecutionScope;
  authorize: (capability: Capability) => Promise<boolean>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const adapters = new Map<string, CapabilityAdapter>();
  const proposals = new Map<string, {view: ExecutionProposal; prepared: PreparedOperation; adapter: CapabilityAdapter; assistant: string; capability: Capability; policySnapshot: string}>();
  const policySnapshot = () => JSON.stringify(options.policy());
  const allowed = (assistant: string, id: string) => {
    const {manifest, configuration} = options.policy();
    const capability = resolveConfiguration(manifest, configuration).find(p => p.id === assistant)?.capabilities.find(c => c.id === id);
    if (!capability) throw new Error('Assistant capability is disabled or outside policy');
    return capability;
  };
  const check = async (assistant: string, id: string) => {
    const capability = allowed(assistant, id);
    if (!(await options.authorize(capability))) throw new Error('Capability access denied');
    allowed(assistant, id); // Policy may have changed while authorization was pending.
    return capability;
  };
  return {
    register(id: string, adapter: CapabilityAdapter) {
      if (adapters.has(id)) throw new Error('Capability instance already registered');
      adapters.set(id, adapter);
      return () => {
        if (adapters.get(id) === adapter) adapters.delete(id);
        for (const [key, proposal] of proposals) if (proposal.adapter === adapter) proposals.delete(key);
      };
    },
    async prepare(assistant: string, id: string, input: unknown): Promise<ExecutionProposal> {
      const scope = {...options.scope()};
      const snapshot = policySnapshot();
      if (!scope.user || !scope.policyRevision || !scope.instance) throw new Error('Missing authenticated execution scope');
      const capability = await check(assistant, id);
      const adapter = adapters.get(id);
      if (!adapter) throw new Error('Capability has no active execution adapter');
      const prepared = await adapter.prepare(structuredClone(input));
      if (snapshot !== policySnapshot() || !same(scope, options.scope()) || adapters.get(id) !== adapter) throw new Error('Execution scope changed during preparation');
      // Snapshot is immutable. Adapter must capture the same final payload in its executor.
      const view = freeze({id: crypto.randomUUID(), capability: id, payload: structuredClone(prepared.payload), scope, expiresAt: now() + 120_000});
      for (const [key, entry] of proposals) if (entry.view.expiresAt <= now()) proposals.delete(key);
      if (proposals.size >= 100) throw new Error('Too many pending execution proposals');
      proposals.set(view.id, {view, prepared, adapter, assistant, capability, policySnapshot: snapshot});
      return view;
    },
    cancel(id: string) { proposals.delete(id); },
    dispose() { proposals.clear(); adapters.clear(); },
    async confirm(id: string): Promise<ExecutionResult> {
      const entry = proposals.get(id);
      if (!entry) throw new Error('Unknown, cancelled or already consumed proposal');
      proposals.delete(id); // Consume before awaits: concurrent confirmations cannot execute twice.
      const {view, prepared, adapter, assistant, capability} = entry;
      await check(assistant, capability.id);
      if (entry.policySnapshot !== policySnapshot() || view.expiresAt <= now() || !same(view.scope, options.scope()) || adapters.get(capability.id) !== adapter) throw new Error('Stale execution proposal');
      let result: unknown;
      try {
        result = await prepared.execute();
      } catch (error) {
        if (view.scope.user !== options.scope().user || view.scope.tenant !== options.scope().tenant) return {status: 'unknown', message: 'Identity changed during execution'};
        if ((error as {commandAccepted?: boolean})?.commandAccepted) return {status: 'accepted', data: (error as {result?: unknown}).result, message: 'Command accepted, but post-submit handling failed'};
        const status = (error as {statusCode?: number})?.statusCode;
        // Timeout/connection failure/5xx may occur after a committed write. Never retry it.
        return {status: status && [400, 401, 403, 404, 409, 422].includes(status) ? 'rejected' : 'unknown', message: error instanceof Error ? error.message : String(error)};
      }
      if (view.scope.user !== options.scope().user || view.scope.tenant !== options.scope().tenant) return {status: 'unknown', message: 'Identity changed during execution'};
      if (capability.kind === 'query') return {status: 'completed', data: result};
      if (adapter.verify) {
        try {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let verified = false;
          try {
            verified = await Promise.race([
              adapter.verify(result),
              new Promise<boolean>(resolve => {timer = setTimeout(() => resolve(false), 3000);}),
            ]);
          } finally { if (timer !== undefined) clearTimeout(timer); }
          if (view.scope.user !== options.scope().user || view.scope.tenant !== options.scope().tenant) return {status: 'unknown', message: 'Identity changed during verification'};
          if (verified) return {status: 'completed', data: result};
        } catch { /* An unavailable projection does not mean a rejected command. */ }
      }
      if (view.scope.user !== options.scope().user || view.scope.tenant !== options.scope().tenant) return {status: 'unknown', message: 'Identity changed during verification'};
      return {status: 'accepted', data: result};
    },
  };
}
