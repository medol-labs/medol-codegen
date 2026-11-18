import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export function initializeWorkspace(source, destination, manifest) {
    if (!existsSync(destination) || readdirSync(destination).length) throw new Error('init requires an existing EMPTY workspace; existing configuration and credentials are never overwritten');
    for (const [file, digest] of Object.entries(manifest.files)) {
        if (createHash('sha256').update(readFileSync(resolve(source, file))).digest('hex') !== digest) throw new Error('Embedded project checksum mismatch: ' + file);
    }
    cpSync(source, destination, {recursive: true, errorOnExist: true, force: false});
    writeFileSync(resolve(destination, '.simulation-toolkit.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}

export function commandFor(action, args) {
    const scripts = {environment: 'prepare-environment', registry: 'instance-registry', task: 'task', pipeline: 'pipeline', cases: 'cases', data: 'prepare-data'};
    if (action === 'exec' && args.length) return args;
    if (scripts[action] && args.length) return ['node', `simulation/src/${scripts[action]}.mjs`, ...args];
    throw new Error('Usage: init | info | environment <config> | registry <args> | task <tasks> <name> | pipeline plan|run <config> | cases <args> | data <args> | exec <command>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [action = 'info', ...args] = process.argv.slice(2);
        mkdirSync(process.env.HOME || '/tmp/simulation-home', {recursive: true});
        const manifest = JSON.parse(readFileSync('/opt/simulation-manifest.json', 'utf8'));
        if (action === 'info') console.log(JSON.stringify(manifest, null, 2));
        else if (action === 'init') initializeWorkspace('/opt/simulation-project', process.cwd(), manifest);
        else {
            if (!existsSync('.simulation-toolkit.json')) throw new Error('Initialize a dedicated workspace with this image before executing stages');
            const previous = JSON.parse(readFileSync('.simulation-toolkit.json', 'utf8'));
            if (previous.snapshotSha256 !== manifest.snapshotSha256) throw new Error('Workspace belongs to another toolkit snapshot; use its original image or initialize a new workspace');
            const [cmd, ...argv] = commandFor(action, args);
            const result = spawnSync(cmd, argv, {stdio: 'inherit'});
            if (result.error) throw result.error;
            process.exitCode = result.status ?? 1;
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
