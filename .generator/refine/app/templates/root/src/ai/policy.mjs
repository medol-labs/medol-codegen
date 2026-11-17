// Shared by the generator and runtime. Configuration can only narrow model policy.
export function resolveAssistant(manifest, profile) {
  if (!profile || !['chat', 'operator', 'bi'].includes(profile.mode)) throw new Error('Unsupported assistant mode');
  const declared = manifest.assistants.find(a => a.name === profile.id);
  if (!declared || declared.mode !== profile.mode) throw new Error('Assistant is not declared by the model');
  if (!Array.isArray(profile.capabilities) || new Set(profile.capabilities).size !== profile.capabilities.length) throw new Error('Invalid or duplicate assistant capabilities');
  const index = new Map(manifest.capabilities.map(c => [c.id, c]));
  return profile.capabilities.map(id => {
    const capability = index.get(id);
    if (!capability) throw new Error(`Unknown AI capability ${id}`);
    if (profile.mode !== 'operator' && capability.kind === 'command') throw new Error('Read-only assistant cannot expose commands');
    const binding = declared.bindings.find(b => b.kind === capability.kind && b.context === capability.reference.context && b.element === capability.reference.element);
    if (!binding) throw new Error('Capability is outside the modeled assistant boundary');
    if (!['required', 'none'].includes(binding.confirmation) || (capability.kind === 'command' && binding.confirmation !== 'required')) throw new Error('Invalid modeled confirmation policy');
    return {...capability, confirmation: binding.confirmation, exposure: 'enabled'};
  });
}
export function resolveConfiguration(manifest, config) {
  if (!config || typeof config.enabled !== 'boolean' || !Array.isArray(config.profiles)) throw new Error('Invalid assistant configuration');
  if (Object.keys(config).some(k => !['enabled', 'profiles'].includes(k))) throw new Error('Unknown assistant configuration property');
  const seen = new Set();
  const profiles = config.profiles.map(profile => {
    if (seen.has(profile.id)) throw new Error('Duplicate assistant profile');
    seen.add(profile.id);
    if (Object.keys(profile).some(k => !['id', 'mode', 'capabilities'].includes(k))) throw new Error('Unknown assistant profile property');
    return {...profile, capabilities: resolveAssistant(manifest, profile)};
  });
  return config.enabled ? profiles : [];
}
