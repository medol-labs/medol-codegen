import {readFileSync, mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync, copyFileSync, constants, realpathSync, chmodSync} from 'node:fs';
import {resolve, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runDirectory} from './task-entry.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const artifactName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) && value !== '..';
const defaults = ['.env', '.env.*', '*.private.*', 'secrets.*', '.work/', 'reports/', '**/instances/environments/***', '**/instances/deployments/***', 'node_modules/', '.git/', '*.tar', '*.tar.gz', 'registries.yaml'];
function execute(command, args, options = {}) {
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: 600000, ...options});
    if (result.error || result.status !== 0) throw new Error(`${command} failed`);
    return result.stdout || '';
}

export function validateTransfer(config, root = '.') {
    if (Boolean(config.host) === Boolean(config.hostRef)) throw new Error('Specify exactly one host or hostRef');
    let host = config.host;
    if (config.hostRef) {
        const {pipeline, host: key} = config.hostRef;
        if (typeof pipeline !== 'string' || !pipeline || typeof key !== 'string' || !key) throw new Error('hostRef needs pipeline and host');
        const hosts = JSON.parse(readFileSync(resolve(root, pipeline), 'utf8')).hosts || {};
        if (!Object.hasOwn(hosts, key)) throw new Error('Referenced pipeline host does not exist');
        host = hosts[key];
    }
    if (host?.transport !== 'ssh' || !/^[a-zA-Z0-9_.@-]+$/.test(host.target || '') || host.target.startsWith('-')
        || !/^\/[a-zA-Z0-9_./-]+$/.test(host.workDir || '') || host.workDir.split('/').includes('..') || host.workDir === '/') throw new Error('Invalid SSH worker configuration');
    return host;
}

export function syncWorker(config, options = {}) {
    const root = resolve(options.root || '.'), host = validateTransfer(config, root), run = options.execute || execute;
    if (!Array.isArray(config.inputs) || !config.inputs.length || config.inputs.some(path => typeof path !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) || path.split('/').includes('..'))) throw new Error('Explicit project-relative sync inputs required');
    if (config.excludes && (!Array.isArray(config.excludes) || config.excludes.some(x => typeof x !== 'string'))) throw new Error('Invalid excludes');
    for (const path of config.inputs) {
        const within = relative(realpathSync(root), realpathSync(resolve(root, path)));
        if (!within || within.startsWith(`..${sep}`) || within === '..' || within.startsWith(sep)) throw new Error('Sync input must stay in project');
    }
    const major = Number(run('rsync', ['--version'], {cwd: root}).match(/version\s+(\d+)/)?.[1]);
    if (!major) throw new Error('Cannot determine rsync version');
    run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host.target, `mkdir -p ${quote(host.workDir)}`]);
    // No --delete or --copy-links: preserve remote state and do not traverse source symlinks.
    run('rsync', ['-azR', '--safe-links', ...(major >= 3 ? ['--protect-args'] : []), '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=15',
        ...[...defaults, ...(config.excludes || [])].map(value => `--exclude=${value}`),
        ...config.inputs, `${host.target}:${host.workDir}/`], {cwd: root});
}

export function collectEvidence(config, options = {}) {
    const host = validateTransfer(config, options.root || '.'), run = options.execute || execute;
    const runId = options.runId || process.env.MEDOL_SIMULATION_RUN_ID || process.env.MEDOL_PIPELINE_RUN_ID;
    const directory = runDirectory(options.root || '.', runId);
    const artifacts = config.artifacts;
    if (!Array.isArray(artifacts) || !artifacts.length || artifacts.some(x => !artifactName(x)) || new Set(artifacts).size !== artifacts.length) throw new Error('Explicit unique artifact filenames required');
    if ((config.required || []).some(x => !artifacts.includes(x))) throw new Error('Required artifacts must be listed');
    mkdirSync(directory, {recursive: true});
    const temporary = mkdtempSync(resolve(directory, '.collect-'));
    const evidence = [];
    try {
        for (const name of artifacts) {
            try {
                const target = resolve(temporary, name);
                run('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `${host.target}:${host.workDir}/simulation/reports/workflows/${runId}/${name}`, target], {timeout: 30000});
                JSON.parse(readFileSync(target, 'utf8'));
                const destination = resolve(directory, name);
                if (existsSync(destination)) {
                    if (!readFileSync(destination).equals(readFileSync(target))) throw new Error('Existing evidence differs');
                } else {
                    copyFileSync(target, destination, constants.COPYFILE_EXCL);
                    chmodSync(destination, 0o600);
                }
                evidence.push({name, status: 'collected'});
            } catch { evidence.push({name, status: 'unavailable-or-conflicting'}); }
        }
        const failed = (config.required || []).some(name => !evidence.some(x => x.name === name && x.status === 'collected'));
        const result = {runId, status: failed ? 'failed' : 'collected', evidence};
        // Each collection gets its own index; repeated collection never overwrites evidence.
        writeFileSync(resolve(directory, `evidence-${temporary.split(sep).at(-1).slice(9)}.json`), JSON.stringify(result, null, 2), {flag: 'wx', mode: 0o600});
        return result;
    } finally { rmSync(temporary, {recursive: true, force: true}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [action, file, ...extra] = process.argv.slice(2);
        if (!['sync', 'collect'].includes(action) || !file || extra.length) throw new Error('Usage: worker.mjs sync|collect <worker.json>');
        const config = JSON.parse(readFileSync(file, 'utf8'));
        if (action === 'sync') syncWorker(config);
        else if (collectEvidence(config).status === 'failed') process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
