#!/usr/bin/env node
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, createReadStream, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function parseArguments(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--help') { result.help = true; continue; }
        const key = {'--environment': 'environment', '--site': 'site', '--output': 'output', '--root': 'root'}[argv[i]];
        if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
        result[key] = argv[++i];
    }
    return result;
}

function copyPublic(source, target) {
    if (lstatSync(source).isSymbolicLink()) throw new Error(`Symlink not allowed: ${source}`);
    if (lstatSync(source).isDirectory()) {
        mkdirSync(target, {recursive: true});
        for (const name of readdirSync(source)) {
            if (name.startsWith('.') || /secret|private|credential|\.pem$|\.key$/i.test(name)) continue;
            copyPublic(join(source, name), join(target, name));
        }
    } else cpSync(source, target);
}

async function checksums(root, relative = '') {
    const lines = [];
    for (const entry of readdirSync(join(root, relative), {withFileTypes: true})) {
        const name = join(relative, entry.name);
        if (entry.isDirectory()) lines.push(...await checksums(root, name));
        else {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(join(root, name))) hash.update(chunk);
            lines.push(`${hash.digest('hex')}  ${name}`);
        }
    }
    return lines;
}

export function writePublishScript(destination) {
    writeFileSync(join(destination, 'publish.sh'), `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
action="\${1:-all}"
registry="\${2:-\${REGISTRY:-}}"
case "$action" in
  load|push|all) ;;
  *) echo 'Usage: bash publish.sh load | push <registry> | all <registry>' >&2; exit 1 ;;
esac
if [[ "$action" != load ]]; then
  if [[ -z "$registry" || "$registry" == *'/'* || "$registry" == *'<'* || "$registry" == *[[:space:]]* || "$registry" == -* ]]; then
    echo 'Specify a Registry host[:port], without scheme or namespace.' >&2
    exit 1
  fi
fi
sha256sum -c SHA256SUMS
if [[ "$action" != push ]]; then
  shopt -s nullglob
  archives=(images/*.tar)
  (( \${#archives[@]} > 0 )) || { echo 'No image archives found.' >&2; exit 1; }
  for archive in "\${archives[@]}"; do
    echo "[publish] load $archive"
    docker load -i "$archive"
  done
fi
if [[ "$action" != load ]]; then
  [[ -s publish.tsv ]] || { echo 'publish.tsv is empty or missing.' >&2; exit 1; }
  # Check every source before publishing any image.
  while IFS=$'\\t' read -r source target; do
    [[ -n "$source" && "$target" == '<REGISTRY>/'* ]] || { echo 'Invalid publish.tsv row.' >&2; exit 1; }
    docker image inspect "$source" >/dev/null
  done < publish.tsv
  while IFS=$'\\t' read -r source target; do
    target="$registry/\${target#<REGISTRY>/}"
    echo "[publish] $source -> $target"
    docker tag "$source" "$target"
    docker push "$target"
  done < publish.tsv
fi
echo "[publish] $action complete"
`, {mode: 0o755});
}

export function writePublishPlan(destination) {
    const images = new Set();
    const directory = join(destination, 'images');
    for (const archive of readdirSync(directory).filter(name => name.endsWith('.tar')).sort()) {
        const file = join(directory, archive);
        const manifest = file + '.manifest.json';
        const names = existsSync(manifest)
            ? JSON.parse(readFileSync(manifest, 'utf8')).images?.map(image => image.name)
            : JSON.parse(execFileSync('tar', ['-xOf', file, 'manifest.json'], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024})).flatMap(entry => entry.RepoTags ?? []);
        if (!names?.length) throw new Error(`No image names found in ${archive}`);
        for (const name of names) {
            if (typeof name !== 'string' || /\s/.test(name) || !name) throw new Error(`Invalid image name in ${archive}`);
            images.add(name);
        }
    }
    const targets = new Map();
    const rows = [...images].sort().map(source => {
        const parts = source.split('/');
        if (parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === 'localhost')) parts.shift();
        const repository = parts.length === 1 ? 'library/' + parts[0] : parts.join('/');
        if (targets.has(repository) && targets.get(repository) !== source) throw new Error(`Registry target collision: ${repository}`);
        targets.set(repository, source);
        return source + '\t' + '<REGISTRY>/' + repository;
    });
    writeFileSync(join(destination, 'publish.tsv'), rows.join('\n') + '\n');
}

async function mergeDelivery(source, target) {
    if (existsSync(target) && (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory())) {
        throw new Error(`Delivery target must be a directory: ${target}`);
    }
    mkdirSync(target, {recursive: true});
    for (const entry of readdirSync(source, {withFileTypes: true})) {
        const from = join(source, entry.name);
        const to = join(target, entry.name);
        if (entry.isDirectory()) {
            await mergeDelivery(from, to);
            continue;
        }
        if (existsSync(to)) {
            if (lstatSync(to).isSymbolicLink() || !lstatSync(to).isFile()) throw new Error(`Invalid delivery file: ${to}`);
            if (lstatSync(from).size === lstatSync(to).size) {
                const digest = async file => {
                    const hash = createHash('sha256');
                    for await (const chunk of createReadStream(file)) hash.update(chunk);
                    return hash.digest('hex');
                };
                if (await digest(from) === await digest(to)) continue;
            }
        }
        cpSync(from, to);
    }
}

export async function packageCompose(options, extend = async () => {}) {
    const root = resolve(options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
    const env = options.environment;
    if (!/^[a-zA-Z0-9_-]+$/.test(env ?? '')) throw new Error('Specify --environment.');
    const model = JSON.parse(readFileSync(join(root, 'operations/model', env, 'operations-model.json'), 'utf8'));
    const sites = model.networkTopology?.sites ?? [];
    const selected = options.site ? sites.filter(site => site.name === options.site) : sites;
    if (!selected.length) throw new Error('No matching deployment sites.');
    const output = resolve(options.output ?? join(root, 'operations/bundles/compose', env));
    mkdirSync(dirname(output), {recursive: true});
    const temp = mkdtempSync(join(dirname(output), '.compose-package-'));
    try {
        for (const site of selected) {
            if (!/^[a-zA-Z0-9_-]+$/.test(site.name)) throw new Error('Invalid site name.');
            const dest = join(temp, site.name);
            const source = join(root, 'operations/docker-compose', env, 'sites', site.name);
            mkdirSync(join(dest, 'images'), {recursive: true});
            for (const name of ['docker-compose.yml', '.env-example']) copyPublic(join(source, name), join(dest, name));
            for (const name of ['gateway', 'infrastructure']) if (existsSync(join(source, name))) copyPublic(join(source, name), join(dest, name));
            const archiveDir = join(root, 'operations/images', env, '.work/image-bundle/images');
            const prefix = site.name.replace(/_/g, '-').toLowerCase() + '-';
            const archives = readdirSync(archiveDir).filter(name => name.startsWith(prefix) && name.endsWith('.tar'));
            if (!archives.some(name => name.endsWith('dependency-images.tar')) || !archives.some(name => !name.endsWith('dependency-images.tar'))) throw new Error(`Export application and dependency archives for ${site.name} first.`);
            for (const name of archives) {
                copyPublic(join(archiveDir, name), join(dest, 'images', name));
                if (existsSync(join(archiveDir, name + '.manifest.json'))) copyPublic(join(archiveDir, name + '.manifest.json'), join(dest, 'images', name + '.manifest.json'));
            }
            await extend({root, site, destination: dest});
            writePublishPlan(dest);
            writePublishScript(dest);
            writeFileSync(join(dest, 'install.sh'), `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sha256sum -c SHA256SUMS
if [[ ! -f .env ]]; then
  cp .env-example .env
  chmod 600 .env
  echo 'Edit .env with real credentials, endpoints and image references, then run again.'
  exit 1
fi
compose=(docker compose --env-file .env -f docker-compose.yml)
[[ ! -f runtime.yml ]] || compose+=(-f runtime.yml)
"\${compose[@]}" config --quiet
for archive in images/*.tar; do docker load -i "$archive"; done
"\${compose[@]}" up -d --pull never --wait --wait-timeout 300
"\${compose[@]}" ps
`, {mode: 0o755});
            writeFileSync(join(dest, 'README.md'), `# Compose delivery: ${site.name}\n\nRequires Linux, Docker and Compose v2. Run bash install.sh; edit the created .env and rerun. No Node.js or source checkout is needed on the target. The installer loads existing archives, never builds or pulls. Keep image references identical to imported tags. Verify architecture and release manifests. Keep project name fixed; existing volumes are retained. Never use down -v for upgrades. Back up data before updates. Secret values must not be distributed in this package. Additional business settings may be documented in RUNTIME.md.\n`);
            writeFileSync(join(dest, 'SHA256SUMS'), (await checksums(dest)).join('\n') + '\n');
        }
        if (existsSync(output)) {
            await mergeDelivery(temp, output);
            rmSync(temp, {recursive: true, force: true});
        } else renameSync(temp, output);
        return output;
    } catch (error) { rmSync(temp, {recursive: true, force: true}); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const options = parseArguments(process.argv.slice(2));
        if (options.help) console.log('node operations/scripts/package-compose.mjs --environment <env> [--site <site>] [--output <new-directory>]');
        else console.log(await packageCompose(options));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
