import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {waitUntil} from '../readiness-runtime.mjs';
import {createKubernetesAccess} from '../kubernetes-access.mjs';

test('readiness returns actual data, propagates errors and bounds hung probes', async () => {
    let calls = 0;
    assert.deepEqual(await waitUntil('record', () => ++calls === 2 && {id: 'ready'}, {intervalMs: 1}), {id: 'ready'});
    await assert.rejects(waitUntil('record', () => {throw new Error('invalid');}), /invalid/);
    let probeSignal;
    await assert.rejects(waitUntil('hung', signal => {probeSignal = signal; return new Promise(() => {});}, {timeoutMs: 20}), /Timed out/);
    assert.equal(probeSignal.aborted, true);
    await assert.rejects(waitUntil('invalid', () => true, {intervalMs: -1}), /timing/);
});

test('cancelled readiness does not invoke a probe', async () => {
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await assert.rejects(waitUntil('ready', () => assert.fail('must not execute'), {signal: controller.signal}), /cancelled/);
});

function child() {
    const result = new EventEmitter();
    result.exitCode = null;
    result.kill = signal => {result.signalCode = signal; result.emit('exit', null, signal);};
    return result;
}
test('port forwarding uses explicit kubeconfig, loopback and project readiness without domain assumptions', async () => {
    const process = child(); let argumentsUsed;
    const access = createKubernetesAccess({kubeconfig: '/explicit/config', findPort: async () => 18083,
        spawnProcess: (_cmd, args) => {argumentsUsed = args; return process;}});
    const port = await access.forward({namespace: 'tenant', service: 'api', localPort: 18082, remotePort: 8080,
        ready: async url => {assert.equal(url, 'http://127.0.0.1:18083'); return true;}});
    assert.equal(port, 18083);
    assert(argumentsUsed.includes('/explicit/config'));
    assert(argumentsUsed.includes('--address=127.0.0.1'));
    await access.close();
    assert.equal(process.signalCode, 'SIGTERM');
    await access.close();
});

test('failed readiness cleans up and spawn error cannot become an unhandled event', async () => {
    const process = child();
    const access = createKubernetesAccess({kubeconfig: '/config', timeoutMs: 30, intervalMs: 1, findPort: async () => 12345,
        spawnProcess: () => {queueMicrotask(() => process.emit('error', new Error('ENOENT'))); return process;}});
    await assert.rejects(access.forward({namespace: 'tenant', service: 'api', localPort: 12345, remotePort: 80, ready: () => false}), /could not start/);
    assert.equal(process.signalCode, 'SIGTERM');
    await access.close();
});
