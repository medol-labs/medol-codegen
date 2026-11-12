import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPipeline, planPipeline} from './pipeline.mjs';

export function validateMode(mode, config) {
    if (!['local', 'remote'].includes(mode)) throw new Error('Mode must be local or remote');
    const remoteSteps = (config.steps || []).filter(step => config.hosts?.[step.host]?.transport === 'ssh');
    if (mode === 'local' && remoteSteps.length) throw new Error('Local mode cannot execute SSH steps');
    if (mode === 'remote' && !remoteSteps.length) throw new Error('Remote mode requires at least one SSH step');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        let mode, pipeline;
        let plan = false;
        while (args.length) {
            const arg = args.shift();
            if (arg === '--mode') mode = args.shift();
            else if (arg === '--pipeline') pipeline = args.shift();
            else if (arg === '--plan') plan = true;
            else throw new Error(`Unknown option: ${arg}`);
        }
        if (!mode) throw new Error('Usage from project root: node simulation/src/run.mjs --mode local|remote [--plan] [--pipeline path]');
        const simulationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
        const file = pipeline ? resolve(pipeline) : resolve(simulationRoot, 'pipelines', mode === 'local' ? 'pipeline.json' : 'remote.json');
        const config = JSON.parse(readFileSync(file, 'utf8'));
        validateMode(mode, config);
        const root = process.cwd();
        const catalog = JSON.parse(readFileSync(resolve(root, 'operations/model/services.json'), 'utf8'));
        planPipeline(catalog, config);
        console.log(`[simulation] mode=${mode}, pipeline=${file}`);
        const result = runPipeline(catalog, config, {root, plan, reportRoot: resolve(simulationRoot, 'reports')});
        console.log(JSON.stringify(result, null, 2));
        if (result.status === 'failed') process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
