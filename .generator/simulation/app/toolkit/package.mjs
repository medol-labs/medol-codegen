import {cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const blockedDirs = new Set(['.git', '.work', 'reports', 'node_modules', 'target', 'build', 'dist', '.venv', 'volumes', 'instances', 'bundles']);
export function publicFile(file) {
    const parts = file.split('/');
    const name = parts.at(-1);
    return !parts.some(part => blockedDirs.has(part)) && !/private|kubeconfig/i.test(name)
        && !(/secret|credential/i.test(name) && !/\.(?:mjs|js|ts|md)$/.test(name))
        && !/^\.env(?:$|[.-])/.test(name) && name !== 'registries.yaml'
        && !/\.(?:pem|key|p12|pfx|tar|gz|zip|log|sqlite|db)$/.test(name);
}
const hash = data => createHash('sha256').update(data).digest('hex');
export function prepareContext(root, config, output) {
    root = realpathSync(root); output = resolve(output);
    let ancestor = output;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    output = resolve(realpathSync(ancestor), relative(ancestor, output));
    if (!['linux/amd64', 'linux/arm64'].includes(config.platform)) throw new Error('Explicit linux/amd64 or linux/arm64 platform required');
    if (!config.image || config.image.startsWith('-') || /\s/.test(config.image) || !config.image.includes(':') || config.image.endsWith(':latest')) throw new Error('Explicit versioned image reference required');
    if (!Array.isArray(config.inputs) || !config.inputs.length) throw new Error('Explicit public project inputs required');
    if (existsSync(output)) throw new Error('Output already exists; choose a new build directory');
    const files = new Map();
    function visit(file) {
        const rel = relative(root, file).split(sep).join('/');
        if (!rel || rel.startsWith('../') || rel === '..' || rel.startsWith('/')) throw new Error('Input escapes project');
        if (!publicFile(rel)) return;
        const stat = lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error('Symlink not allowed: ' + rel);
        if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(resolve(file, name));
        else if (stat.isFile()) files.set(rel, file);
    }
    for (const input of config.inputs) {
        if (typeof input !== 'string' || input.startsWith('/') || input.split('/').includes('..')) throw new Error('Inputs must be project-relative');
        const full = resolve(root, input);
        if (output === full || output.startsWith(full + sep)) throw new Error('Build output must be outside selected inputs');
        // Reject symlinked parents, even when a file rather than its directory is selected.
        if (realpathSync(full) !== full) throw new Error('Symlink not allowed: ' + input);
        visit(full);
    }
    // Required public credential policies contain no credential values, and must be
    // listed separately after review. Private state and secret files remain denied.
    for (const input of config.publicPolicies || []) {
        if (!/^[a-zA-Z0-9_./-]+\.json$/.test(input) || input.startsWith('/') || input.split('/').some(part => part === '..' || blockedDirs.has(part)) || /private|secret/i.test(input)) throw new Error('Invalid public policy path');
        const full = resolve(root, input);
        if (realpathSync(full) !== full || !lstatSync(full).isFile()) throw new Error('Policy must be a regular file');
        const policy = JSON.parse(readFileSync(full));
        function check(value) {
            if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
                if (/^(password|token|secret|privateKey|authorization|value)$/i.test(key) && typeof child === 'string' && child) throw new Error('Inline credential value in public policy');
                check(child);
            }
        }
        check(policy); files.set(input, full);
    }
    for (const required of ['simulation/src/task.mjs', 'simulation/src/prepare-environment.mjs']) if (!files.has(required)) throw new Error('Missing toolkit project input: ' + required);
    const hashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) => [name, hash(readFileSync(file))]));
    const manifest = {schemaVersion: 1, platform: config.platform, image: config.image, files: hashes, snapshotSha256: hash(JSON.stringify(hashes))};
    mkdirSync(resolve(output, 'project'), {recursive: true});
    for (const [name, file] of files) {
        const target = resolve(output, 'project', name); mkdirSync(dirname(target), {recursive: true}); cpSync(file, target);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    for (const name of ['Dockerfile', 'entrypoint.mjs', 'run.sh']) cpSync(resolve(here, name), resolve(output, name));
    writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [configFile, output, option] = process.argv.slice(2);
        if (!configFile || !output || (option && option !== '--build')) throw new Error('Usage: node simulation/toolkit/package.mjs <config.json> <new-directory> [--build]');
        const config = JSON.parse(readFileSync(configFile));
        const manifest = prepareContext(process.cwd(), config, output);
        if (option) {
            const run = args => { const r = spawnSync('docker', args, {stdio: 'inherit'}); if (r.error || r.status !== 0) throw new Error('Docker command failed: ' + args[0]); };
            run(['buildx', 'build', '--platform', config.platform, '--load', '-t', config.image, output]);
            run(['save', '-o', resolve(output, 'simulation-tool.tar'), config.image]);
            // Hash via a stream so large project fixtures do not exhaust memory.
            const {createReadStream} = await import('node:fs');
            const digest = createHash('sha256');
            for await (const chunk of createReadStream(resolve(output, 'simulation-tool.tar'))) digest.update(chunk);
            writeFileSync(resolve(output, 'image-reference.txt'), config.image + '\n');
            const lines = [digest.digest('hex') + '  simulation-tool.tar', ...['run.sh', 'manifest.json', 'image-reference.txt'].map(file => hash(readFileSync(resolve(output, file))) + '  ' + file)];
            writeFileSync(resolve(output, 'SHA256SUMS'), lines.join('\n') + '\n');
        }
        console.log(JSON.stringify({status: option ? 'exported' : 'prepared', output: resolve(output), image: manifest.image, platform: manifest.platform, fileCount: Object.keys(manifest.files).length, snapshotSha256: manifest.snapshotSha256}, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
