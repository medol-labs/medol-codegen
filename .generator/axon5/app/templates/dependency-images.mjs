#!/usr/bin/env node

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'help';
const root = resolve(process.cwd(), args.root ?? '.');
const platform = String(args.platform ?? process.env.DOCKER_DEFAULT_PLATFORM ?? 'linux/amd64');
const tarFile = resolve(root, args.output ?? args.file ?? process.env.DEPENDENCY_IMAGE_TAR ?? 'dependency-images.tar');
const dryRun = Boolean(args['dry-run']);
const includeApps = Boolean(args['include-apps']);

switch (command) {
    case 'list':
        printPlan();
        break;
    case 'pull':
        pullImages();
        break;
    case 'export':
        exportImages();
        break;
    case 'all':
        pullImages();
        exportImages();
        break;
    default:
        printUsage();
        process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}

function printPlan() {
    const images = dependencyImages();
    console.log(`[dependency-images] platform: ${platform}`);
    console.log(`[dependency-images] archive: ${tarFile}`);
    console.log('[dependency-images] images:');
    for (const image of images) {
        console.log(`  - ${image}`);
    }
}

function pullImages() {
    for (const image of dependencyImages()) {
        run('docker', ['pull', '--platform', platform, image]);
    }
}

function exportImages() {
    const images = dependencyImages();
    if (images.length === 0) {
        fail('No dependency images were found.');
    }
    run('docker', ['save', ...images, '-o', tarFile]);
}

function dependencyImages() {
    const configured = valuesOf(args.image)
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean);
    if (configured.length > 0) {
        return unique(configured);
    }

    const composeFiles = valuesOf(args.compose)
        .flatMap((value) => String(value).split(','))
        .map((value) => resolve(root, value.trim()))
        .filter(Boolean);
    const files = composeFiles.length > 0 ? composeFiles : discoverComposeFiles(root);
    const images = files.flatMap((file) => readComposeImages(file));
    return unique(images.filter((image) => includeApps || !isGeneratedApplicationImage(image)));
}

function discoverComposeFiles(directory) {
    if (!existsSync(directory)) {
        return [];
    }
    const result = [];
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'build' || entry.name === 'dist') {
            continue;
        }
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            result.push(...discoverComposeFiles(entryPath));
        } else if (isComposeFile(entry.name)) {
            result.push(entryPath);
        }
    }
    return unique(result).sort();
}

function isComposeFile(fileName) {
    if (fileName === 'docker-compose.yml' || fileName === 'docker-compose.yaml') return true;
    return /^docker-compose-.+\.ya?ml$/.test(fileName);
}

function readComposeImages(filePath) {
    if (!existsSync(filePath)) {
        fail(`Compose file was not found: ${filePath}`);
    }
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
    return lines
        .map((line) => line.match(/^\s*image:\s*(.+?)\s*$/)?.[1])
        .filter(Boolean)
        .map((value) => resolveImageReference(value))
        .filter(Boolean);
}

function resolveImageReference(value) {
    const trimmed = String(value).trim().replace(/^['"]|['"]$/g, '');
    const envDefault = trimmed.match(/^\$\{[^:}]+:-(.+)\}$/);
    return envDefault ? envDefault[1] : trimmed;
}

function isGeneratedApplicationImage(image) {
    return image.startsWith('medol/') || image.includes('${APP_IMAGE') || image.includes('_IMAGE:-medol/');
}

function unique(values) {
    return Array.from(new Set(values));
}

function run(commandName, commandArgs) {
    console.log(`[dependency-images] ${commandName} ${commandArgs.join(' ')}`);
    if (dryRun) return;
    const result = spawnSync(commandName, commandArgs, {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function valuesOf(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
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
  node scripts/dependency-images.mjs list [options]
  node scripts/dependency-images.mjs pull [options]
  node scripts/dependency-images.mjs export [options]
  node scripts/dependency-images.mjs all [options]

Wrappers:
  node scripts/pull-dependency-images.mjs
  node scripts/export-dependency-images.mjs

Options:
  --platform <os/arch>       Target CPU architecture. Defaults to DOCKER_DEFAULT_PLATFORM or linux/amd64.
  --output <file>            Docker archive path. Defaults to DEPENDENCY_IMAGE_TAR or dependency-images.tar.
  --compose <file[,file]>    Limit discovery to one or more compose files.
  --image <image[,image]>    Use explicit images instead of compose discovery.
  --include-apps             Include generated medol/* application images too.
  --root <dir>               Generated backend root. Defaults to current directory.
  --dry-run                  Print commands without running them.

Discovered compose files are named docker-compose.yml, docker-compose.yaml, or docker-compose-*.yml.`);
}

function fail(message) {
    console.error(`[dependency-images] ${message}`);
    process.exit(1);
}
