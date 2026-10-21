const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {sha256, generationRecord, validateModelSource} = require('../core/generation-provenance');
const {syncReleaseSupport} = require('../../../sync-release-support');
const repo = path.resolve(__dirname, '../../..');
const runtime = import('../release-runtime.mjs');

function fixture(t, {stable = true, target = 'runtime-engine'} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medol-release-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const source = 'domain Test {}\r\n// exact source';
    const metadata = {schemaVersion: 1, medolVersion: '1.0.0', source: {
        sha256: sha256(source), workspaceId: 'workspace', ...(stable ? {release: {channel: 'stable', label: 'v1.2.3'}} : {})
    }};
    const model = {domain: 'Test', contexts: [], slices: [], metadata};
    fs.writeFileSync(path.join(root, 'codegen-model.json'), JSON.stringify(model));
    fs.writeFileSync(path.join(root, 'source.medol'), source);
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log("app");\n');
    const refresh = () => {
        const record = generationRecord(root, root, target, {generatorType: 'all', allSlices: true});
        fs.mkdirSync(path.join(root, '.medol/generation'), {recursive: true});
        fs.writeFileSync(path.join(root, '.medol/generation', target + '.json'), JSON.stringify(record));
        return record;
    };
    refresh();
    return {root, model, metadata, refresh, target};
}

test('strict stable metadata, exact source hashes, allowlisted selection and defaults', async (t) => {
    const {root, model, refresh, metadata, target} = fixture(t);
    const {defaultImageVersion, validateDeliveryVersion} = await runtime;
    assert.equal(defaultImageVersion({root, target}), 'v1.2.3.0');
    assert.equal(validateDeliveryVersion('v1.2.3.4', metadata).packageVersion, '1.2.3');
    for (const version of ['1.2.3.4', 'v1.2.4.0', 'v1.2.3.01', '0.0.1-SNAPSHOT']) {
        assert.throws(() => validateDeliveryVersion(version, metadata));
    }
    const record = refresh();
    assert.equal(record.scope, 'application');
    assert.equal(record.selection.allSlices, true);
    const invalid = structuredClone(model);
    delete invalid.metadata.source.release.label;
    assert.throws(() => validateModelSource(invalid, path.join(root, 'codegen-model.json')), /release/);
    fs.appendFileSync(path.join(root, 'source.medol'), '\n');
    assert.throws(refresh, /SHA-256/);
    fs.unlinkSync(path.join(root, 'source.medol'));
    assert.throws(refresh, /requires source.medol/);
});

test('draft and metadata-free legacy defaults remain compatible', async (t) => {
    const {root, target, metadata} = fixture(t, {stable: false});
    const {prepareRelease, defaultImageVersion, validateDeliveryVersion} = await runtime;
    assert.equal(defaultImageVersion({root, target}), '0.0.1-SNAPSHOT');
    assert.equal(prepareRelease({root, target, version: '0.0.1-SNAPSHOT'}).manifest.packageVersion, undefined);
    assert.throws(() => validateDeliveryVersion('v1.2.3.0', metadata), /stable/);
    assert.throws(() => validateDeliveryVersion('v1.2.3.01', metadata), /canonical/);
    assert.equal(validateDeliveryVersion('latest').imageVersion, 'latest');
});

test('artifact commands default to the last matching build instead of revision zero', async (t) => {
    const f = fixture(t);
    const {defaultImageVersion} = await runtime;
    const generation = JSON.parse(fs.readFileSync(path.join(f.root, '.medol/generation', f.target + '.json')));
    fs.writeFileSync(path.join(f.root, '.medol/build-manifest.json'), JSON.stringify({imageVersion: 'v1.2.3.7', generation}));
    for (const operation of ['export', 'push']) assert.equal(defaultImageVersion({root: f.root, target: f.target, operation}), 'v1.2.3.7');
    assert.equal(defaultImageVersion({root: f.root, target: f.target}), 'v1.2.3.0');
});

test('immutable identity excludes timestamps/build outputs, includes code/options/real app manifests', async (t) => {
    const f = fixture(t);
    const {prepareRelease} = await runtime;
    const options = {root: f.root, target: f.target, version: 'v1.2.3.0', buildOptions: {platform: 'linux/amd64'}};
    const first = prepareRelease(options);
    first.embed(['public/medol-build.json']);
    f.refresh();
    assert.equal(prepareRelease(options).manifest.buildIdentity, first.manifest.buildIdentity);
    assert.throws(() => prepareRelease({...options, buildOptions: {platform: 'linux/arm64'}}), /reserved/);
    assert.doesNotThrow(() => prepareRelease({...options, variant: 'gpu', buildOptions: {platform: 'linux/arm64'}}).claim());
    fs.writeFileSync(path.join(f.root, 'public/manifest.json'), '{"name":"changed"}');
    assert.throws(() => prepareRelease(options), /reserved/);
});

test('source baselines are pinned across fourth-part versions and stale inputs fail', async (t) => {
    const f = fixture(t);
    const {prepareRelease} = await runtime;
    const options = {root: f.root, target: f.target, version: 'v1.2.3.0'};
    prepareRelease(options).claim();
    fs.appendFileSync(path.join(f.root, 'codegen-model.json'), ' ');
    assert.throws(() => prepareRelease(options), /hash mismatch/);
    fs.writeFileSync(path.join(f.root, 'source.medol'), 'new source');
    f.model.metadata.source.sha256 = sha256('new source');
    fs.writeFileSync(path.join(f.root, 'codegen-model.json'), JSON.stringify(f.model));
    f.refresh();
    assert.throws(() => prepareRelease({...options, version: 'v1.2.3.1'}), /different source/);
});

test('export and push reuse build options while still rejecting changed source code', async (t) => {
    const f = fixture(t);
    const {prepareRelease} = await runtime;
    const options = {root: f.root, target: f.target, version: 'v1.2.3.0'};
    assert.throws(() => prepareRelease({...options, operation: 'export'}), /No matching build record/);
    const built = prepareRelease({...options, buildOptions: {platform: 'linux/arm64', buildArgs: ['ENDPOINT=example']}});
    built.embed(['public/medol-build.json']);
    for (const operation of ['export', 'push']) {
        const session = prepareRelease({...options, operation});
        assert.equal(session.manifest.buildIdentity, built.manifest.buildIdentity);
        assert.equal(session.manifest.buildOptionsSha256, built.manifest.buildOptionsSha256);
    }
    fs.appendFileSync(path.join(f.root, 'app.js'), '// changed\n');
    assert.throws(() => prepareRelease({...options, operation: 'push'}), /reserved/);
});

test('generationRoot is independent of build root; dry run never writes claims', async (t) => {
    const f = fixture(t, {target: 'operations'});
    const engine = path.join(f.root, 'engine');
    fs.mkdirSync(engine);
    const {prepareRelease} = await runtime;
    const release = prepareRelease({root: engine, generationRoot: f.root, target: 'operations', version: 'v1.2.3.0', dryRun: true});
    release.embed(['public/medol-build.json']);
    assert.equal(release.writeManifest('manifest.json', ['test/image:v1.2.3.0']).images.length, 1);
    assert.equal(fs.existsSync(path.join(engine, '.medol')), false);
});

test('root documentation revisions do not change the operations delivery identity', async (t) => {
    const f = fixture(t, {target: 'operations'});
    const {prepareRelease} = await runtime;
    const options = {root: f.root, target: f.target, version: 'v1.2.3.0'};
    const built = prepareRelease(options);
    built.claim();
    fs.mkdirSync(path.join(f.root, 'docs'));
    fs.writeFileSync(path.join(f.root, 'docs/manual.md'), 'Corrected wording');
    fs.writeFileSync(path.join(f.root, 'README.md'), 'Documentation only');
    assert.equal(prepareRelease({...options, operation: 'export'}).manifest.buildIdentity, built.manifest.buildIdentity);
});

test('image provenance, per-image immutable ledger, missing images and pushed digests', async (t) => {
    const f = fixture(t);
    const {prepareRelease} = await runtime;
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'medol-docker-'));
    t.after(() => fs.rmSync(bin, {recursive: true, force: true}));
    const fakeImage = path.join(bin, 'image.json');
    fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node\nconst fs=require('node:fs'); if(!fs.existsSync(${JSON.stringify(fakeImage)}))process.exit(1); process.stdout.write(fs.readFileSync(${JSON.stringify(fakeImage)}));\n`, {mode: 0o755});
    const previousPath = process.env.PATH;
    process.env.PATH = bin + path.delimiter + previousPath;
    t.after(() => { process.env.PATH = previousPath; });
    const release = prepareRelease({root: f.root, target: f.target, version: 'v1.2.3.0'});
    assert.throws(() => release.writeManifest(undefined, ['test/image:v1.2.3.0']), /Cannot inspect/);
    const image = {Id: 'sha256:one', Config: {Labels: release.labels}, RepoDigests: []};
    fs.writeFileSync(fakeImage, JSON.stringify(image));
    assert.equal(release.writeManifest(undefined, ['test/image:v1.2.3.0']).images[0].id, image.Id);
    assert.equal(release.writeManifest(undefined, ['test/second:v1.2.3.0']).images.length, 1);
    assert.throws(() => release.verifyImages(['test/image:v1.2.3.0'], {requireRepoDigests: true}), /repository digest/);
    image.RepoDigests = ['test/image@sha256:' + 'a'.repeat(64)];
    fs.writeFileSync(fakeImage, JSON.stringify(image));
    assert.doesNotThrow(() => release.verifyImages(['test/image:v1.2.3.0'], {requireRepoDigests: true}));
    image.Id = 'sha256:changed';
    fs.writeFileSync(fakeImage, JSON.stringify(image));
    assert.throws(() => release.verifyImages(['test/second:v1.2.3.0']), /Delivery image changed/);
    image.Id = 'sha256:one'; image.Config.Labels = {};
    fs.writeFileSync(fakeImage, JSON.stringify(image));
    assert.throws(() => release.verifyImages(['test/image:v1.2.3.0']), /label mismatch/);
});

test('fetch preserves exact source and leaves both outputs unchanged on source failure/mismatch', (t) => {
    const f = fixture(t);
    const preload = path.join(f.root, 'fetch.cjs');
    fs.writeFileSync(preload, `global.fetch=async(url)=>{const fs=require('node:fs');const root=${JSON.stringify(f.root)}; const model=JSON.parse(fs.readFileSync(root+'/codegen-model.json'));return {ok:process.env.FAIL_SOURCE!=='1'||String(url).includes('codegen-model'),status:503,headers:new Headers({'x-medol-workspace-id':'workspace'}),text:async()=>String(url).includes('codegen-model')?JSON.stringify(model):JSON.stringify({workspace:{dsl:process.env.BAD_SOURCE==='1'?'bad':fs.readFileSync(root+'/source.medol','utf8')}})}};`);
    const output = path.join(f.root, 'download/model.json');
    const sourceOutput = path.join(f.root, 'download/source.medol');
    const run = (env = {}) => spawnSync(process.execPath, ['-r', preload, path.join(repo, 'update-codegen-model.js'), '--base-url', 'http://example.test', '--output', output], {env: {...process.env, ...env}, encoding: 'utf8'});
    assert.equal(run().status, 0);
    const before = fs.readFileSync(output);
    const sourceBefore = fs.readFileSync(sourceOutput);
    assert.deepEqual(sourceBefore, fs.readFileSync(path.join(f.root, 'source.medol')));
    for (const env of [{BAD_SOURCE: '1'}, {FAIL_SOURCE: '1'}]) {
        assert.notEqual(run(env).status, 0);
        assert.deepEqual(fs.readFileSync(output), before);
        assert.deepEqual(fs.readFileSync(sourceOutput), sourceBefore);
    }
});

test('focused sync updates delivery files and package references without touching application code', (t) => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, 'pom.xml'), '<project>\n    <version>0.0.1-SNAPSHOT</version>\n<dependency><version>0.0.1-SNAPSHOT</version></dependency></project>');
    const before = fs.readFileSync(path.join(f.root, 'app.js'));
    syncReleaseSupport({cwd: f.root, root: f.root, target: 'axon5', modules: ['test-app']});
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, '.medol/generation/axon5.json'))).scope, 'release-support');
    assert.equal(fs.readFileSync(path.join(f.root, 'pom.xml'), 'utf8').includes('SNAPSHOT'), false);
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'app.js')), before);
    const result = spawnSync(process.execPath, ['scripts/image-bundle.mjs', 'list', '--dry-run'], {cwd: f.root, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /v1.2.3.0/);
});

test('real backend/frontend/operations generation smoke links baseline packages and supports dry-run scripts', (t) => {
    const f = fixture(t);
    for (const target of ['axon5', 'refine', 'operations']) {
        const root = path.join(f.root, target);
        fs.mkdirSync(root);
        fs.copyFileSync(path.join(f.root, 'codegen-model.json'), path.join(root, 'codegen-model.json'));
        fs.copyFileSync(path.join(f.root, 'source.medol'), path.join(root, 'source.medol'));
        const args = [path.join(repo, 'gen.sh'), '--generator', target, '--generator-type', target === 'refine' ? 'Skeleton' : 'all', '--environment', 'dev', '--all-slices', '--all-commands', '--skip-install', '--force'];
        const generated = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', timeout: 30000, env: {...process.env, CODEGEN_MODEL_PATH: path.join(root, 'codegen-model.json')}});
        assert.equal(generated.status, 0, generated.stderr + generated.stdout);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, `.medol/generation/${target}.json`))).model.metadata.source.release.label, 'v1.2.3');
        if (target === 'refine') assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.2.3');
        if (target === 'axon5') assert.match(fs.readFileSync(path.join(root, 'pom.xml'), 'utf8'), /<version>1.2.3<\/version>/);
        const script = target === 'operations' ? 'operations/dev/images.mjs' : 'scripts/image-bundle.mjs';
        const dryArgs = target === 'operations' ? ['--skip-backend', '--skip-console'] : [];
        const listed = spawnSync(process.execPath, [script, 'list', '--dry-run', ...dryArgs], {cwd: root, encoding: 'utf8'});
        assert.equal(listed.status, 0, listed.stderr);
        assert.match(listed.stdout, /v1.2.3.0/);
        const built = spawnSync(process.execPath, [script, 'build', '--dry-run', ...dryArgs], {cwd: root, encoding: 'utf8'});
        assert.equal(built.status, 0, built.stderr);
        if (target === 'axon5') {
            fs.writeFileSync(path.join(root, 'mvnw'), '#!/bin/sh\nexit 0\n');
            const skipped = spawnSync(process.execPath, [script, 'build', '--skip-install', '--dry-run'], {cwd: root, encoding: 'utf8'});
            assert.notEqual(skipped.status, 0);
            assert.match(skipped.stderr, /fresh reactor install/);
        }
        fs.unlinkSync(path.join(root, 'source.medol'));
        fs.unlinkSync(path.join(root, 'codegen-model.json'));
        const imported = spawnSync(process.execPath, [script, 'import', '--dry-run', ...dryArgs], {cwd: root, encoding: 'utf8'});
        assert.equal(imported.status, 0, imported.stderr);
    }
});
