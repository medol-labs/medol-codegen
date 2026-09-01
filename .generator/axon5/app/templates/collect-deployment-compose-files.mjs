#!/usr/bin/env node

import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = resolve(process.cwd(), args.root ?? '.');
const output = resolve(root, args.output ?? args.dir ?? 'deployment-compose-files');
const maxDepth = positiveInt(args.depth, 3);
const dryRun = Boolean(args['dry-run']);
const clean = Boolean(args.clean);
const includeRootExtras = args['include-root-extras'] !== false && args['include-root-extras'] !== 'false';
const composeFiles = discoverComposeFiles(root, maxDepth, includeRootExtras);

if (composeFiles.length === 0) {
    console.log(`[collect-compose] No docker compose files found under ${root}`);
    process.exit(0);
}

const files = collectFiles(composeFiles);
const manifest = {
    generatedAt: new Date().toISOString(),
    root,
    output,
    composeFiles: composeFiles.map((file) => relative(root, file)),
    files: files.map((file) => relative(root, file))
};

console.log(`[collect-compose] output: ${output}`);
console.log('[collect-compose] files:');
for (const file of files) {
    console.log(`  - ${relative(root, file)}`);
}

if (dryRun) {
    console.log('[collect-compose] dry run complete');
    process.exit(0);
}

if (clean && existsSync(output)) {
    rmSync(output, {recursive: true, force: true});
}
mkdirSync(output, {recursive: true});

for (const file of files) {
    const relativePath = relative(root, file);
    const target = join(output, relativePath);
    mkdirSync(dirname(target), {recursive: true});
    copyFileSync(file, target);
}

writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[collect-compose] copied ${files.length} file(s)`);

function collectFiles(files) {
    const result = new Set();
    for (const composeFile of files) {
        result.add(composeFile);
        for (const envFile of envExamplesFor(composeFile)) {
            result.add(envFile);
        }
    }
    return Array.from(result).sort((left, right) => left.localeCompare(right));
}

function envExamplesFor(composeFile) {
    const directory = dirname(composeFile);
    return [
        join(directory, '.env-example'),
        join(directory, 'env-example')
    ].filter((file) => existsSync(file) && statSync(file).isFile());
}

function discoverComposeFiles(start, depth, includeRootExtras) {
    const files = [];
    const visited = new Set();

    walk(start, 0);

    return files
        .filter((file, index, all) => all.indexOf(file) === index)
        .sort((left, right) => left.localeCompare(right));

    function walk(directory, level) {
        if (visited.has(directory) || level > depth) return;
        visited.add(directory);
        if (!existsSync(directory)) return;

        let entries;
        try {
            entries = readdirSync(directory, {withFileTypes: true});
        } catch {
            return;
        }

        const localComposeFiles = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => isComposeFileName(name, directory === start, includeRootExtras))
            .map((name) => join(directory, name));

        files.push(...localComposeFiles);

        for (const entry of entries) {
            if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
            walk(join(directory, entry.name), level + 1);
        }
    }
}

function isComposeFileName(name, isRoot, includeRootExtras) {
    if (name === 'docker-compose.yml' || name === 'docker-compose.yaml') return true;
    if (!isRoot || includeRootExtras) {
        return /^docker-compose-.+\.ya?ml$/.test(name);
    }
    return false;
}

function shouldSkipDirectory(name) {
    return new Set([
        '.git',
        '.mvn',
        '.agent',
        'build',
        'deployment-compose-files',
        'dist',
        'node_modules',
        'target'
    ]).has(name);
}

function positiveInt(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--')) continue;
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            result[key] = true;
            continue;
        }
        result[key] = next;
        index += 1;
    }
    return result;
}
