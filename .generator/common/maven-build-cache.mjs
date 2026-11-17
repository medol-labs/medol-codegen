import {existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {resolve, dirname, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const embedded = path => path.endsWith('/META-INF/medol-build.json');
const excluded = new Set(['target', '.git', '.medol', 'node_modules', '.work', 'dist']);
function files(root, accept, skip = () => false) {
    const result = [];
    function walk(dir) {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = resolve(dir, entry.name), name = relative(root, path).replaceAll('\\', '/');
            if (skip(name, entry)) continue;
            if (entry.isDirectory()) walk(path);
            else if (entry.isSymbolicLink()) throw new Error('Build cache does not support symlink inputs: ' + path);
            else if (entry.isFile() && accept(name)) result.push([name, createHash('sha256').update(readFileSync(path)).digest('hex')]);
        }
    }
    walk(root);
    return result;
}
function read(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } }
function write(path, value) {
    mkdirSync(dirname(path), {recursive: true});
    const temp = path + '.' + process.pid + '.tmp';
    writeFileSync(temp, JSON.stringify(value, null, 2), {mode: 0o600});
    renameSync(temp, path);
}

// Repository metadata is deliberately conservative: local dependency installs
// invalidate reuse. Remote SNAPSHOT/tag updates require --force-build.
function repositoryState(root) {
    const entries = [];
    function walk(dir) {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = resolve(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.isFile() && /\.(jar|pom|xml)$/.test(entry.name)) {
                const info = statSync(path);
                entries.push([relative(root, path), info.size, info.mtimeMs, info.ctimeMs]);
            }
        }
    }
    walk(root);
    return digest(entries);
}

export function createMavenBuildCache({root, modules, toolchain, options = [], env = process.env,
    repository = resolve(homedir(), '.m2/repository'), settingsRoot = resolve(homedir(), '.m2')}) {
    const directory = resolve(root, '.medol/build-cache');
    const selection = [...modules].sort();
    const recordPath = resolve(directory, 'compile-' + digest(selection) + '.json');
    // Unknown repository locations cannot be verified against the default cache.
    const standardRepository = () => {
        const configs = [resolve(settingsRoot, 'settings.xml'), resolve(root, '.mvn/maven.config'), resolve(root, '.mvn/jvm.config')];
        const text = configs.filter(existsSync).map(path => readFileSync(path, 'utf8')).join('\n') + Object.entries(env).filter(([key]) => key.startsWith('MAVEN')).map(([, value]) => value).join('\n');
        return !text.includes('localRepository') && !text.includes('maven.repo.local') && !/(?:^|\s)(?:-s|--settings|-gs|--global-settings)(?:\s|=)/.test(text);
    };
    const source = () => digest({version: 1, modules: selection, toolchain, options,
        environment: Object.fromEntries(Object.entries(env).filter(([key]) => /^(JAVA|JDK|MAVEN|_JAVA|PATH$|LANG$|TZ$|SOURCE_DATE_EPOCH$)/.test(key)).sort()),
        files: files(root, name => name === 'pom.xml' || name.endsWith('/pom.xml') || name.startsWith('.mvn/') || /^mvnw(?:\.cmd)?$/.test(name) || name.split('/').includes('src'),
            (name, entry) => entry.isDirectory() && excluded.has(entry.name) || embedded(name)),
        settings: ['settings.xml', 'toolchains.xml'].map(name => {
            const path = resolve(settingsRoot, name);
            return [name, existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null];
        })});
    const input = () => digest({source: source(), repository: repositoryState(repository)});
    const output = () => {
        if (selection.some(name => !existsSync(resolve(root, name, 'target/classes')))) return null;
        const result = [];
        function walk(dir) {
            for (const entry of readdirSync(dir, {withFileTypes: true})) {
                if (!entry.isDirectory()) continue;
                const path = resolve(dir, entry.name);
                if (entry.name === 'target') {
                    const artifacts = files(path, name => /^(classes|test-classes)\//.test(name) || /^[^/]+\.jar$/.test(name), name => embedded(name));
                    result.push([relative(root, path), artifacts]);
                } else if (!excluded.has(entry.name)) walk(path);
            }
        }
        walk(root);
        return digest(result.sort((a, b) => a[0].localeCompare(b[0])));
    };
    return {
        withLock(action) {
            mkdirSync(directory, {recursive: true});
            const lock = resolve(directory, 'build.lock');
            const fd = openSync(lock, 'wx', 0o600);
            try { writeFileSync(fd, String(process.pid)); return action(); }
            finally { closeSync(fd); unlinkSync(lock); }
        },
        source,
        valid() { const record = read(recordPath); return Boolean(standardRepository() && record && record.input === input() && record.output && record.output === output()); },
        record() {
            const artifacts = output();
            if (!artifacts) throw new Error('Compilation did not produce required module classes');
            write(recordPath, {input: input(), output: artifacts});
        },
        imageKey(parameters) { return digest({artifacts: output(), parameters}); },
        imageMatches(key, image) { return Boolean(image?.Id && read(resolve(directory, 'images', key + '.json'))?.id === image.Id); },
        recordImage(key, image) {
            if (!image?.Id) throw new Error('Built image was not found');
            write(resolve(directory, 'images', key + '.json'), {id: image.Id});
        }
    };
}
