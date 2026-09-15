#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const defaultImageName = '<%= imageName %>';
const defaultTar = '<%= imageTarName %>';
const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'help';
const root = resolve(process.cwd(), args.root ?? '.');
loadDotEnv(resolve(root, '.env'));
const imagePrefix = String(args.prefix ?? process.env.DOCKER_IMAGE_PREFIX ?? 'medol').replace(/\/+$/, '');
const imageVersion = String(args.version ?? process.env.IMAGE_VERSION ?? '0.0.1-SNAPSHOT');
const imageName = String(args.image ?? process.env.IMAGE_NAME ?? defaultImageName);
const fullImageName = `${imagePrefix}/${imageName}:${imageVersion}`;
const tarFile = resolve(root, args.output ?? args.file ?? process.env.IMAGE_TAR ?? defaultTar);
const dryRun = Boolean(args['dry-run']);
const platform = String(args.platform ?? process.env.DOCKER_DEFAULT_PLATFORM ?? '').trim();

switch (command) {
    case 'build':
        buildImage();
        break;
    case 'export':
        exportImage();
        break;
    case 'import':
        importImage();
        break;
    case 'push':
        pushImage();
        break;
    case 'all':
        buildImage();
        exportImage();
        break;
    case 'list':
        printPlan();
        break;
    default:
        printUsage();
        process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}

function buildImage() {
    ensureDockerfile();
    run('docker', [
        'build',
        ...platformArgs(),
        ...cacheArgs(),
        ...buildArgs(),
        '-t',
        fullImageName,
        '.'
    ], {env: {...process.env, DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT ?? '1'}});
}

function exportImage() {
    run('docker', ['save', fullImageName, '-o', tarFile]);
}

function importImage() {
    if (!dryRun && !existsSync(tarFile)) {
        fail(`Image archive was not found: ${tarFile}`);
    }
    run('docker', ['load', '-i', tarFile]);
}

function pushImage() {
    run('docker', ['push', fullImageName]);
}

function printPlan() {
    console.log(`[images] image name: ${fullImageName}`);
    console.log(`[images] archive: ${tarFile}`);
    console.log(`[images] platform: ${platform || 'native'}`);
    const envArgs = buildArgs();
    if (envArgs.length > 0) {
        console.log(`[images] build args: ${envArgs.join(' ')}`);
    }
}

function buildArgs() {
    return valuesOf(args['build-arg']).flatMap((value) => ['--build-arg', String(value)]);
}

function platformArgs() {
    return platform ? ['--platform', platform] : [];
}

function cacheArgs() {
    if (flagEnabled(args['no-cache']) || flagEnabled(args['no-cache-from'])) {
        return flagEnabled(args['no-cache']) ? ['--no-cache'] : [];
    }
    if (dryRun || imageExists(fullImageName)) {
        return ['--cache-from', fullImageName];
    }
    return [];
}

function imageExists(name) {
    const result = spawnSync('docker', ['image', 'inspect', name], {
        cwd: root,
        stdio: 'ignore',
        shell: process.platform === 'win32'
    });
    return result.status === 0;
}

function run(commandName, commandArgs, options = {}) {
    console.log(`[images] ${commandName} ${commandArgs.join(' ')}`);
    if (dryRun) return;
    const result = spawnSync(commandName, commandArgs, {
        cwd: root,
        stdio: 'inherit',
        env: options.env ?? process.env,
        shell: process.platform === 'win32'
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function ensureDockerfile() {
    if (!existsSync(resolve(root, 'Dockerfile'))) {
        fail('Cannot find Dockerfile. Run this script from the generated frontend root or pass --root.');
    }
}

function valuesOf(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function loadDotEnv(path) {
    if (!existsSync(path)) return;
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const index = trimmed.indexOf('=');
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function truthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function flagEnabled(argValue, envValue) {
    if (argValue !== undefined) {
        return argValue === true || truthy(argValue);
    }
    return truthy(envValue);
}

function parseArgs(argv) {
    const result = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) {
            result._.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const next = argv[index + 1];
        const value = !next || next.startsWith('--') ? true : next;
        if (result[key] == null) {
            result[key] = value;
        } else if (Array.isArray(result[key])) {
            result[key].push(value);
        } else {
            result[key] = [result[key], value];
        }
        if (value !== true) index += 1;
    }
    return result;
}

function printUsage() {
    console.log(`Usage:
  node scripts/image-bundle.mjs build [options]
  node scripts/image-bundle.mjs export [options]
  node scripts/image-bundle.mjs import [options]
  node scripts/image-bundle.mjs push [options]
  node scripts/image-bundle.mjs all [options]
  node scripts/image-bundle.mjs list [options]

Wrappers:
  node scripts/build-images.mjs
  node scripts/export-images.mjs
  node scripts/import-images.mjs
  node scripts/push-images.mjs

Options:
  --image <name>             Docker image name. Defaults to IMAGE_NAME or ${defaultImageName}.
  --prefix <name>            Docker image prefix. Defaults to DOCKER_IMAGE_PREFIX or medol.
  --version <tag>            Image tag. Defaults to IMAGE_VERSION or 0.0.1-SNAPSHOT.
  --platform <os/arch>       Target CPU architecture. Defaults to DOCKER_DEFAULT_PLATFORM or native.
  --build-arg <key=value>    Forward a Docker build argument, for example VITE_AXON_API_URL.
  --no-cache                 Disable Docker layer cache.
  --no-cache-from            Do not seed the build cache from the existing local image.
  --output <file>            Image archive path. Defaults to IMAGE_TAR or ${defaultTar}.
  --root <dir>               Generated frontend root. Defaults to current directory.
  --dry-run                  Print commands without running them.`);
}

function fail(message) {
    console.error(`[images] ${message}`);
    process.exit(1);
}
