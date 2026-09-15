#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const defaultModules = <%- JSON.stringify(imageModules, null, 4) %>;
const defaultTar = '<%= imageTarName %>';
const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'help';
const root = resolve(process.cwd(), args.root ?? '.');
loadDotEnv(resolve(root, '.env'));
const modules = selectedModules(defaultModules, args.module);
const imagePrefix = String(args.prefix ?? process.env.DOCKER_IMAGE_PREFIX ?? 'medol').replace(/\/+$/, '');
const imageVersion = String(args.version ?? process.env.IMAGE_VERSION ?? '0.0.1-SNAPSHOT');
const tarFile = resolve(root, args.output ?? args.file ?? process.env.IMAGE_TAR ?? defaultTar);
const dryRun = Boolean(args['dry-run']);
const jibGoal = 'com.google.cloud.tools:jib-maven-plugin:3.4.5:dockerBuild';
const platform = parsePlatform(args.platform ?? process.env.DOCKER_DEFAULT_PLATFORM ?? 'linux/amd64');
const skipInstall = flagEnabled(args['skip-install'], process.env.FAST_IMAGE_BUILD);
const offline = flagEnabled(args.offline, process.env.MAVEN_OFFLINE);

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
    case 'push':
        pushImages();
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
    if (!skipInstall) {
        run('./mvnw', [...mavenGlobalArgs(), '-pl', modules.join(','), '-am', '-DskipTests', 'install']);
    } else {
        console.log('[images] skipping Maven install; using already-built local reactor artifacts');
    }
    for (const moduleName of modules) {
        run('./mvnw', [
            ...mavenGlobalArgs(),
            '-pl', moduleName,
            '-DskipTests',
            `-Djib.to.image=${imageName(moduleName)}`,
            `-Djib.container.platform.os=${platform.os}`,
            `-Djib.container.platform.architecture=${platform.architecture}`,
            jibGoal
        ]);
    }
}

function exportImages() {
    ensureModules();
    run('docker', ['save', ...imageNames(), '-o', tarFile]);
}

function importImages() {
    if (!dryRun && !existsSync(tarFile)) {
        fail(`Image archive was not found: ${tarFile}`);
    }
    run('docker', ['load', '-i', tarFile]);
}

function pushImages() {
    ensureModules();
    for (const imageName of imageNames()) {
        run('docker', ['push', imageName]);
    }
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
    console.log(`[images] platform: ${platform.os}/${platform.architecture}`);
    console.log(`[images] Maven install: ${skipInstall ? 'skipped' : 'enabled'}`);
    console.log(`[images] Maven offline: ${offline ? 'enabled' : 'disabled'}`);
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

function mavenGlobalArgs() {
    return offline ? ['-o'] : [];
}

function imageNames() {
    return modules.map((moduleName) => imageName(moduleName));
}

function imageName(moduleName) {
    return `${imagePrefix}/${moduleName}:${imageVersion}`;
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

function truthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function flagEnabled(argValue, envValue) {
    if (argValue !== undefined) {
        return argValue === true || truthy(argValue);
    }
    return truthy(envValue);
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

function parsePlatform(value) {
    const normalized = String(value ?? '').trim();
    const [os, architecture, variant] = normalized.split('/');
    if (!os || !architecture || variant) {
        fail(`Invalid platform: ${normalized || '<empty>'}. Expected format like linux/amd64 or linux/arm64.`);
    }
    return {os, architecture};
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
  --module <name[,name]>   Limit to one or more generated deployment modules.
  --prefix <name>          Docker image prefix. Defaults to DOCKER_IMAGE_PREFIX or medol.
  --version <tag>          Image tag. Defaults to IMAGE_VERSION or 0.0.1-SNAPSHOT.
  --platform <os/arch>     Target CPU architecture. Defaults to DOCKER_DEFAULT_PLATFORM or linux/amd64.
  --skip-install           Skip the preliminary reactor install. Also enabled by FAST_IMAGE_BUILD=true.
  --offline                Run Maven with -o. Also enabled by MAVEN_OFFLINE=true.
  --output <file>          Image archive path. Defaults to IMAGE_TAR or ${defaultTar}.
  --root <dir>             Generated backend root. Defaults to current directory.
  --dry-run                Print commands without running them.`);
}

function fail(message) {
    console.error(`[images] ${message}`);
    process.exit(1);
}
