import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {readFileSync} from 'node:fs';

export function createComposeDeployment(config, options = {}) {
  if (config.target !== 'docker-compose' || !config.dockerContext || !/^[a-z0-9][a-z0-9_-]*$/.test(config.composeProject || '')
      || !config.files?.length || !config.envFile) throw new Error('Compose requires context, project, files and envFile');
  const root = resolve(options.root || '.');
  const execute = options.execute || ((cmd, args, settings) => execFileSync(cmd, args, {encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024, ...settings}));
  const environment = {...process.env, ...parseEnv(readFileSync(resolve(root, config.envFile), 'utf8'))};
  const args = ['--context', config.dockerContext, 'compose', '-p', config.composeProject, '--env-file', resolve(root, config.envFile),
    ...config.files.flatMap(file => ['-f', resolve(root, file)])];
  const docker = argv => execute('docker', ['--context', config.dockerContext, ...argv], {env: environment});
  const compose = argv => execute('docker', [...args, ...argv], {env: environment});
  let info, images = [];
  return {
    async validateConnection() {
      info = JSON.parse(docker(['info', '--format', '{{json .}}']));
      if (!info.ID) throw new Error('Docker daemon identity missing');
      if (config.infrastructureId && config.infrastructureId !== info.ID) throw new Error('Docker daemon identity changed');
      compose(['version']);
    },
    async prepareImages() {
      const model = JSON.parse(compose(['config', '--format', 'json']));
      const services = config.instances.map(item => item.service);
      if (services.some(name => !model.services[name]) || config.instances.some(item => item.replicas !== 1)) throw new Error('Compose deployment requires explicit single-instance services');
      images = [...new Set(services.map(name => model.services[name].image))].map(image => {
        if (!image) throw new Error('Compose image is required; build images separately');
        const found = JSON.parse(docker(['image', 'inspect', image]))[0];
        if (`linux/${found.Architecture}` !== config.platform) throw new Error('Image architecture differs: ' + image);
        return {source: image, reference: found.RepoDigests?.[0] || image, id: found.Id};
      });
    },
    async deploy() {
      compose(['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '300', ...config.instances.map(item => item.service)]);
    },
    async waitDeploymentReady() {
      const containers = JSON.parse(docker(['inspect', ...compose(['ps', '-q']).trim().split(/\s+/).filter(Boolean)]));
      if (containers.length < config.instances.length || containers.some(item => !item.State.Running || item.State.Health && item.State.Health.Status !== 'healthy')) throw new Error('Compose services not ready');
      for (const url of config.healthUrls || []) {
        const response = await fetch(url, {signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('Service health check failed');
      }
    },
    deploymentSnapshot() {
      return {dockerContext: config.dockerContext, composeProject: config.composeProject, infrastructureId: info?.ID,
        endpoints: config.endpoints, credentialRefs: {environmentFile: resolve(root, config.envFile)}, images,
        nodes: info ? [{name: info.Name, architecture: info.Architecture === 'x86_64' ? 'amd64' : info.Architecture === 'aarch64' ? 'arm64' : info.Architecture, ready: true}] : []};
    }
  };
}
