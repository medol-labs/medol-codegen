const test = require('node:test');
const assert = require('node:assert/strict');
const { generatorOutputRoot } = require('../../../common/core/medol-workspace');
const { generateSimulationFiles } = require('../simulation-generator');
const path = require('node:path');

test('simulation defaults to a dedicated directory without changing other generators', () => {
    assert.equal(generatorOutputRoot({}, 'simulation'), 'simulation');
    assert.equal(generatorOutputRoot({}, 'operations'), '.');
    assert.equal(generatorOutputRoot({}, 'axon5'), '.');
});

test('configured simulation outputs remain supported', () => {
    assert.equal(generatorOutputRoot({ config: { generators: { simulation: { output: 'tools/sim' } } } }, 'simulation'), 'tools/sim');
    assert.equal(generatorOutputRoot({ config: { generators: { simulation: { output: '.' } } } }, 'simulation'), '.');
});

test('renderer paths are relative to the already resolved destination root', () => {
    const destination = generatorOutputRoot({}, 'simulation');
    const files = generateSimulationFiles({ name: 'example', scenarios: [] }, { target: 'service', root: '.' });
    const outputs = Object.keys(files).map(file => path.join(destination, file));
    assert.ok(outputs.includes('simulation/package.json'));
    assert.ok(outputs.includes('simulation/src/pipeline.mjs'));
    assert.ok(outputs.every(file => !file.startsWith('simulation/simulation/')));
});
