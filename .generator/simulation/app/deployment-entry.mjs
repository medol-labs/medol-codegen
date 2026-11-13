import {readFileSync} from 'node:fs';
import {resolve, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {planDeployment, runDeployment} from './runtime/deployment.mjs';

try {
    const [file, option] = process.argv.slice(2);
    if (!file || (option && option !== '--plan')) throw new Error('Usage from project root: node simulation/src/deploy.mjs <config.json> [--plan]');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const catalog = JSON.parse(readFileSync('operations/model/services.json', 'utf8'));
    const plan = planDeployment(config, catalog);
    if (option === '--plan') console.log(JSON.stringify(plan, null, 2));
    else {
        const extensionRoot = resolve('simulation/extensions');
        const adapterFile = resolve(config.adapter || '');
        const within = relative(extensionRoot, adapterFile);
        if (!within || within === '..' || within.startsWith(`..${sep}`) || within.startsWith(sep)) {
            throw new Error('adapter must reference a trusted module under simulation/extensions');
        }
        const {createDeploymentAdapter} = await import(pathToFileURL(adapterFile).href);
        if (typeof createDeploymentAdapter !== 'function') throw new Error('Adapter must export createDeploymentAdapter(config, plan)');
        const result = await runDeployment(config, createDeploymentAdapter, {catalog,
            record: entry => console.log(`[deployment] ${entry.step}: ${entry.status}`)});
        console.log(`Deployment ready: ${result.deploymentId}`);
    }
} catch (error) { console.error(error.message); process.exitCode = 1; }
