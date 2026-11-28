// SDK-independent candidate capabilities. Discovery never grants execution permission.
const crypto = require('node:crypto');
const identity = (kind, parts) => `${kind}_${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24)}`;
function resolveCapabilities(model) {
 const definitions=[];
 for(const slice of model.slices ?? []) {
  for(const [kind,elements] of [['command',slice.commands],['query',slice.readmodels]]) {
   for(const element of elements ?? []) {
    const reference={context:slice.context,slice:slice.name ?? slice.title,element:element.name ?? element.title,modelId:element.id ?? null};
    const fields=element.fields ?? [];
    const inputFields=kind==='command'?fields.filter(f=>!f.generated && f.source?.kind !== 'derived' && !f.technicalAttribute && !f.portOutput && !f.numbering):[];
    definitions.push({id:identity(kind,[reference.context,reference.element]),kind,reference,
     description:element.description ?? element.title ?? element.name,
     fields:inputFields.map(f=>({name:f.name,type:f.type,optional:!!f.optional,cardinality:f.cardinality ?? 'Single',source:f.source ?? null})),
     exposure:'disabled',confirmation:kind==='command'?'required':'none',
     retry:kind==='command'?'never-automatic':'safe-read',verification:kind==='command'?'explicit-binding-required':'query-result'});
   }
  }
 }
 if(new Set(definitions.map(d=>d.id)).size!==definitions.length) throw new Error('Duplicate AI capability identity');
 return {schemaVersion:1,assistants:model.agentAssistance?.assistants ?? [],capabilities:definitions.sort((a,b)=>a.id.localeCompare(b.id))};
}
const {resolveAssistant, resolveConfiguration} = require('./templates/root/src/ai/policy.mjs');
function writeCapabilities(generator,model,frontend) {
 const manifest=resolveCapabilities(model);
 if(frontend) require("./ai-runtime-writer").bindRuntimeCapabilities(manifest,frontend);

 const profile=generator.destinationPath('src/ai/assistants.custom.json');
 const config=generator.fs.exists(profile)
  ? JSON.parse(generator.fs.read(profile))
  : {enabled:false,profiles:manifest.assistants.map(a=>({id:a.name,mode:a.mode,capabilities:[]}))};
 const profiles = resolveConfiguration(manifest,config);
 if(frontend) for(const profile of profiles) for(const capability of profile.capabilities) {
  if(!capability.binding) throw new Error(`${capability.reference.context}.${capability.reference.element}: ${capability.unavailableReason}`);
 }
 // Validate preserved configuration, including while disabled.
 generator.fs.write(generator.destinationPath('src/ai/capabilities.generated.json'),JSON.stringify(manifest,null,2)+'\n');
 if(!generator.fs.exists(profile)) generator.fs.write(profile,JSON.stringify(config,null,2)+'\n');
 if(frontend) require('./ai-runtime-writer').writeAgentRuntime(generator,frontend);
 for(const name of ['policy.mjs','policy.d.mts','execution.ts']) {
  generator.fs.copy(generator.templatePath('root/src/ai/'+name),generator.destinationPath('src/ai/'+name));
 }
}
module.exports={resolveCapabilities,resolveAssistant,resolveConfiguration,writeCapabilities};
