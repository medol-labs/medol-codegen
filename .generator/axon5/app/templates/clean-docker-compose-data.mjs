#!/usr/bin/env node

import {existsSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import readline from 'node:readline/promises';

const args = parseArgs(process.argv.slice(2));
const root = resolve(process.cwd(), args.root ?? '.');
const maxDepth = positiveInt(args.depth, 2);
const dryRun = Boolean(args['dry-run']);
const yes = Boolean(args.yes) || Boolean(args.y);
const includeRootExtras = Boolean(args['include-root-extras']);
const composeFiles = discoverComposeFiles(root, maxDepth, includeRootExtras);

if (composeFiles.length === 0) {
    console.log(`[clean-compose] No docker compose files found under ${root}`);
    process.exit(0);
}

console.log('[clean-compose] This will stop containers and remove compose-managed volumes for:');
for (const file of composeFiles) {
    console.log(`  - ${relative(root, file) || file}`);
}

if (dryRun) {
    console.log('[clean-compose] dry run complete');
    process.exit(0);
}

if (!yes) {
    const confirmed = await confirm('Continue? This deletes local development database/event-store volumes. Type "yes" to continue: ');
    if (!confirmed) {
        console.log('[clean-compose] cancelled');
        process.exit(0);
    }
}

let failed = 0;
for (const file of composeFiles) {
    const label = relative(root, file) || file;
    console.log(`[clean-compose] docker compose -f ${label} down -v --remove-orphans`);
    const result = spawnSync('docker', ['compose', '-f', file, 'down', '-v', '--remove-orphans'], {
        cwd: root,
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        failed += 1;
        console.warn(`[clean-compose] failed: ${label}`);
    }
}

if (failed > 0) {
    console.warn(`[clean-compose] completed with ${failed} failure(s)`);
    process.exitCode = 1;
} else {
    console.log('[clean-compose] all compose data cleaned');
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
        'dist',
        'node_modules',
        'target'
    ]).has(name);
}

async function confirm(question) {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    try {
        const answer = await rl.question(question);
        return answer.trim().toLowerCase() === 'yes';
    } finally {
        rl.close();
    }
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
        if (item === '-y') {
            result.y = true;
            continue;
        }
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
