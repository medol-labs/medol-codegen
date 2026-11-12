import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('local and remote execution use explicit different policies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'simulation-mode-'));
    try {
        copyFileSync(new URL('../environment-runner.mjs', import.meta.url), join(root, 'run.mjs'));
        copyFileSync(new URL('../pipeline-runtime.mjs', import.meta.url), join(root, 'pipeline.mjs'));
        const {validateMode} = await import(pathToFileURL(join(root, 'run.mjs')));
        const local = {steps: [{command: ['node', 'test.mjs']}]};
        const remote = {hosts: {lab: {transport: 'ssh'}}, steps: [{host: 'lab'}]};
        assert.doesNotThrow(() => validateMode('local', local));
        assert.doesNotThrow(() => validateMode('remote', remote));
        assert.throws(() => validateMode('local', remote), /cannot/);
        assert.throws(() => validateMode('remote', local), /requires/);
        assert.throws(() => validateMode('other', local), /must/);
    } finally { rmSync(root, {recursive: true, force: true}); }
});
