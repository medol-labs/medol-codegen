const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {loadMedolWorkspace} = require('./medol-workspace');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const baselinePattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function modelMetadata(raw) {
    const metadata = raw.metadata;
    if (metadata === undefined) return undefined;
    if (metadata?.schemaVersion !== 1 || typeof metadata.medolVersion !== 'string'
        || !/^[a-f0-9]{64}$/.test(metadata.source?.sha256 ?? '')) {
        throw new Error('Invalid model metadata: expected schemaVersion 1, medolVersion and source.sha256.');
    }
    const source = {};
    for (const key of ['sha256', 'workspaceId', 'versionId', 'versionNo', 'modelHash']) {
        if (['string', 'number'].includes(typeof metadata.source[key])) source[key] = metadata.source[key];
    }
    const release = metadata.source.release;
    if (release !== undefined) {
        if (typeof release?.channel !== 'string' || (release.channel === 'stable' && !baselinePattern.test(release.label ?? ''))
            || (release.label !== undefined && !baselinePattern.test(release.label))) {
            throw new Error('Invalid model release: label must be strict vX.Y.Z.');
        }
        source.release = Object.fromEntries(['channel', 'label', 'releasedAt']
            .filter((key) => typeof release[key] === 'string').map((key) => [key, release[key]]));
    }
    return {schemaVersion: 1, medolVersion: metadata.medolVersion, source};
}

function sourcePathFor(modelPath) {
    return path.join(path.dirname(modelPath), 'source.medol');
}

function validateModelSource(raw, modelPath) {
    const metadata = modelMetadata(raw);
    const sourcePath = sourcePathFor(modelPath);
    if (metadata?.source.release?.channel === 'stable' && !fs.existsSync(sourcePath)) {
        throw new Error('Stable model release requires source.medol alongside the model input.');
    }
    if (metadata && fs.existsSync(sourcePath) && sha256(fs.readFileSync(sourcePath)) !== metadata.source.sha256) {
        throw new Error('source.medol SHA-256 does not match model metadata; export the model and source together.');
    }
    return metadata;
}

function generatorHash() {
    const root = path.resolve(__dirname, '../..');
    const hash = createHash('sha256');
    function walk(directory) {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
            if (['node_modules', '.git'].includes(entry.name)) continue;
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) hash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
        }
    }
    walk(root);
    return hash.digest('hex');
}

function generationRecord(cwd, outputRoot, target, options = {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('Invalid generation target.');
    const workspace = loadMedolWorkspace(cwd, options);
    const modelPath = fs.existsSync(workspace.codegenModelPath) ? workspace.codegenModelPath : path.join(cwd, 'config.json');
    const bytes = fs.readFileSync(modelPath);
    const metadata = validateModelSource(JSON.parse(bytes), modelPath);
    const sourcePath = sourcePathFor(modelPath);
    const inputPaths = new Set([modelPath, ...workspace.configPaths,
        ...(fs.existsSync(sourcePath) ? [sourcePath] : []),
        ...(workspace.translationsPath ? [workspace.translationsPath] : []),
        ...['.medol', '.'].flatMap((dir) => {
            const directory = path.resolve(cwd, dir);
            return fs.existsSync(directory) ? fs.readdirSync(directory)
                .filter((file) => /^(translations|model-translations(?:\..+)?)\.json$/.test(file))
                .map((file) => path.join(directory, file)) : [];
        }),
        ...['dictionary-init/dictionaries.json', 'operations.config.json']
            .map((file) => path.resolve(cwd, file)).filter((file) => fs.existsSync(file))]);
    const selection = {};
    for (const key of ['generatorType', 'frontendApp', 'frontendApplication', 'environment', 'allSlices', 'allCommands', 'sliceNames', 'slices', 'slice', 'contexts', 'context', 'sliceFilter', 'filter', 'commands']) {
        if (options[key] !== undefined) selection[key] = options[key];
    }
    for (const key of ['CODEGEN_DOMAIN', 'CODEGEN_DEPLOYMENT', 'CODEGEN_FRONTEND_APP']) {
        if (process.env[key]) selection[key] = process.env[key];
    }
    return {
        schemaVersion: 1, target, scope: options.scope ?? (String(options.generatorType).toLowerCase() === 'all' ? 'application' : 'partial'),
        selection, generatedAt: new Date().toISOString(),
        generator: {name: 'medol-codegen', version: require('../../package.json').version, sha256: generatorHash()},
        model: {sha256: sha256(bytes), ...(metadata ? {metadata} : {})},
        config: {sha256: sha256(JSON.stringify({config: workspace.config, selection}))},
        inputs: [...inputPaths].filter((file) => fs.existsSync(file)).map((file) => ({
            path: path.relative(outputRoot, file).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(file))
        }))
    };
}

function writeGenerationSupport(generator, target, options = {}) {
    const record = generationRecord(generator.env.cwd, generator.destinationRoot(), target, {...generator.opts, ...options});
    generator.fs.write(generator.destinationPath(`.medol/generation/${target}.json`), JSON.stringify(record, null, 2) + '\n');
    generator.fs.copy(path.resolve(__dirname, '../release-runtime.mjs'), generator.destinationPath('scripts/release-runtime.mjs'));
    generator.fs.copy(path.resolve(__dirname, '../image-archive-runtime.mjs'), generator.destinationPath('scripts/image-archive-runtime.mjs'));
    const label = record.model.metadata?.source.release?.label;
    const released = record.model.metadata?.source.release?.channel === 'stable';
    if (released && label) {
        // Only touch files queued by this generation pass, never existing extension files.
        generator.fs.store.each((file) => {
            if (!file.contents || !file.path.startsWith(generator.destinationRoot() + path.sep)) return;
            if (path.basename(file.path) === 'pom.xml') {
                generator.fs.write(file.path, file.contents.toString().replaceAll('<version>0.0.1-SNAPSHOT</version>', `<version>${label.slice(1)}</version>`));
            } else if (file.path === generator.destinationPath('package.json')) {
                const pkg = JSON.parse(file.contents.toString());
                pkg.version = label.slice(1);
                generator.fs.write(file.path, JSON.stringify(pkg, null, 2) + '\n');
            }
        });
    }
    return record;
}

module.exports = {sha256, modelMetadata, validateModelSource, generationRecord, writeGenerationSupport};
