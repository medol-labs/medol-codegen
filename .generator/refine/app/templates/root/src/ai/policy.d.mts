export interface Capability {
  id: string;
  kind: 'command' | 'query';
  reference: { context: string; element: string };
  confirmation: 'required' | 'none';
}
export interface Profile { id: string; mode: 'chat' | 'operator' | 'bi'; capabilities: string[] }
export interface Manifest {
  assistants: Array<{name: string; mode: Profile['mode']; bindings: Array<Capability['reference'] & {kind: Capability['kind']; confirmation: Capability['confirmation']}>}>;
  capabilities: Capability[];
}
export interface Configuration { enabled: boolean; profiles: Profile[] }
export function resolveAssistant(manifest: Manifest, profile: Profile): Capability[];
export function resolveConfiguration(manifest: Manifest, config: Configuration): Array<Omit<Profile, 'capabilities'> & {capabilities: Capability[]}>;
