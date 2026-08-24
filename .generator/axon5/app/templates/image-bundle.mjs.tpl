#!/usr/bin/env node

import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const defaultModules = <%- JSON.stringify(imageModules, null, 4) %>;
const defaultTar = '<%= imageTarName %>';
const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'help';
const root = resolve(process.cwd(), args.root ?? '.');
const modules = selectedModules(defaultModules, args.module);
const imagePrefix = String(args.prefix ?? process.env.DOCKER_IMAGE_PREFIX ?? 'medol').replace(/\/+$/, '');
const imageVersion = String(args.version ?? process.env.IMAGE_VERSION ?? '0.0.1-SNAPSHOT');
const tarFile = resolve(root, args.output ?? args.file ?? process.env.IMAGE_TAR ?? defaultTar);
const dryRun = Boolean(args['dry-run']);

switch (command) {
    case 'build':
        buildImages();
        break;
    case 'export':
        exportImages();
        break;
    case 'import':
        importImages();
        break;
    case 'all':
        buildImages();
        exportImages();
        break;
    case 'list':
        printPlan();
        break;
    default:
        printUsage();
        process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
}

function buildImages() {
    ensureModules();
    ensureMavenWrapper();
    run('./mvnw', ['-pl', modules.join(','), '-am', '-DskipTests', 'jib:dockerBuild']);
}

function exportImages() {
    ensureModules();
    run('docker', ['save', ...imageNames(), '-o', tarFile]);
}

function importImages() {
    if (!existsSync(tarFile)) {
        fail(`Image archive was not found: ${tarFile}`);
    }
    run('docker', ['load', '-i', tarFile]);
}

function printPlan() {
    console.log('[images] modules:');
    for (const moduleName of modules) {
        console.log(`  - ${moduleName}`);
    }
    console.log('[images] image names:');
    for (const imageName of imageNames()) {
        console.log(`  - ${imageName}`);
    }
    console.log(`[images] archive: ${tarFile}`);
}

function run(commandName, commandArgs) {
    console.log(`[images] ${commandName} ${commandArgs.join(' ')}`);
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

function imageNames() {
    return modules.map((moduleName) => `${imagePrefix}/${moduleName}:${imageVersion}`);
}

function ensureModules() {
    if (modules.length === 0) {
        fail('No deployable image modules are configured.');
    }
}

function ensureMavenWrapper() {
    if (!existsSync(resolve(root, 'mvnw'))) {
        fail('Cannot find ./mvnw. Run this script from the generated backend root or pass --root.');
    }
}

function selectedModules(availableModules, moduleArg) {
    const selected = valuesOf(moduleArg)
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean);
    if (selected.length === 0) return availableModules;
    const unknown = selected.filter((moduleName) => !availableModules.includes(moduleName));
    if (unknown.length > 0) {
        fail(`Unknown module(s): ${unknown.join(', ')}. Available: ${availableModules.join(', ')}`);
    }
    return selected;
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
  node scripts/image-bundle.mjs build [options]
  node scripts/image-bundle.mjs export [options]
  node scripts/image-bundle.mjs import [options]
  node scripts/image-bundle.mjs all [options]
  node scripts/image-bundle.mjs list [options]

Wrappers:
  node scripts/build-images.mjs
  node scripts/export-images.mjs
  node scripts/import-images.mjs

Options:
  --module <name[,name]>   Limit to one or more generated deployment modules.
  --prefix <name>          Docker image prefix. Defaults to DOCKER_IMAGE_PREFIX or medol.
  --version <tag>          Image tag. Defaults to IMAGE_VERSION or 0.0.1-SNAPSHOT.
  --output <file>          Image archive path. Defaults to IMAGE_TAR or ${defaultTar}.
  --root <dir>             Generated backend root. Defaults to current directory.
  --dry-run                Print commands without running them.`);
}

function fail(message) {
    console.error(`[images] ${message}`);
    process.exit(1);
}
