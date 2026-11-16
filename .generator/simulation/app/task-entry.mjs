import {readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {resolve, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const name = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) && value !== '..';
export function runDirectory(root, runId) {
    if (!name(runId)) throw new Error('A safe MEDOL_PIPELINE_RUN_ID is required');
    return resolve(root, 'simulation/reports/workflows', runId);
}

export function extensionPath(root, module) {
    if (typeof module !== 'string' || !module) throw new Error('Extension module is required');
    const base = realpathSync(resolve(root, 'simulation/extensions'));
    const file = realpathSync(resolve(root, module));
    const path = relative(base, file);
    if (!path || path === '..' || path.startsWith(`..${sep}`) || path.startsWith(sep)) throw new Error('Module must be under simulation/extensions');
    return file;
}

export async function executeTask(config, taskName, options = {}) {
    const root = resolve(options.root || '.');
    const env = options.env || process.env;
    const runId = options.runId || env.MEDOL_PIPELINE_RUN_ID;
    const directory = runDirectory(root, runId);
    const task = Object.hasOwn(config.tasks || {}, taskName) ? config.tasks[taskName] : undefined;
    if (!name(taskName) || !task || !name(task.output) || !name(task.export)) throw new Error('Invalid task, export or output name');
    const successStatuses = task.successStatuses || ['ready', 'passed', 'completed'];
    if (!Array.isArray(successStatuses) || !successStatuses.length || successStatuses.some(status => !name(status) || ['failed', 'error', 'cancelled', 'skipped', 'running'].includes(status))) throw new Error('Invalid successStatuses');
    const output = resolve(directory, task.output);
    if (existsSync(output)) throw new Error('Output already exists; choose a new run ID');
    const module = extensionPath(root, task.module);
    const inputs = {};
    for (const [key, input] of Object.entries(task.inputs || {})) {
        if (Boolean(input.path) === Boolean(input.artifact)) throw new Error(`Input needs exactly one path or artifact: ${key}`);
        if (input.artifact && !name(input.artifact)) throw new Error('Invalid artifact name');
        const file = input.env && env[input.env] ? resolve(root, env[input.env])
            : input.artifact ? resolve(directory, input.artifact) : resolve(root, input.path);
        inputs[key] = JSON.parse(readFileSync(file, 'utf8'));
        if (input.status && inputs[key]?.status !== input.status) throw new Error(`Input status mismatch: ${key}`);
    }
    mkdirSync(directory, {recursive: true});
    // Prevent concurrent invocations from performing the same side effects.
    const lock = `${output}.lock`;
    closeSync(openSync(lock, 'wx', 0o600));
    try {
        if (existsSync(output)) throw new Error('Output already exists');
        const exports = await import(pathToFileURL(module).href);
        if (!Object.hasOwn(exports, task.export) || typeof exports[task.export] !== 'function') throw new Error('Unknown extension export');
        const result = await exports[task.export](inputs, {root, runId, directory});
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Extension must return a result object');
        writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
        return {output, failed: !successStatuses.includes(result.status)};
    } catch (error) {
        const failure = resolve(directory, `${taskName}.failure.json`);
        if (!existsSync(failure)) writeFileSync(failure, JSON.stringify({runId, task: taskName, status: 'failed'}), {flag: 'wx', mode: 0o600});
        // Exceptions may contain credentials or request payloads.
        throw new Error(`Task ${taskName} failed; inspect trusted extension diagnostics`);
    } finally { unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [file, task, ...extra] = process.argv.slice(2);
        if (!file || !task || extra.length) throw new Error('Usage: task.mjs <tasks.json> <task>');
        const result = await executeTask(JSON.parse(readFileSync(file, 'utf8')), task);
        console.log(`Task result: ${result.output}`);
        if (result.failed) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
