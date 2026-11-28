const path = require('node:path');
const fs = require('node:fs');

function bindRuntimeCapabilities(manifest, frontend) {
  for (const capability of manifest.capabilities) {
    if (capability.kind === 'query') {
      const resource = frontend.resources.find(r => r.readModelId === capability.reference.modelId);
      if (resource?.canList) capability.binding = {
        resource: resource.name, route: `/${resource.route}`, dataProviderName: resource.dataProviderName,
        meta: {aggregateRoute: resource.aggregateRoute, queryRoute: resource.queryRoute, idField: resource.idField, queryFields: resource.queryFields},
      };
    } else {
      for (const resource of frontend.resources) {
        const command = resource.commands.find(c => c.id === capability.reference.modelId);
        if (!command) continue;
        if (!command.requiresPage || command.interactionMode !== 'form' || command.hasFileFields || command.downloadCommand || command.fileUploadProducer) {
          capability.unavailableReason = 'This command needs a specialized UI adapter (custom action, file upload or download).';
          continue;
        }
        command.agentCapabilityId = capability.id;
        command.agentWritableFields = command.fields.filter(f => capability.fields.some(input => input.name === f.name) && !f.select && !f.fileInput).map(f => f.name);
        for (const sibling of [resource.createCommand,resource.editCommand,resource.deleteCommand,...resource.itemCommands,...resource.routedCommands]) {
          if(sibling?.id===command.id) {sibling.agentCapabilityId=command.agentCapabilityId;sibling.agentWritableFields=command.agentWritableFields;}
        }
        capability.binding ??= {
          resource: resource.name, command: command.name, dataProviderName: command.dataProviderName,
          route: command.id === resource.createCommand?.id ? `/${resource.route}/command/${command.route}` : `/${resource.route}/:id/command/${command.route}`,
          writableFields: command.agentWritableFields,
        };
      }
    }
    if (!capability.binding) capability.unavailableReason ??= 'No generated resource or form exposes this capability in the selected frontend.';
  }
  return manifest;
}

const dependencies = {'@tanstack/ai':'1.4.0','@tanstack/ai-react':'1.0.2','@tanstack/ai-client':'1.1.0'};
function writeAgentRuntime(generator, frontend) {
  const source = generator.templatePath('agent-runtime');
  for (const entry of fs.readdirSync(source, {recursive:true})) {
    if (!fs.statSync(path.join(source, entry)).isFile()) continue;
    generator.fs.copy(path.join(source, entry), generator.destinationPath(entry));
  }
  for (const name of ['policy.mjs','tools.mjs']) {
    const from = name === 'policy.mjs' ? 'root/src/ai/policy.mjs' : 'agent-runtime/src/ai/tools.mjs';
    generator.fs.copy(generator.templatePath(from),generator.destinationPath('agent-service/shared/'+name));
  }
  const tenant = Boolean(frontend.frontendSource.tenancy?.enabled);
  generator.fs.write(generator.destinationPath('src/ai/scope.ts'),
    `import {cachedCurrentUser} from '@/providers/api-auth';\n${tenant ? "import {selectedTenant} from '@/lib/tenant-session';\n" : ''}export const currentAgentScope = () => ({user:cachedCurrentUser()?.id ?? '',tenant:${tenant ? "selectedTenant()?.id ?? ''" : "''"}});\n`);
  generator.fs.copy(generator.templatePath('root/src/components/refine-ui/layout/layout.tsx'),generator.destinationPath('src/components/refine-ui/layout/layout.tsx'));
  generator.fs.copyTpl(generator.templatePath('root/docker-entrypoint.d/40-runtime-config.sh'),generator.destinationPath('docker-entrypoint.d/40-runtime-config.sh'),frontend);
  const packagePath = generator.destinationPath('package.json');
  if (generator.fs.exists(packagePath)) {
    const pkg = JSON.parse(generator.fs.read(packagePath));
    pkg.dependencies = {...pkg.dependencies, ...dependencies};
    generator.fs.write(packagePath, JSON.stringify(pkg,null,2)+'\n');
  }
}
module.exports = {bindRuntimeCapabilities, writeAgentRuntime, dependencies};
