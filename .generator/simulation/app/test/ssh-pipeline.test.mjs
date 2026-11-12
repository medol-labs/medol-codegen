import test from 'node:test';
import assert from 'node:assert/strict';
import {executionCommand, planPipeline} from '../pipeline-runtime.mjs';

test('local commands stay local and SSH arguments are shell quoted', () => {
    const step = {command: ['node', 'worker.mjs', "a'b; echo unsafe"]};
    assert.equal(executionCommand(step, undefined, 'run'), step.command);
    const command = executionCommand(step, {transport: 'ssh', target: 'lab', workDir: '/opt/test root'}, 'run');
    assert.equal(command[0], 'ssh');
    assert.ok(command.at(-1).includes("'a'\\''b; echo unsafe'"));
    assert.ok(command.at(-1).startsWith("cd '/opt/test root'"));
});

test('bad SSH configuration fails during planning', () => {
    for (const host of [{transport: 'ssh', target: '-oProxyCommand=bad', workDir: '/tmp'},
        {transport: 'ssh', target: 'lab', workDir: 'relative'}, {transport: 'unknown'}]) {
        assert.throws(() => planPipeline({services: []}, {hosts: {remote: host},
            steps: [{id: 'deploy', phase: 'deploy', host: 'remote', command: ['true']}]}));
    }
});
