import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const run = (cmd, args) => execFileSync(cmd, args, {encoding: 'utf8', timeout: 900000});

export function inspectNetwork(cluster, execute = run) {
    if (!/^[a-z][a-z0-9-]*$/.test(cluster || '')) throw new Error('Invalid cluster name');
    const ids = execute('docker', ['ps', '-aq', '--filter', `label=k3d.cluster=${cluster}`]).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) throw new Error('Cluster containers were not found');
    const containers = JSON.parse(execute('docker', ['inspect', ...ids]));
    const networks = Object.keys(containers[0].NetworkSettings.Networks).filter(name => containers.every(c => c.NetworkSettings.Networks[name]));
    if (networks.length !== 1) throw new Error('Expected exactly one shared cluster network');
    const network = JSON.parse(execute('docker', ['network', 'inspect', networks[0]]))[0];
    if (network.Driver !== 'bridge') throw new Error('Only Docker bridge networks are supported');
    return {cluster, networkId: network.Id, networkName: network.Name, subnets: network.IPAM.Config,
        containers: containers.map(c => {
            const endpoint = c.NetworkSettings.Networks[network.Name];
            return {id: c.Id, name: c.Name.replace(/^\//, ''), running: c.State.Running,
                ip: endpoint.IPAddress || endpoint.IPAMConfig?.IPv4Address,
                staticIp: endpoint.IPAMConfig?.IPv4Address, endpoint};
        })};
}

export function assertStaticNetwork(snapshot) {
    const dynamic = snapshot.containers.filter(c => !c.staticIp || c.ip !== c.staticIp);
    if (dynamic.length) throw new Error(`Cluster has dynamic or inconsistent node IPs: ${dynamic.map(c => c.name).join(', ')}. Run k3d-network.mjs pin explicitly during maintenance.`);
    return snapshot;
}

export function pinNetwork(cluster, backupFile, execute = run) {
    const snapshot = inspectNetwork(cluster, execute);
    if (snapshot.containers.every(c => c.staticIp && c.ip === c.staticIp)) return snapshot;
    for (const c of snapshot.containers) {
        if (!c.running || !c.ip) throw new Error('Recover and start all cluster containers before pinning their current IPs');
        const e = c.endpoint;
        if (e.GlobalIPv6Address || e.Links?.length || Object.keys(e.DriverOpts || {}).length || e.GwPriority) {
            throw new Error('Custom endpoint options require a manual migration; no changes made');
        }
    }
    if (new Set(snapshot.containers.map(c => c.ip)).size !== snapshot.containers.length) throw new Error('Duplicate node IPs');
    mkdirSync(dirname(resolve(backupFile)), {recursive: true});
    writeFileSync(backupFile, JSON.stringify(snapshot, null, 2), {mode: 0o600, flag: 'wx'});
    execute('k3d', ['cluster', 'stop', cluster]);
    // Use immutable IDs and preserve aliases. Never remove containers, networks or volumes.
    for (const c of snapshot.containers) {
        if (c.staticIp === c.ip) continue;
        execute('docker', ['network', 'disconnect', snapshot.networkId, c.id]);
        execute('docker', ['network', 'connect', '--ip', c.ip,
            ...(c.endpoint.Aliases || []).flatMap(alias => ['--alias', alias]), snapshot.networkId, c.id]);
    }
    const result = assertStaticNetwork(inspectNetwork(cluster, execute));
    execute('k3d', ['cluster', 'start', cluster, '--timeout', '600s']);
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const [action, cluster, backup] = process.argv.slice(2);
        if (!['check', 'pin'].includes(action) || (action === 'pin' && !backup)) throw new Error('Usage: node simulation/src/k3d-network.mjs check <cluster> | pin <cluster> <new-backup.json>');
        const result = action === 'pin' ? pinNetwork(cluster, backup) : assertStaticNetwork(inspectNetwork(cluster));
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error.message);
        console.error('No data is deleted. If migration was interrupted, use the saved endpoint snapshot to complete network connections before starting the cluster.');
        process.exitCode = 1;
    }
}
