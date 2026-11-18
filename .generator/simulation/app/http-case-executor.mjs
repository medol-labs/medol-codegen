import {isDeepStrictEqual} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {allSteps} from './case-design.mjs';
import {compare, matchesAny} from './flow-values.mjs';
import {readFileSync, realpathSync} from 'node:fs';
import {resolve, relative} from 'node:path';
import {parseEnv} from 'node:util';

const at = (value, path) => path.split('.').reduce((v, key) => v?.[key], value);
const matches = (body, expected) => Object.entries(expected || {}).every(([path, value]) => isDeepStrictEqual(at(body, path), value));

// Configuration contains endpoint aliases and environment-variable names, never credentials.
export function createHttpExecutor(config, {fetchImpl = fetch, env = process.env} = {}) {
  if (config.envFile) {
    const file = realpathSync(resolve(config.envFile)), rel = relative(realpathSync(process.cwd()), file);
    if (rel === '..' || rel.startsWith('../')) throw new Error('Credential file must be inside the workspace');
    env = {...parseEnv(readFileSync(file, 'utf8')), ...env};
  }
  function validate(request) {
    if (!request || !Object.hasOwn(config.endpoints || {}, request.endpoint)) throw new Error('HTTP endpoint is not configured');
    if (typeof request.path !== 'string' || !request.path.startsWith('/') || request.path.startsWith('//') || /[\\?#]/.test(request.path)
      || request.path.split('/').some(part => ['.', '..'].includes(part))) throw new Error('HTTP path must be relative without query, fragment or traversal');
    if (request.acceptStatuses !== undefined && (!Array.isArray(request.acceptStatuses) || !request.acceptStatuses.length || request.acceptStatuses.some(s => !Number.isInteger(s) || s < 200 || s > 599))) throw new Error('Invalid accepted HTTP statuses');
    if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) throw new Error('Invalid HTTP timeout');
    if (request.pollIntervalMs !== undefined && (!Number.isFinite(request.pollIntervalMs) || request.pollIntervalMs <= 0)) throw new Error('Invalid poll interval');
  }
  function headers(endpoint) {
    const auth = config.endpoints[endpoint];
    if (auth.headersEnv) return Object.fromEntries(Object.entries(auth.headersEnv).map(([name, key]) => {
      if (!env[key]) throw new Error(`Missing credential environment variable for endpoint ${endpoint}`);
      return [name, env[key]];
    }));
    if (auth.anonymous === true && !auth.bearerTokenEnv) return {};
    if (!auth.bearerTokenEnv || !env[auth.bearerTokenEnv]) throw new Error(`Missing credential environment variable for endpoint ${endpoint}`);
    return {Authorization: `Bearer ${env[auth.bearerTokenEnv]}`};
  }
  async function request(spec, environment, {method = 'GET', signal} = {}) {
    validate(spec);
    const definition = config.endpoints[spec.endpoint];
    const instances = definition.collection ? at(environment, definition.collection) : undefined;
    const matched = definition.collection && Array.isArray(instances) ? instances.filter(item => item[definition.key || 'slot'] === spec.target) : [];
    if (definition.collection && matched.length !== 1) throw new Error(`Endpoint target must identify exactly one deployment: ${spec.endpoint}`);
    const instance = matched[0];
    const selected = definition.collection ? at(instance, definition.urlField || 'endpoint') : environment.endpoints?.[definition.environmentEndpoint || spec.endpoint];
    const base = selected ? selected.replace(/\/$/, '') + (definition.suffix || '') : undefined;
    if (!base) throw new Error(`Missing deployment endpoint: ${spec.endpoint}`);
    const url = new URL(spec.download?.url || base.replace(/\/$/, '') + spec.path);
    const allowed = new URL(base);
    if (url.origin !== allowed.origin || !(url.pathname === allowed.pathname.replace(/\/$/, '') || url.pathname.startsWith(allowed.pathname.replace(/\/$/, '') + '/'))) throw new Error('Request escapes configured endpoint');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid deployment endpoint URL');
    for (const [key, value] of Object.entries(spec.query || {})) {
      if (value !== null && typeof value === 'object') throw new Error('HTTP query values must be scalar');
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const bodyValues = {...spec.body};
    for (const [key, variable] of Object.entries(spec.bodyEnv || {})) {
      if (!env[variable]) throw new Error(`Missing request environment variable: ${variable}`);
      bodyValues[key] = env[variable];
    }
    const deadline = Date.now() + (spec.timeoutMs || 30000);
    while (true) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(Math.max(1, spec.download ? deadline - Date.now() : Math.min(10000, deadline - Date.now())));
      let response;
      try {
        response = await fetchImpl(url, {method, redirect: 'error',
          headers: {'Content-Type': 'application/json', ...headers(spec.endpoint), ...(spec.bearerToken ? {Authorization: `Bearer ${spec.bearerToken}`} : {})},
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          body: method === 'POST' ? JSON.stringify(bodyValues) : undefined});
      } catch { throw new Error(`HTTP transport failed for ${spec.endpoint}`); }
      if (spec.acceptStatuses ? !spec.acceptStatuses.includes(response.status) : !response.ok) throw new Error(`HTTP ${method} ${spec.endpoint}${spec.path} returned ${response.status}`);
      if (method === 'POST' && spec.ignoreResponseBody === true) {
        await response.body?.cancel();
        return {status: 'ok', httpStatus: response.status, body: null};
      }
      if (spec.download) {
        if (method !== 'GET' || !response.body || !/^(sha256:)?[a-f0-9]{64}$/i.test(spec.download.digest || '')) throw new Error('Download requires a SHA-256 digest and readable body');
        const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of response.body) {bytes += chunk.length; hash.update(chunk); if (bytes > (spec.download.maxBytes || 1073741824)) throw new Error('Artifact exceeds size limit');}
        const digest = `sha256:${hash.digest('hex')}`;
        if (!bytes || digest !== `sha256:${spec.download.digest.replace(/^sha256:/i, '').toLowerCase()}`) throw new Error('Artifact is empty or digest mismatched');
        return {status: 'ok', body: {bytes, digest, verified: true}};
      }
      let body;
      try {body = response.status === 204 ? null : await response.json();}
      catch {throw new Error(`Invalid JSON response from ${spec.endpoint}`);}
      if ((spec.failWhen || []).some(c => compare(at(body, c.path), c.operator, c.expected))) throw new Error('Configured terminal failure condition observed');
      if (method !== 'GET' || (matches(body, spec.expect) && (!spec.anyChecks || matchesAny(body, spec.anyChecks)) && (spec.checks || []).every(c => compare(at(body, c.path), c.operator, c.expected)))) return {status: 'ok', httpStatus: response.status, body};
      if (Date.now() >= deadline) throw new Error(`Projection wait timed out for ${spec.endpoint}${spec.path}`);
      await delay(Math.min(spec.pollIntervalMs || 500, Math.max(1, deadline - Date.now())), undefined, {signal});
    }
  }
  async function probes(environment) {
    if (!config.probes?.length) throw new Error('HTTP executor requires explicit live readiness probes');
    for (const probe of config.probes) await request(probe, environment);
  }
  return {
    capabilities: {steps: ['command', 'query'], assertions: ['query']},
    async validatePlan(plan) {
      for (const item of plan.cases) for (const step of allSteps(item.steps)) {
        if (['foreach', 'assert'].includes(step.type)) continue;
        if (!['command', 'query'].includes(step.type)) throw new Error('Unsupported HTTP step');
        const preview = {...step.request};
        for (const key of ['timeoutMs', 'pollIntervalMs']) if (typeof preview[key]?.$ref === 'string') delete preview[key];
        validate(preview); // Resolved numeric values are validated again before the request.
      }
    },
    validateEnvironment: probes,
    async validateData(data, environment) {
      if (!matches(data, config.dataExpect)) throw new Error('Case data does not satisfy executor configuration');
      await probes(environment);
    },
    async headersFor({endpoint}) {
      if (!Object.hasOwn(config.endpoints || {}, endpoint)) throw new Error('HTTP endpoint is not configured');
      return headers(endpoint);
    },
    execute: (step, {environment, signal}) => request(step.request, environment, {method: step.type === 'command' ? 'POST' : 'GET', signal}),
  };
}
