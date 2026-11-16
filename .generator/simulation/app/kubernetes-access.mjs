import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {waitUntil} from './readiness-runtime.mjs';

async function availablePort(preferred, attempts = 100) {
    for (let port = preferred; port <= Math.min(65535, preferred + attempts - 1); port++) {
        const available = await new Promise(resolve => {
            const server = createServer();
            server.once('error', () => resolve(false));
            server.listen({port, host: '127.0.0.1', exclusive: true}, () => server.close(() => resolve(true)));
        });
        if (available) return port;
    }
    throw new Error('No available local port');
}

export function createKubernetesAccess({kubeconfig, timeoutMs = 30000, intervalMs = 500, spawnProcess = spawn, findPort = availablePort} = {}) {
    if (!kubeconfig) throw new Error('Explicit kubeconfig is required');
    const children = new Set();
    async function stop(child) {
        if (!children.has(child)) return;
        if (child.exitCode !== null || child.signalCode) {children.delete(child); return;}
        await new Promise(resolve => {
            let timer;
            const done = () => {clearTimeout(timer); child.removeListener('exit', done); children.delete(child); resolve();};
            child.once('exit', done);
            child.kill('SIGTERM');
            if (!children.has(child)) return;
            timer = setTimeout(() => {child.kill('SIGKILL'); done();}, 2000);
        });
    }
    return {
        async forward({namespace, service, localPort, remotePort, ready, signal}) {
            if (![namespace, service].every(value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(value))
                || ![localPort, remotePort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)
                || typeof ready !== 'function') throw new Error('Explicit namespace, service, ports and readiness probe required');
            signal?.throwIfAborted();
            const port = await findPort(localPort);
            signal?.throwIfAborted();
            const child = spawnProcess('kubectl', ['--kubeconfig', kubeconfig, '-n', namespace, 'port-forward',
                `svc/${service}`, `${port}:${remotePort}`, '--address=127.0.0.1'], {stdio: ['ignore', 'pipe', 'pipe']});
            children.add(child);
            // Drain output without exposing response bodies or credentials in generic logs.
            child.stdout?.resume(); child.stderr?.resume();
            let spawnError;
            child.on('error', () => {spawnError = new Error('kubectl port-forward could not start');});
            try {
                await waitUntil(`${namespace}/${service} port-forward`, async signal => {
                    if (spawnError) throw spawnError;
                    if (child.exitCode !== null || child.signalCode) throw new Error('kubectl port-forward exited before readiness');
                    return ready(`http://127.0.0.1:${port}`, signal);
                }, {timeoutMs, intervalMs, signal});
                return port;
            } catch (error) { await stop(child); throw error; }
        },
        async close() { await Promise.all([...children].map(stop)); }
    };
}
