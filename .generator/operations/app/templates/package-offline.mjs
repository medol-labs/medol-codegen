#!/usr/bin/env node
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, lstatSync, writeFileSync, createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

export function parseArguments(argv) {
    const result = {archives: [], components: []};
    const names = {'--environment': 'environment', '--site': 'site', '--image-source': 'imageSource', '--root': 'root', '--output': 'output', '--k3s-root': 'k3sRoot'};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--help') {result.help = true; continue;}
        if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
        if (key === '--archive') result.archives.push(argv[++i]);
        else if (key === '--component') result.components.push(argv[++i]);
        else if (names[key]) result[names[key]] = argv[++i];
        else throw new Error(`Unknown option: ${key}`);
    }
    return result;
}

function copyPublicTree(source, target) {
    cpSync(source, target, {recursive: true, dereference: false, filter: (file) => {
        if (lstatSync(file).isSymbolicLink()) throw new Error(`Symlinks are not allowed in deployment sources: ${file}`);
        if (statSync(file).isDirectory()) return !['.git', '.work'].includes(basename(file));
        return !/(?:secret|private|\.env)/i.test(basename(file));
    }});
}

function copyExampleFiles(source, target, relative = '') {
    if (!existsSync(source)) return;
    for (const entry of readdirSync(source, {withFileTypes: true})) {
        const childRelative = join(relative, entry.name);
        const childSource = join(source, entry.name);
        if (entry.isDirectory()) copyExampleFiles(childSource, target, childRelative);
        else if (/\.example\.ya?ml$/i.test(entry.name)) {
            const childTarget = join(target, childRelative);
            mkdirSync(dirname(childTarget), {recursive: true});
            cpSync(childSource, childTarget);
        }
    }
}

function listFiles(root, relative = '') {
    if (!existsSync(root)) return [];
    return readdirSync(join(root, relative), {withFileTypes: true}).flatMap((entry) => {
        const child = join(relative, entry.name);
        return entry.isDirectory() ? listFiles(root, child) : [child];
    });
}

async function checksum(file) {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    return hash.digest('hex');
}

export async function packageOffline(options, render = (directory) => {
    const result = spawnSync('kubectl', ['kustomize', directory], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
    return result.stdout;
}) {
    const {environment} = options;
    if (!/^[a-zA-Z0-9_-]+$/.test(environment ?? '') || environment === 'local') throw new Error('Select a non-local --environment.');
    const imageSource = options.imageSource ?? 'import';
    if (!['import', 'registry'].includes(imageSource)) throw new Error('Select --image-source import or registry.');
    const root = resolve(options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
    const source = resolve(options.k3sRoot ?? join(root, 'operations/k3s'));
    const model = JSON.parse(readFileSync(join(root, 'operations/model', environment, 'operations-model.json'), 'utf8'));
    const sites = model.networkTopology?.sites ?? [];
    const site = options.site ? sites.find((candidate) => candidate.name === options.site) : undefined;
    if (options.site && !site) throw new Error(`Unknown deployment site: ${options.site}. Available: ${sites.map((candidate) => candidate.name).join(', ')}`);
    const output = resolve(options.output ?? join(root, 'operations/bundles', environment, options.site ?? 'all'));
    if (existsSync(output)) throw new Error(`Output exists; choose a new directory: ${output}`);
    const archives = (options.archives ?? []).map((file) => resolve(file));
    if (imageSource === 'import' && !archives.length) throw new Error('Provide existing image tar files using repeated --archive.');
    if (imageSource === 'registry' && archives.length) throw new Error('Registry delivery does not accept image archives.');
    const names = new Set();
    for (const file of archives) {
        if (!statSync(file).isFile() || !/\.tar(?:\.gz)?$/.test(file)) throw new Error(`Expected image tar archive: ${file}`);
        if (names.has(basename(file))) throw new Error(`Duplicate archive filename: ${basename(file)}`);
        names.add(basename(file));
    }
    const temporary = mkdtempSync(join(tmpdir(), 'operations-offline-'));
    try {
        copyPublicTree(join(source, 'base'), join(temporary, 'base'));
        copyPublicTree(join(source, 'environments', environment), join(temporary, 'environments', environment));
        const deploymentEnvironment = imageSource === 'registry' ? `${environment}-registry` : environment;
        if (imageSource === 'registry') {
            const registryEnvironment = join(source, 'environments', deploymentEnvironment);
            if (!existsSync(registryEnvironment)) throw new Error(`Prepare the Registry overlay first: ${registryEnvironment}`);
            copyPublicTree(registryEnvironment, join(temporary, 'environments', deploymentEnvironment));
        }
        const components = [];
        for (const [index, component] of (options.components ?? []).entries()) {
            const relative = `components/component-${index}`;
            copyPublicTree(resolve(component), join(temporary, relative));
            components.push(relative);
        }
        const deploymentResource = site
            ? `environments/${deploymentEnvironment}/sites/${site.name}`
            : `environments/${deploymentEnvironment}`;
        if (!existsSync(join(temporary, deploymentResource, 'kustomization.yaml'))) {
            throw new Error(`Generated deployment site is missing: ${deploymentResource}`);
        }
        const kustomization = {apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization', resources: [deploymentResource], components};
        writeFileSync(join(temporary, 'kustomization.yaml'), JSON.stringify(kustomization));
        const yaml = render(temporary);
        if (/^kind:\s*["']?Secret["']?\s*$/m.test(yaml)) throw new Error('Rendered manifests contain a Secret; deliver credentials separately.');
        mkdirSync(join(output, 'manifests'), {recursive: true});
        writeFileSync(join(output, 'manifests/deployment.yaml'), yaml);
        const exampleSource = site
            ? join(source, 'environments', environment, 'sites', site.name)
            : join(source, 'environments', environment);
        copyExampleFiles(exampleSource, join(output, 'config'));
        if (imageSource === 'import') {
            mkdirSync(join(output, 'images'));
            for (const file of archives) {
                cpSync(file, join(output, 'images', basename(file)));
                if (existsSync(`${file}.manifest.json`)) cpSync(`${file}.manifest.json`, join(output, 'images', `${basename(file)}.manifest.json`));
            }
        }
        const imageInstructions = imageSource === 'import'
            ? `Import each archive only on nodes eligible to run this site's workloads: sudo k3s ctr images import images/<archive.tar>\n`
            : 'No image archives are included. Verify every eligible node can authenticate to and pull from the configured Registry.\n';
        writeFileSync(join(output, 'README.txt'), `Deployment: ${environment}\nImage source: ${imageSource}\nDeployment site: ${site?.name ?? 'all'}\nApplications: ${(site?.applications ?? model.applications.map((application) => application.name)).join(', ')}\nVerify: sha256sum -c SHA256SUMS\n${imageInstructions}Use config/*.example.yaml as templates and prepare real Secrets separately through a secure channel.\nApply real Secrets first, then apply: kubectl apply -f manifests/deployment.yaml\nNo source checkout, Node.js, Docker build, or Kustomize assembly is required on the target.\nK3s installation files and datasets are separate inputs. Match image names/tags and CPU architecture on every eligible node.\n`);
        const files = listFiles(output).filter((file) => file !== 'SHA256SUMS');
        const sums = [];
        for (const file of files.sort()) sums.push(`${await checksum(join(output, file))}  ${file}`);
        writeFileSync(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
        return output;
    } catch (error) {
        if (existsSync(output)) rmSync(output, {recursive: true});
        throw error;
    } finally {
        rmSync(temporary, {recursive: true});
    }
}

export async function packageOfflineAll(options, render) {
    if (options.site) return [await packageOffline(options, render)];
    const root = resolve(options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
    const model = JSON.parse(readFileSync(join(root, 'operations/model', options.environment, 'operations-model.json'), 'utf8'));
    const sites = model.networkTopology?.sites ?? [];
    if (sites.length <= 1) return [await packageOffline({...options, site: sites[0]?.name}, render)];
    const imageSource = options.imageSource ?? 'import';
    const archives = (options.archives ?? []).map((file) => resolve(file));
    const outputRoot = resolve(options.output ?? join(root, 'operations/bundles', options.environment));
    const outputs = [];
    for (const site of sites) {
        const prefix = `${String(site.name).trim().toLowerCase().replace(/_/g, '-')}-`;
        const selected = imageSource === 'registry' ? [] : archives.filter((file) => basename(file).startsWith(prefix));
        if (imageSource === 'import' && !selected.length) throw new Error(`No site-prefixed image archives were supplied for ${site.name}.`);
        outputs.push(await packageOffline({...options, site: site.name, archives: selected, output: join(outputRoot, site.name)}, render));
    }
    return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const options = parseArguments(process.argv.slice(2));
        if (options.help) console.log('node operations/scripts/package-offline.mjs --environment <name> [--site <network-topology-site>] [--image-source import|registry] [--archive <image.tar> ...] [--component <directory>] [--output <new-directory>] [--root <project>] [--k3s-root <directory>]');
        else for (const output of await packageOfflineAll(options)) console.log(`Offline package: ${output}`);
    } catch (error) {console.error(error.message); process.exitCode = 1;}
}
