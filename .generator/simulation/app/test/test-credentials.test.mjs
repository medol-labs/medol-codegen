import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareTestCredentials} from '../test-credentials-runtime.mjs';

test('arbitrary credential names and paths are configuration driven and repeatable', () => {
    const root = mkdtempSync(join(tmpdir(), 'credentials-'));
    const config = {schemaVersion: 1, environment: 'sample', stateFile: 'private/state.json', generate: ['serviceKey'],
        outputs: [{format: 'env', path: 'settings.env', template: {API_KEY: {$secret: 'serviceKey'}}},
            {format: 'json', path: 'secret.json', template: {access: {$secret: 'serviceKey'}}}]};
    try {
        assert.equal(prepareTestCredentials(config, {root}).environment, 'sample');
        const before = readFileSync(join(root, 'settings.env'), 'utf8');
        prepareTestCredentials(config, {root});
        assert.equal(readFileSync(join(root, 'settings.env'), 'utf8'), before);
        assert(before.includes(JSON.parse(readFileSync(join(root, 'secret.json'))).access));
        writeFileSync(join(root, 'secret.json'), '{}');
        assert.throws(() => prepareTestCredentials(config, {root}), /differs/);
        assert.equal(readFileSync(join(root, 'secret.json'), 'utf8'), '{}');
        assert(!existsSync(join(root, 'private/state.json.lock')));
    } finally {rmSync(root, {recursive: true, force: true});}
});
test('unknown references and escaping paths fail without creating credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'credentials-'));
    const config = {schemaVersion: 1, environment: 'test', stateFile: 'state.json', generate: ['key'],
        outputs: [{format: 'json', path: 'out.json', template: {$secret: 'missing'}}]};
    try {
        assert.throws(() => prepareTestCredentials(config, {root}), /Unknown/);
        assert(!existsSync(join(root, 'state.json')));
        assert.throws(() => prepareTestCredentials({...config, stateFile: '../escape'}, {root}), /escapes/);
        symlinkSync(tmpdir(), join(root, 'link'));
        assert.throws(() => prepareTestCredentials({...config, stateFile: 'link/state.json'}, {root}), /symlinks/);
    } finally {rmSync(root, {recursive: true, force: true});}
});
