const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const ejs = require('../../node_modules/ejs');

const generatorRoot = path.resolve(__dirname, '../../..');
const helperFile = path.join(generatorRoot, '.generator/common/image-archive-runtime.mjs');
const runtime = import(pathToFileURL(helperFile).href);

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medol-archive-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const archiveFile = path.join(root, 'images.tar');
    const id = 'sha256:' + 'a'.repeat(64);
    const buildIdentity = 'b'.repeat(64);
    const generation = {model: {sha256: 'd'.repeat(64), metadata: {source: {sha256: 'e'.repeat(64), release: {channel: 'stable', label: 'v1.2.3'}}}}, generator: {sha256: 'f'.repeat(64)}};
    const codeSha256 = 'c'.repeat(64);
    const labels = {
        'org.opencontainers.image.version': 'v1.2.3.7', 'tech.medol.build.identity': buildIdentity,
        'tech.medol.code.sha256': codeSha256, 'tech.medol.model.sha256': generation.model.sha256,
        'tech.medol.generator.sha256': generation.generator.sha256, 'tech.medol.source.sha256': generation.model.metadata.source.sha256
    };
    const manifest = {schemaVersion: 1, imageVersion: 'v1.2.3.7', buildIdentity, codeSha256, generation, images: [{name: 'test/app:v1.2.3.7', id}]};
    // A real small tar container; Docker behavior is mocked to avoid daemon/platform dependencies.
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify([{Config: 'config.json', RepoTags: [manifest.images[0].name], Layers: []}]));
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({config: {Labels: labels}}));
    const tar = spawnSync('tar', ['-cf', archiveFile, 'manifest.json', 'config.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(tar.status, 0, tar.stderr);
    const imageFile = path.join(root, 'docker-image.json');
    fs.writeFileSync(imageFile, JSON.stringify({Id: id, Config: {Labels: labels}}));
    const logFile = path.join(root, 'docker-calls.jsonl');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(logFile)},JSON.stringify(args)+'\\n');if(args[0]==='image')process.stdout.write(fs.readFileSync(${JSON.stringify(imageFile)}));else if(args[0]==='save')fs.copyFileSync(${JSON.stringify(archiveFile)},args[args.indexOf('-o')+1]);else if(args[0]!=='load')process.exit(1);\n`, {mode: 0o755});
    const oldPath = process.env.PATH;
    process.env.PATH = bin + path.delimiter + oldPath;
    t.after(() => { process.env.PATH = oldPath; });
    const calls = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return {root, archiveFile, imageFile, logFile, manifest, labels, calls};
}

test('streamed export sidecar verifies offline without source, records size, checksum and labels', async (t) => {
    const f = fixture(t);
    const {writeArchiveManifest, verifyArchiveManifest, verifyLoadedImages, archiveChecksum} = await runtime;
    const written = await writeArchiveManifest({...f});
    assert.deepEqual(written.archive, await archiveChecksum(f.archiveFile));
    assert.equal(written.archive.size, fs.statSync(f.archiveFile).size);
    assert.deepEqual(written.images[0].labels, f.labels);
    const verified = await verifyArchiveManifest({archiveFile: f.archiveFile, expectedImages: f.manifest.images.map((image) => image.name), imageVersion: 'v1.2.3.7'});
    assert.deepEqual(verified, written);
    verifyLoadedImages({manifest: verified, root: f.root});
    assert.equal(fs.existsSync(path.join(f.root, '.medol')), false);
});

test('missing, directory and symlink sidecars fail with explicit legacy guidance; dry-run may plan', async (t) => {
    const f = fixture(t);
    const {verifyArchiveManifest} = await runtime;
    const options = {archiveFile: f.archiveFile};
    await assert.rejects(verifyArchiveManifest(options), /regular file.*direct legacy docker load/);
    fs.mkdirSync(`${f.archiveFile}.manifest.json`);
    await assert.rejects(verifyArchiveManifest(options), /regular file/);
    fs.rmdirSync(`${f.archiveFile}.manifest.json`);
    fs.symlinkSync(f.imageFile, `${f.archiveFile}.manifest.json`);
    await assert.rejects(verifyArchiveManifest(options), /regular file/);
    assert.equal(await verifyArchiveManifest({...options, dryRun: true}), undefined);
    assert.deepEqual(f.calls(), []);
});

test('same-size byte tampering and incorrect size fail checksum verification', async (t) => {
    const f = fixture(t);
    const {writeArchiveManifest, verifyArchiveManifest} = await runtime;
    const written = await writeArchiveManifest({...f});
    const original = fs.readFileSync(f.archiveFile);
    const changed = Buffer.from(original);
    changed[512] ^= 1;
    fs.writeFileSync(f.archiveFile, changed);
    await assert.rejects(verifyArchiveManifest(f), /checksum or size mismatch/);
    fs.writeFileSync(f.archiveFile, original);
    fs.writeFileSync(`${f.archiveFile}.manifest.json`, JSON.stringify({...written, archive: {...written.archive, size: written.archive.size + 1}}));
    await assert.rejects(verifyArchiveManifest(f), /checksum or size mismatch/);
    assert.equal(f.calls().some((args) => args[0] === 'load'), false);
});

test('loaded image IDs and provenance labels must match archive identities', async (t) => {
    const f = fixture(t);
    const {writeArchiveManifest, verifyLoadedImages, verifyArchiveManifest} = await runtime;
    const manifest = await writeArchiveManifest({...f});
    fs.writeFileSync(f.imageFile, JSON.stringify({Id: 'sha256:' + 'c'.repeat(64), Config: {Labels: f.labels}}));
    assert.throws(() => verifyLoadedImages({manifest, root: f.root}), /image ID mismatch/);
    fs.writeFileSync(f.imageFile, JSON.stringify({Id: f.manifest.images[0].id, Config: {Labels: {...f.labels, 'tech.medol.build.identity': 'wrong'}}}));
    assert.throws(() => verifyLoadedImages({manifest, root: f.root}), /image label mismatch/);
    await assert.rejects(verifyArchiveManifest({...f, imageVersion: 'v1.2.3.8'}), /version mismatch/);
    await assert.rejects(verifyArchiveManifest({...f, expectedImages: ['wrong/image:tag']}), /image names mismatch/);
    manifest.images[0].labels['tech.medol.build.identity'] = 'wrong';
    fs.writeFileSync(`${f.archiveFile}.manifest.json`, JSON.stringify(manifest));
    await assert.rejects(verifyArchiveManifest(f), /sidecar provenance label mismatch/);
});

test('stable sidecars cannot silently contradict their recorded model release', async (t) => {
    const f = fixture(t);
    const {writeArchiveManifest, verifyArchiveManifest} = await runtime;
    const manifest = await writeArchiveManifest({...f});
    manifest.generation = {model: {sha256: 'd'.repeat(64), metadata: {source: {sha256: 'e'.repeat(64), release: {channel: 'stable', label: 'v9.9.9'}}}}, generator: {sha256: 'f'.repeat(64)}};
    fs.writeFileSync(`${f.archiveFile}.manifest.json`, JSON.stringify(manifest));
    await assert.rejects(verifyArchiveManifest(f), /stable release version mismatch/);
});

for (const target of ['axon5', 'refine', 'engine']) {
    test(`${target} import checks bytes before load and loaded identities afterward with no source tree`, async (t) => {
        const f = fixture(t);
        const {writeArchiveManifest} = await runtime;
        await writeArchiveManifest({...f});
        const scriptRoot = path.join(f.root, 'offline');
        fs.mkdirSync(path.join(scriptRoot, 'scripts'), {recursive: true});
        fs.copyFileSync(helperFile, path.join(scriptRoot, 'scripts/image-archive-runtime.mjs'));
        fs.copyFileSync(path.join(generatorRoot, '.generator/common/release-runtime.mjs'), path.join(scriptRoot, 'scripts/release-runtime.mjs'));
        const template = target === 'engine'
            ? path.resolve(generatorRoot, '../federation-learning/federation-learning-runtime-engine/scripts/image-bundle.mjs')
            : path.join(generatorRoot, '.generator', target, 'app/templates', target === 'axon5' ? 'image-bundle.mjs.tpl' : 'root/scripts/image-bundle.mjs');
        fs.writeFileSync(path.join(scriptRoot, 'scripts/image-bundle.mjs'), ejs.render(fs.readFileSync(template, 'utf8'), {imageModules: ['test-app'], imageName: 'test-app', imageTarName: 'images.tar'}));
        const run = (...extra) => spawnSync(process.execPath, ['scripts/image-bundle.mjs', 'import', '--file', f.archiveFile, ...extra], {cwd: scriptRoot, encoding: 'utf8'});
        let result = run();
        assert.equal(result.status, 0, result.stderr);
        assert.equal(f.calls().filter((args) => args[0] === 'load').length, 1);
        fs.writeFileSync(f.imageFile, JSON.stringify({Id: 'sha256:' + 'c'.repeat(64), Config: {Labels: f.labels}}));
        result = run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Loaded archive image ID mismatch/);
        fs.writeFileSync(f.imageFile, JSON.stringify({Id: f.manifest.images[0].id, Config: {Labels: {...f.labels, 'tech.medol.source.sha256': 'wrong'}}}));
        result = run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Loaded archive image label mismatch/);
        fs.writeFileSync(f.imageFile, JSON.stringify({Id: f.manifest.images[0].id, Config: {Labels: f.labels}}));
        fs.writeFileSync(f.logFile, '');
        const bytes = fs.readFileSync(f.archiveFile);
        bytes[100] ^= 1;
        fs.writeFileSync(f.archiveFile, bytes);
        result = run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /checksum or size mismatch/);
        assert.deepEqual(f.calls(), []);
        fs.unlinkSync(`${f.archiveFile}.manifest.json`);
        result = run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /direct legacy docker load/);
        assert.deepEqual(f.calls(), []);
        result = run('--dry-run');
        assert.equal(result.status, 0, result.stderr);
        // Isolate export orchestration from the separately-tested release identity builder.
        fs.writeFileSync(path.join(scriptRoot, 'scripts/release-runtime.mjs'), `
            const manifest = ${JSON.stringify(f.manifest)};
            export const defaultImageVersion = () => 'v1.2.3.7';
            export const prepareRelease = () => ({
                labels: ${JSON.stringify(f.labels)},
                verifyImages() {},
                writeManifest(file, names) {
                    return {...manifest, images: names.map(name => ({...manifest.images[0], name}))};
                }
            });
        `);
        const exported = path.join(f.root, `${target}-export.tar`);
        result = spawnSync(process.execPath, ['scripts/image-bundle.mjs', 'export', '--output', exported], {cwd: scriptRoot, encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
        const {verifyArchiveManifest} = await runtime;
        const exportedManifest = await verifyArchiveManifest({archiveFile: exported});
        assert.equal(exportedManifest.imageVersion, 'v1.2.3.7');
        assert.equal(exportedManifest.images[0].id, f.manifest.images[0].id);
    });
}
