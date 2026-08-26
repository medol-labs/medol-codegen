#!/usr/bin/env node

import {existsSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {emitKeypressEvents} from 'node:readline';
import readline from 'node:readline/promises';

const args = parseArgs(process.argv.slice(2));
const root = resolve(process.cwd(), args.root ?? '.');
const maxDepth = positiveInt(args.depth, 2);
const dryRun = Boolean(args['dry-run']);
const yes = Boolean(args.yes) || Boolean(args.y);
const includeRootExtras = Boolean(args['include-root-extras']);
const allTargets = discoverComposeFiles(root, maxDepth, includeRootExtras)
    .map((file) => composeTarget(file, root));

if (allTargets.length === 0) {
    console.log(`[clean-compose] No docker compose files found under ${root}`);
    process.exit(0);
}

const targets = await selectTargetsWithCheckboxes(allTargets);

if (targets.length === 0) {
    console.log('[clean-compose] No docker compose targets selected');
    process.exit(0);
}

console.log('[clean-compose] This will stop containers and remove compose-managed volumes for:');
for (const target of targets) {
    console.log(`  - ${target.name} (${target.label})`);
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
for (const target of targets) {
    const {file, label} = target;
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

function composeTarget(file, start) {
    const label = relative(start, file) || file;
    const parts = label.split(/[\\/]/).filter(Boolean);
    const fileName = parts.at(-1) ?? file;
    const parentName = parts.length > 1 ? parts.at(-2) : start.split(/[\\/]/).filter(Boolean).at(-1);
    const composeName = fileName.replace(/\.ya?ml$/i, '');
    const name = /^docker-compose$/i.test(composeName) ? parentName : composeName.replace(/^docker-compose-?/i, '');
    return {
        file,
        label,
        name
    };
}

async function selectTargetsWithCheckboxes(allTargets) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error('[clean-compose] Interactive checkbox selection requires a TTY terminal.');
        process.exit(1);
    }

    return new Promise((resolveSelection) => {
        const selected = new Set(allTargets.map((target) => target.file));
        let cursor = 0;
        let renderedLines = 0;
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;

        emitKeypressEvents(stdin);
        if (stdin.setRawMode) stdin.setRawMode(true);
        stdin.resume();

        function render() {
            if (renderedLines > 0) {
                process.stdout.write(`\x1b[${renderedLines}F`);
                process.stdout.write('\x1b[J');
            }

            const lines = [
                '[clean-compose] Select services to clean:',
                '  Use Up/Down to move, Space to toggle, a to toggle all, Enter to confirm, q to cancel.',
                ...allTargets.map((target, index) => {
                    const pointer = index === cursor ? '>' : ' ';
                    const marker = selected.has(target.file) ? 'x' : ' ';
                    return `${pointer} [${marker}] ${target.name} (${target.label})`;
                }),
                `  Selected: ${selected.size}/${allTargets.length}`
            ];
            process.stdout.write(`${lines.join('\n')}\n`);
            renderedLines = lines.length;
        }

        function toggleCurrent() {
            const target = allTargets[cursor];
            if (selected.has(target.file)) {
                selected.delete(target.file);
            } else {
                selected.add(target.file);
            }
        }

        function toggleAll() {
            if (selected.size === allTargets.length) {
                selected.clear();
                return;
            }
            for (const target of allTargets) {
                selected.add(target.file);
            }
        }

        function selectedTargets() {
            return allTargets.filter((target) => selected.has(target.file));
        }

        function cleanup() {
            stdin.off('keypress', onKeypress);
            if (stdin.setRawMode) stdin.setRawMode(Boolean(wasRaw));
            stdin.pause();
        }

        function finish(selectedTargets) {
            cleanup();
            resolveSelection(selectedTargets);
        }

        function onKeypress(text, key = {}) {
            if (key.ctrl && key.name === 'c') {
                cleanup();
                process.stdout.write('\n');
                process.exit(130);
            }

            if (key.name === 'up') {
                cursor = (cursor - 1 + allTargets.length) % allTargets.length;
                render();
                return;
            }
            if (key.name === 'down') {
                cursor = (cursor + 1) % allTargets.length;
                render();
                return;
            }
            if (key.name === 'space' || text === ' ') {
                toggleCurrent();
                render();
                return;
            }
            if (key.name === 'return' || key.name === 'enter') {
                finish(selectedTargets());
                return;
            }
            if (key.name === 'escape' || text === 'q') {
                finish([]);
                return;
            }
            if (text === 'a') {
                toggleAll();
                render();
            }
        }

        render();
        stdin.on('keypress', onKeypress);
    });
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
    const answer = await ask(question);
    return answer.trim().toLowerCase() === 'yes';
}

async function ask(question) {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    try {
        return await rl.question(question);
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
