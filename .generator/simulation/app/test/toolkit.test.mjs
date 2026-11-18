import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {createRequire} from 'node:module';
import {prepareContext, publicFile} from '../toolkit/package.mjs';
import {initializeWorkspace, commandFor} from '../toolkit/entrypoint.mjs';

function fixture(t) {
    const root = mkdtempSync(resolve(tmpdir(), 'simulation-tool-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const put = (name, text = '') => { const file = resolve(root, name); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, text); };
    put('simulation/src/task.mjs'); put('simulation/src/prepare-environment.mjs');
    return {root, put, config: {image: 'example/tool:1', platform: 'linux/arm64', inputs: ['simulation/', 'operations/']}};
}
test('packages public runtime and policies but excludes secrets, instances, evidence and archives', t => {
    const {root, put, config} = fixture(t);
    put('operations/config.json', '{}');
    put('operations/extensions/test-credentials.json', '{"password":{"$secret":"generated"}}');
    for (const file of ['operations/secrets.local.yaml', 'operations/kubeconfig.yaml', 'simulation/.env', 'simulation/state.private.json', 'simulation/reports/test.json', 'simulation/instances/environments/test.json', 'simulation/archive.tar', 'simulation/node_modules/module.js']) put(file, 'never-package');
    put('simulation/src/test-credentials.mjs', 'export const x = true');
    config.publicPolicies = ['operations/extensions/test-credentials.json'];
    const out = resolve(root, 'output'); const manifest = prepareContext(root, config, out);
    assert.equal(Object.keys(manifest.files).length, 5);
    assert(manifest.files['simulation/src/test-credentials.mjs']);
    assert(manifest.files['operations/extensions/test-credentials.json']);
    assert(!existsSync(resolve(out, 'project/simulation/.env')));
    assert.throws(() => prepareContext(root, config, out), /already exists/);
    const workspace = resolve(root, 'workspace'); mkdirSync(workspace);
    initializeWorkspace(resolve(out, 'project'), workspace, manifest);
    assert(existsSync(resolve(workspace, '.simulation-toolkit.json')));
    assert.throws(() => initializeWorkspace(resolve(out, 'project'), workspace, manifest), /EMPTY/);
    assert.equal(readFileSync(resolve(workspace, 'simulation/src/test-credentials.mjs'), 'utf8'), 'export const x = true');
});
test('rejects path escapes, symlinks, output recursion and unversioned architecture', t => {
    const {root, put, config} = fixture(t); put('operations/config.json', '{}');
    const output = resolve(root, 'output');
    assert.throws(() => prepareContext(root, {...config, platform: ''}, output), /platform/);
    assert.throws(() => prepareContext(root, {...config, image: 'example/tool:latest'}, output), /versioned/);
    assert.throws(() => prepareContext(root, {...config, inputs: ['../outside']}, output), /project-relative/);
    assert.throws(() => prepareContext(root, config, resolve(root, 'simulation/output')), /outside selected/);
    symlinkSync(resolve(root, 'operations'), resolve(root, 'alias'));
    assert.throws(() => prepareContext(root, {...config, inputs: ['alias/config.json']}, output), /Symlink/);
    symlinkSync('/etc/passwd', resolve(root, 'operations/public.json'));
    assert.throws(() => prepareContext(root, config, output), /Symlink/);
});
test('refuses inline credentials in public policy and corrupted embedded snapshot', t => {
    const {root, put, config} = fixture(t); put('operations/test-credentials.json', '{"password":"sensitive"}');
    config.publicPolicies = ['operations/test-credentials.json'];
    assert.throws(() => prepareContext(root, config, resolve(root, 'output')), /Inline credential/);
    put('operations/test-credentials.json', '{"password":{"$secret":"generated"}}');
    const out = resolve(root, 'output'), manifest = prepareContext(root, config, out);
    writeFileSync(resolve(out, 'project/simulation/src/task.mjs'), 'tampered');
    const dest = resolve(root, 'empty'); mkdirSync(dest);
    assert.throws(() => initializeWorkspace(resolve(out, 'project'), dest, manifest), /checksum/);
});
test('stage commands use the same CLIs, without project-specific command names', () => {
    assert.deepEqual(commandFor('task', ['tasks.json', 'prepare-case']), ['node', 'simulation/src/task.mjs', 'tasks.json', 'prepare-case']);
    assert.deepEqual(commandFor('environment', ['env.json']), ['node', 'simulation/src/prepare-environment.mjs', 'env.json']);
    assert.deepEqual(commandFor('exec', ['kubectl', 'get', 'nodes']), ['kubectl', 'get', 'nodes']);
    assert.throws(() => commandFor('destroy', []), /Usage/);
    assert.equal(publicFile('operations/config.private.json'), false);
});
test('generator emits toolkit assets and generic build configuration', () => {
    const require = createRequire(import.meta.url);
    const {generateSimulationFiles} = require('../simulation-generator.js');
    const files = generateSimulationFiles({domain: 'Example', scenarios: [], services: [], metadata: {}}, {target: 'runtime'});
    for (const name of ['Dockerfile', 'package.mjs', 'entrypoint.mjs', 'run.sh', 'README.md', 'config.json-example']) assert(Object.keys(files).some(key => key.endsWith('toolkit/' + name)), name);
});
