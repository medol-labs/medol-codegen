const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const {generateOperationsFiles} = require('../../operations/app/operations-generator');
const {buildOperationsModel} = require('../../operations/app/operations-model-builder');

function preflight(projects, missing = new Set()) {
    const files = generateOperationsFiles(buildOperationsModel({domain: 'Test', contexts: [], slices: []}), {target: 'model', environment: 'dev'});
    const source = files['operations/dev/images.mjs'];
    const implementation = source.slice(source.indexOf('function writeAggregateManifest('), source.indexOf('function createPackageArchive('));
    const checked = [];
    const context = vm.createContext({
        selectedProjects: () => projects, imagePrefix: 'registry-b/team', imageVersion: 'v1.2.3.0',
        monorepoRoot: '/workspace', outputRoot: '/output', appArchives: {}, dryRun: false,
        join: path.join, relative: path.relative,
        existsSync: () => true,
        prepareRelease: () => ({manifest: {imageVersion: 'v1.2.3.0', generation: {model: {sha256: 'model'}}},
            verifyImages: (images) => images.map((name) => {
                if (!checked.includes(name)) checked.push(name);
                if (missing.has(name)) throw new Error('Image missing: ' + name);
                return {name, id: 'actual'};
            })}),
        readFileSync: () => JSON.stringify({imageVersion: 'v1.2.3.0', generation: {model: {sha256: 'model'}},
            images: [{name: 'registry-a/team/previous-module:v1.2.3.0', id: 'old'}]}),
        fail: (message) => {throw new Error(message);},
        release: {manifest: {generation: {model: {sha256: 'model'}}}, verifyImages: (images) => {
            for (const image of images) {
                if (!checked.includes(image)) checked.push(image);
                if (missing.has(image)) throw new Error('Image missing: ' + image);
            }
        }}
    });
    vm.runInContext(implementation, context);
    return {run: () => context.writeAggregateManifest('push', true), checked};
}

test('aggregate preflight checks the requested registry prefix and filtered backend modules', () => {
    const probe = preflight([{key: 'backend', root: '/backend', modules: ['module-a']}]);
    probe.run();
    assert.deepEqual(probe.checked, ['registry-b/team/module-a:v1.2.3.0']);
});

test('aggregate preflight rejects a missing requested frontend before any publish loop', () => {
    const probe = preflight([
        {key: 'backend', root: '/backend', modules: ['module-a']},
        {key: 'console', root: '/console', kind: 'frontend', application: {name: 'console'}}
    ], new Set(['registry-b/team/console:v1.2.3.0']));
    assert.throws(probe.run, /Image missing/);
    assert.deepEqual(probe.checked, ['registry-b/team/module-a:v1.2.3.0', 'registry-b/team/console:v1.2.3.0']);
});

test('batch offline import checks every archive before loading the first image', async () => {
    const files = generateOperationsFiles(buildOperationsModel({domain: 'Test', contexts: [], slices: []}), {target: 'model', environment: 'dev'});
    const source = files['operations/dev/images.mjs'];
    const implementation = source.slice(source.indexOf('async function importImages('), source.indexOf('function pushImages('));
    const loaded = [];
    const context = vm.createContext({
        selectedProjects: () => [
            {key: 'backend', modules: ['module-a']},
            {key: 'console', application: {name: 'console'}}
        ],
        appArchives: {backend: 'backend.tar', console: 'console.tar'}, dryRun: false,
        skipDependencies: true, monorepoRoot: '/workspace',
        verifyArchiveManifest: async ({archiveFile}) => {
            if (archiveFile === 'console.tar') throw new Error('Image archive checksum mismatch');
            return {images: [{name: 'registry-a/module-a:v1.2.3.7'}]};
        },
        verifyLoadedImages: () => {}, run: (...args) => loaded.push(args),
        fail: (message) => {throw new Error(message);}
    });
    vm.runInContext(implementation, context);
    await assert.rejects(context.importImages(), /checksum mismatch/);
    assert.deepEqual(loaded, []);
});
