import {readFileSync, realpathSync, existsSync, mkdirSync, copyFileSync} from 'node:fs';
import {resolve, relative, dirname, posix} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const within = (root, path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/');
};

export function provisionFixtures(fixtures, environment, {root, execute = execFileSync} = {}) {
  if (!Array.isArray(fixtures)) throw new Error('fixtures must be an array');
  const base = realpathSync(root);
  const ids = new Set();
  // Validate every source and destination before the first mutation.
  const plans = fixtures.map(item => {
    if (!item.id || ids.has(item.id)) throw new Error('Fixture IDs must be unique');
    ids.add(item.id);
    if (typeof item.source !== 'string') throw new Error('Fixture source is required');
    const source = realpathSync(resolve(base, item.source));
    if (!within(base, source)) throw new Error('Fixture source escapes workspace');
    const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(item.sha256 || '') || digest !== item.sha256) throw new Error('Fixture digest mismatch');
    const destinations = (item.destinations || []).map(target => {
      if (target.transport !== 'k3d-node-file') throw new Error('Unsupported fixture transport');
      if (!environment.kubeconfigFile || !/^[a-z0-9][a-z0-9-]*$/.test(environment.clusterName || '')) throw new Error('Explicit cluster access is required');
      if (!target.path?.startsWith('/') || posix.normalize(target.path) !== target.path || target.path === '/') throw new Error('Invalid fixture destination path');
      if (!target.nodeSelector || typeof target.nodeSelector !== 'string') throw new Error('Explicit node selector is required');
      const nodes = JSON.parse(execute('kubectl', ['--kubeconfig', environment.kubeconfigFile, 'get', 'nodes', '-l', target.nodeSelector, '-o', 'json'], {encoding: 'utf8', timeout: 30000})).items;
      const names = nodes.map(node => node.metadata.name);
      if (!names.length || names.some(name => !name.startsWith(`k3d-${environment.clusterName}-agent-`))) throw new Error('Unexpected fixture destination nodes');
      return {...target, nodes: names};
    });
    if (!destinations.length) throw new Error('Fixture destinations are required');
    let localPath;
    if (item.localPath) {
      localPath = resolve(base, item.localPath);
      if (!within(base, localPath)) throw new Error('Fixture local path escapes workspace');
      let parent = dirname(localPath);
      while (!existsSync(parent)) parent = dirname(parent);
      if (!within(base, realpathSync(parent))) throw new Error('Fixture local parent escapes workspace');
      try {
        if (!within(base, realpathSync(localPath))) throw new Error('Fixture local file escapes workspace');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return {id: item.id, source, digest, localPath, destinations};
  });
  return plans.map(plan => {
    if (plan.localPath) {
      mkdirSync(dirname(plan.localPath), {recursive: true});
      copyFileSync(plan.source, plan.localPath);
    }
    for (const target of plan.destinations) for (const node of target.nodes) {
      execute('docker', ['exec', node, 'mkdir', '-p', posix.dirname(target.path)], {timeout: 30000});
      execute('docker', ['cp', plan.source, `${node}:${target.path}`], {timeout: 30000});
      const actual = execute('docker', ['exec', node, 'sha256sum', target.path], {encoding: 'utf8', timeout: 30000}).trim().split(/\s+/)[0];
      if (actual !== plan.digest) throw new Error('Transferred fixture digest mismatch');
    }
    return {id: plan.id, sha256: plan.digest, destinations: plan.destinations};
  });
}
