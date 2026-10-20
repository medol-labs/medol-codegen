const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {cleanupRelocatedContexts} = require('../context-cleanup');

test('cleans relocated contexts from old modules without removing assigned or hand-written code', () => {
    const removed = [];
    const generator = {
        model: {
            rootPackage: 'sample',
            deployments: [
                {name: 'app', contexts: [{name: 'Orders'}, {name: 'Shared'}]},
                {name: 'support', contexts: [{name: 'Exchange'}, {name: 'Shared'}]}
            ]
        },
        _deploymentModuleName: deployment => deployment.name,
        destinationPath: relative => `/output/${relative}`,
        fs: {
            exists: () => true,
            delete: directory => removed.push(directory)
        }
    };
    assert.deepEqual(cleanupRelocatedContexts(generator), [
        '/output/app/src/main/kotlin/sample/context/exchange',
        '/output/app/src/test/kotlin/sample/context/exchange',
        '/output/support/src/main/kotlin/sample/context/orders',
        '/output/support/src/test/kotlin/sample/context/orders'
    ]);
    assert.ok(removed.every(directory => directory.includes('/context/')));
    assert.ok(removed.every(directory => !directory.endsWith('/shared')));
    generator.fs.exists = () => false;
    assert.deepEqual(cleanupRelocatedContexts(generator), []);
});

test('detects existing directories when mem-fs exists only recognizes files', () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'context-cleanup-'));
    const stale = path.join(output, 'app/src/main/kotlin/sample/context/exchange');
    fs.mkdirSync(stale, {recursive: true});
    try {
        const removed = [];
        const generator = {
            fullModel: {
                rootPackage: 'sample',
                deployments: [{name: 'app', contexts: []}, {name: 'support', contexts: ['Exchange']}]
            },
            _deploymentModuleName: deployment => deployment.name,
            destinationPath: relative => path.join(output, relative),
            fs: {exists: () => false, delete: directory => removed.push(directory)}
        };
        assert.deepEqual(cleanupRelocatedContexts(generator), [stale]);
        assert.deepEqual(removed, [stale]);
    } finally {
        fs.rmSync(output, {recursive: true, force: true});
    }
});
