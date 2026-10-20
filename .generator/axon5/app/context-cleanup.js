const path = require('node:path');
const {existsSync} = require('node:fs');
const {contextPackage} = require('../../common/util/value-types');

function cleanupRelocatedContexts(generator) {
    const model = generator.fullModel ?? generator.model;
    const deployments = model.deployments ?? [];
    const packagesFor = deployment => new Set((deployment.contexts ?? [])
        .map(context => contextPackage(typeof context === 'string' ? context : context.name)));
    const ownedPackages = new Set(deployments.flatMap(deployment => [...packagesFor(deployment)]));
    const packagePath = (model.rootPackage ?? 'tech.medo').split('.').join('/');
    const removed = [];
    for (const deployment of deployments) {
        const assigned = packagesFor(deployment);
        const moduleName = generator._deploymentModuleName(deployment);
        for (const context of ownedPackages) {
            if (assigned.has(context)) continue;
            for (const sourceSet of ['main', 'test']) {
                const directory = generator.destinationPath(path.join(
                    moduleName, 'src', sourceSet, 'kotlin', packagePath, 'context', context
                ));
                if (!existsSync(directory) && !generator.fs.exists(directory)) continue;
                generator.fs.delete(directory);
                removed.push(directory);
                generator.log?.(`Removed relocated generated context: ${directory}`);
            }
        }
    }
    return removed;
}

module.exports = {cleanupRelocatedContexts};
