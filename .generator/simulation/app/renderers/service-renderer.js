/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { kebab } = require('../../../axon5/app/model-helpers');

function simulationFiles(model, options = {}) {
    const root = trimRoot(options.root ?? '.');
    const target = options.target ?? 'all';
    const files = {};

    if (target === 'all' || target === 'model') {
        files[outputPath(root, 'simulation-model.json')] = `${JSON.stringify(model, null, 2)}\n`;
    }
    if (target === 'all' || target === 'service' || target === 'runtime') {
        Object.assign(files, serviceFiles(root, model));
    }
    if (target === 'all' || target === 'scenarios') {
        Object.assign(files, scenarioFiles(root, model));
    }
    if (target === 'all') {
        files[outputPath(root, 'README.md')] = renderReadme(model);
    }

    return files;
}

function serviceFiles(root, model) {
    return {
        [outputPath(root, 'package.json')]: renderPackageJson(model),
        [outputPath(root, '.env-example')]: renderEnvExample(),
        [outputPath(root, 'Dockerfile')]: renderDockerfile(),
        [outputPath(root, 'src/server.js')]: renderServer(),
        [outputPath(root, 'src/cli.js')]: renderCli(),
        [outputPath(root, 'src/runtime/business-client.js')]: renderBusinessClient(),
        [outputPath(root, 'src/runtime/context.js')]: renderContext(),
        [outputPath(root, 'src/runtime/data-generator.js')]: renderDataGenerator(),
        [outputPath(root, 'src/runtime/event-observer.js')]: renderEventObserver(),
        [outputPath(root, 'src/runtime/model-loader.js')]: renderModelLoader(),
        [outputPath(root, 'src/runtime/runner.js')]: renderRunner()
    };
}

function scenarioFiles(root, model) {
    return Object.fromEntries((model.scenarios ?? []).map((scenario) => [
        outputPath(root, `scenarios/${scenario.id}.json`),
        `${JSON.stringify(scenario, null, 2)}\n`
    ]));
}

function renderPackageJson(model) {
    const packageName = kebab(`${model.name ?? 'medol'}-simulation-service`) || 'medol-simulation-service';
    return `${JSON.stringify({
        name: packageName,
        version: '0.0.1',
        private: true,
        type: 'module',
        description: 'Generated Medol business-flow simulation service',
        scripts: {
            start: 'node src/server.js',
            simulate: 'node src/cli.js',
            check: 'node --check src/server.js && node --check src/cli.js && node --check src/runtime/business-client.js && node --check src/runtime/context.js && node --check src/runtime/data-generator.js && node --check src/runtime/event-observer.js && node --check src/runtime/model-loader.js && node --check src/runtime/runner.js'
        },
        engines: {
            node: '>=20'
        }
    }, null, 2)}\n`;
}

function renderEnvExample() {
    return `PORT=3199
HOST=127.0.0.1
BUSINESS_BASE_URL=http://localhost:8080
STRICT_EVENTS=false
WAIT_FOR_EVENTS=false
EVENT_TIMEOUT_MS=5000

# Optional. Use JSON when different contexts are served by different backend services.
# CONTEXT_BASE_URLS={"OrganizationManagement":"http://localhost:8081","TrainingOrchestration":"http://localhost:8082"}

# Optional. If the business system exposes or forwards events through another observer service.
# EVENT_OBSERVER_URL=http://localhost:3199

# Optional shared headers for business command calls, for example auth headers.
# BUSINESS_HEADERS={"Authorization":"Bearer token"}
`;
}

function renderDockerfile() {
    return `FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
ENV PORT=3199
ENV HOST=0.0.0.0
EXPOSE 3199
CMD ["node", "src/server.js"]
`;
}

function renderModelLoader() {
    return `import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function loadSimulationModel() {
  const currentFile = fileURLToPath(import.meta.url);
  const root = path.resolve(path.dirname(currentFile), '../..');
  const modelPath = path.join(root, 'simulation-model.json');
  return JSON.parse(readFileSync(modelPath, 'utf8'));
}
`;
}

function renderServer() {
    return `import { createServer } from 'node:http';
import { loadSimulationModel } from './runtime/model-loader.js';
import { createEventJournal, createEventObserver } from './runtime/event-observer.js';
import { runScenario } from './runtime/runner.js';

const model = loadSimulationModel();
const journal = createEventJournal();
const port = Number.parseInt(process.env.PORT || '3199', 10);
const host = process.env.HOST || '127.0.0.1';

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { status: 'ok', service: 'medol-simulation', scenarios: model.scenarios.length });
    }

    if (request.method === 'GET' && url.pathname === '/scenarios') {
      return sendJson(response, 200, {
        scenarios: model.scenarios.map((scenario) => ({
          id: scenario.id,
          name: scenario.name,
          kind: scenario.kind,
          context: scenario.context,
          steps: scenario.steps.length,
          unsupported: unsupportedReasons(scenario)
        }))
      });
    }

    const scenarioMatch = url.pathname.match(/^\\/scenarios\\/([^/]+)$/);
    if (request.method === 'GET' && scenarioMatch) {
      const scenario = findScenario(decodeURIComponent(scenarioMatch[1]));
      return scenario
        ? sendJson(response, 200, scenario)
        : sendJson(response, 404, { error: 'scenario_not_found' });
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      return sendJson(response, 200, { events: journal.events() });
    }

    if (request.method === 'POST' && url.pathname === '/events') {
      const body = await readJson(request);
      const eventName = body.eventName || body.name || body.type || body.eventType;
      if (!eventName) {
        return sendJson(response, 400, { error: 'eventName is required' });
      }
      const event = journal.record(eventName, body.payload ?? body.event ?? body);
      return sendJson(response, 202, { accepted: true, event });
    }

    if (request.method === 'POST' && url.pathname === '/simulations') {
      const body = await readJson(request);
      return runAndSend(response, body.scenario || body.scenarioId, body);
    }

    const runMatch = url.pathname.match(/^\\/simulations\\/([^/]+)\\/run$/);
    if (request.method === 'POST' && runMatch) {
      const body = await readJson(request);
      return runAndSend(response, decodeURIComponent(runMatch[1]), body);
    }

    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(response, 500, {
      error: 'simulation_service_error',
      message: error && error.message ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log('Medol simulation service listening on ' + host + ':' + port);
  console.log('Business base URL: ' + (process.env.BUSINESS_BASE_URL || 'http://localhost:8080'));
});

async function runAndSend(response, requestedScenario, options) {
  const observer = createEventObserver({
    journal,
    remoteUrl: options.eventObserverUrl || process.env.EVENT_OBSERVER_URL,
    timeoutMs: Number.parseInt(String(options.eventTimeoutMs || process.env.EVENT_TIMEOUT_MS || '5000'), 10),
    strict: options.strictEvents ?? parseBoolean(process.env.STRICT_EVENTS),
    wait: options.waitForEvents ?? parseBoolean(process.env.WAIT_FOR_EVENTS)
  });
  const result = await runScenario(model, {
    scenarioId: requestedScenario,
    seed: options.seed,
    variables: options.variables || {},
    dryRun: Boolean(options.dryRun),
    strictEvents: options.strictEvents,
    waitForEvents: options.waitForEvents,
    businessBaseUrl: options.businessBaseUrl,
    contextBaseUrls: options.contextBaseUrls,
    businessHeaders: options.businessHeaders || options.headers,
    allowUnsupported: Boolean(options.allowUnsupported),
    observer
  });
  sendJson(response, result.success ? 200 : 422, result);
}

function findScenario(value) {
  return model.scenarios.find((scenario) =>
    scenario.id === value ||
    scenario.name === value ||
    scenario.className === value
  );
}

function unsupportedReasons(scenario) {
  return [
    ...(scenario.unsupported || []),
    ...(scenario.given || [])
      .filter((item) => !item.supported)
      .map((item) => item.title + ': ' + (item.reason || 'Unsupported preparation'))
  ];
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}
`;
}

function renderCli() {
    return `import { loadSimulationModel } from './runtime/model-loader.js';
import { createEventJournal, createEventObserver } from './runtime/event-observer.js';
import { runScenario } from './runtime/runner.js';

const args = parseArgs(process.argv.slice(2));
const model = loadSimulationModel();
const observer = createEventObserver({
  journal: createEventJournal(),
  remoteUrl: args.eventObserverUrl || process.env.EVENT_OBSERVER_URL,
  timeoutMs: Number.parseInt(String(args.eventTimeoutMs || process.env.EVENT_TIMEOUT_MS || '5000'), 10),
  strict: args.strictEvents ?? parseBoolean(process.env.STRICT_EVENTS),
  wait: args.waitForEvents ?? parseBoolean(process.env.WAIT_FOR_EVENTS)
});

const result = await runScenario(model, {
  scenarioId: args.scenario || args._[0],
  seed: args.seed,
  variables: args.variables ? JSON.parse(args.variables) : {},
  dryRun: Boolean(args.dryRun),
  strictEvents: args.strictEvents,
  waitForEvents: args.waitForEvents,
  businessBaseUrl: args.businessBaseUrl,
  contextBaseUrls: args.contextBaseUrls ? JSON.parse(args.contextBaseUrls) : undefined,
  businessHeaders: args.businessHeaders ? JSON.parse(args.businessHeaders) : undefined,
  allowUnsupported: Boolean(args.allowUnsupported),
  observer
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const [rawName, inlineValue] = value.slice(2).split(/=(.*)/s, 2);
    const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      result[name] = coerce(inlineValue);
    } else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      result[name] = coerce(values[index + 1]);
      index += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}
`;
}

function renderBusinessClient() {
    return `export function createBusinessClient(options = {}) {
  const defaultBaseUrl = options.baseUrl || process.env.BUSINESS_BASE_URL || 'http://localhost:8080';
  const contextBaseUrls = options.contextBaseUrls || parseJsonEnv('CONTEXT_BASE_URLS') || {};
  const headers = {
    'content-type': 'application/json',
    ...(parseJsonEnv('BUSINESS_HEADERS') || {}),
    ...(options.headers || {})
  };

  return {
    async execute(step, payload) {
      const endpoint = step.http || {};
      const baseUrl = contextBaseUrls[step.context] || defaultBaseUrl;
      const url = new URL(endpoint.path || '/', normalizeBaseUrl(baseUrl));
      const method = endpoint.method || 'POST';

      if (options.dryRun) {
        return {
          ok: true,
          dryRun: true,
          status: 200,
          method,
          url: url.toString(),
          body: payload
        };
      }

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      const body = parseBody(text);
      if (!response.ok) {
        const error = new Error('Business command failed: ' + method + ' ' + url + ' -> HTTP ' + response.status);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return {
        ok: true,
        status: response.status,
        method,
        url: url.toString(),
        body
      };
    }
  };
}

function normalizeBaseUrl(value) {
  return String(value || 'http://localhost:8080').replace(/\\/+$/, '') + '/';
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseJsonEnv(name) {
  const value = process.env[name];
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error('Invalid JSON in ' + name + ': ' + error.message);
  }
}
`;
}

function renderContext() {
    return `export function createSimulationContext(options = {}) {
  const values = new Map();
  const events = new Map();
  const steps = new Map();
  const warnings = [];

  return {
    seed: options.seed,
    scenarioId: options.scenarioId,
    put(key, value) {
      values.set(key, value);
    },
    get(key) {
      return values.get(key);
    },
    putStep(stepId, value) {
      steps.set(stepId, value);
    },
    putEvent(eventName, value) {
      const list = events.get(eventName) || [];
      list.push(value);
      events.set(eventName, list);
    },
    eventValue(eventName, field) {
      const list = events.get(eventName) || [];
      const event = list[list.length - 1];
      return readPath(event, field);
    },
    findValue(field) {
      for (const [, value] of Array.from(values).reverse()) {
        const match = readPath(value, field);
        if (match !== undefined) return match;
      }
      for (const [, value] of Array.from(steps).reverse()) {
        const match = readPath(value, field);
        if (match !== undefined) return match;
      }
      return undefined;
    },
    warn(message) {
      warnings.push(message);
    },
    snapshot() {
      return {
        values: Object.fromEntries(values),
        warnings: [...warnings]
      };
    }
  };
}

export function readPath(source, path) {
  if (source == null || !path) return undefined;
  return String(path).split('.').reduce((current, part) => {
    if (current == null) return undefined;
    return current[part];
  }, source);
}
`;
}

function renderDataGenerator() {
    return `export function createDataGenerator(seed, namespace) {
  const ns = namespace || '';

  return {
    value(input, key) {
      return generatedValue(input.typeInfo || { baseType: input.type || 'String' }, key, input.label || input.name);
    }
  };

  function generatedValue(typeInfo, key, label) {
    if (typeInfo.optional) return null;
    if (typeInfo.list) {
      return [generatedValue({ ...typeInfo, list: false }, key + '.item', label)];
    }
    if (typeInfo.kind === 'value-scalar') {
      return generatedValue(typeInfo.base || { baseType: 'String' }, key + '.value', label);
    }
    if (typeInfo.kind === 'value-object') {
      return Object.fromEntries((typeInfo.fields || []).map((field) => [
        field.name,
        generatedValue(field, key + '.' + field.name, field.name)
      ]));
    }
    if (typeInfo.kind === 'enum') {
      return (typeInfo.values || [slug(label || key).toUpperCase()])[0];
    }

    switch (String(typeInfo.baseType || typeInfo.type || 'String').toLowerCase()) {
      case 'uuid':
        return uuid(key);
      case 'int':
      case 'integer':
        return integer(key, 1, 999);
      case 'long':
        return integer(key, 1000, 999999);
      case 'double':
      case 'float':
      case 'number':
      case 'decimal':
      case 'bigdecimal':
        return Number((Number(positiveHash(key) % 10000n) / 100).toFixed(2));
      case 'boolean':
        return positiveHash(key) % 2n === 0n;
      case 'date':
      case 'localdate':
        return '2026-01-' + String(Number(positiveHash(key) % 28n) + 1).padStart(2, '0');
      case 'datetime':
      case 'localdatetime':
        return '2026-01-01T' + String(Number(positiveHash(key) % 24n)).padStart(2, '0') + ':00:00';
      case 'instant':
        return '2026-01-01T00:' + String(Number(positiveHash(key) % 60n)).padStart(2, '0') + ':00Z';
      case 'string':
      default:
        return String(label || key).toLowerCase().includes('email')
          ? 'sample-' + Number(positiveHash(key) % 10000n) + '@example.test'
          : slug(label || 'sample') + '-' + String(Number(positiveHash(key) % 999n) + 1).padStart(3, '0');
    }
  }

  function uuid(key) {
    const hex = positiveHash(key).toString(16).padStart(32, '0').slice(0, 32);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }

  function integer(key, min, max) {
    return min + Number(positiveHash(key) % BigInt(max - min + 1));
  }

  function positiveHash(key) {
    let hash = BigInt(seed || 1001) + 1125899906842597n;
    const input = ns + ':' + key;
    for (let index = 0; index < input.length; index += 1) {
      hash = hash * 31n + BigInt(input.charCodeAt(index));
    }
    return hash < 0n ? -hash : hash;
  }

  function slug(value) {
    return String(value || 'sample')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'sample';
  }
}
`;
}

function renderEventObserver() {
    return `export function createEventJournal() {
  const values = [];
  const waiters = new Set();

  return {
    record(eventName, payload) {
      const event = {
        eventName,
        payload,
        recordedAt: new Date().toISOString()
      };
      values.push(event);
      for (const waiter of waiters) {
        waiter();
      }
      return event;
    },
    find(eventName) {
      return [...values].reverse().find((event) => event.eventName === eventName);
    },
    events() {
      return [...values];
    },
    async waitFor(eventName, timeoutMs) {
      const existing = this.find(eventName);
      if (existing) return existing;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now())));
          const wake = () => {
            clearTimeout(timer);
            waiters.delete(wake);
            resolve();
          };
          waiters.add(wake);
        });
        const found = this.find(eventName);
        if (found) return found;
      }
      return undefined;
    }
  };
}

export function createEventObserver(options = {}) {
  const journal = options.journal || createEventJournal();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5000;
  const strict = Boolean(options.strict);
  const wait = Boolean(options.wait);
  const remoteUrl = options.remoteUrl;

  return {
    async expect(event, log) {
      const observed = (strict || wait || remoteUrl)
        ? await waitForObservedEvent(journal, remoteUrl, event.name, timeoutMs)
        : undefined;
      if (observed) {
        log('EVENT observed ' + event.name + (observed.source === 'remote' ? ' remotely' : ''));
        return observed.payload;
      }

      const message = 'Expected event was not observed: ' + event.name;
      if (strict) {
        throw new Error(message);
      }
      log('EVENT observation skipped ' + event.name + ' (set STRICT_EVENTS=true or POST /events to enforce)');
      return undefined;
    }
  };
}

async function waitForObservedEvent(journal, remoteUrl, eventName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const local = journal.find(eventName);
    if (local) {
      return { source: 'local', payload: local.payload };
    }
    if (remoteUrl) {
      const remote = await fetchRemoteEvent(remoteUrl, eventName);
      if (remote) {
        return {
          source: 'remote',
          payload: remote.payload ?? remote.event ?? remote
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

async function fetchRemoteEvent(remoteUrl, eventName) {
  const url = new URL('/events', String(remoteUrl).replace(/\\/+$/, '') + '/');
  url.searchParams.set('eventName', eventName);
  const response = await fetch(url).catch(() => undefined);
  if (!response || !response.ok) return undefined;
  const body = await response.json().catch(() => undefined);
  return selectEvent(body, eventName);
}

function selectEvent(body, eventName) {
  const events = Array.isArray(body) ? body : body?.events;
  if (!Array.isArray(events)) return undefined;
  return [...events].reverse().find((event) =>
    event.eventName === eventName ||
    event.name === eventName ||
    event.type === eventName
  );
}
`;
}

function renderRunner() {
    return `import { createBusinessClient } from './business-client.js';
import { createSimulationContext } from './context.js';
import { createDataGenerator } from './data-generator.js';
import { createEventObserver } from './event-observer.js';

export async function runScenario(model, options = {}) {
  const seed = Number.parseInt(String(options.seed || model.defaultSeed || 1001), 10);
  const logs = [];
  let scenario;
  let context;

  try {
    scenario = findScenario(model, options.scenarioId);
    context = createSimulationContext({ seed, scenarioId: scenario.id });
    const data = createDataGenerator(seed, scenario.id);
    const client = createBusinessClient({
      dryRun: options.dryRun,
      baseUrl: options.businessBaseUrl,
      contextBaseUrls: options.contextBaseUrls,
      headers: options.businessHeaders || options.headers
    });
    const observer = options.observer || createEventObserver({
      strict: options.strictEvents,
      wait: options.waitForEvents
    });

    for (const [key, value] of Object.entries(options.variables || {})) {
      context.put(key, value);
    }

    log(logs, '[SIMULATION]');
    log(logs, 'Scenario: ' + scenario.name);
    log(logs, 'Seed: ' + seed);

    const unsupported = unsupportedReasons(scenario);
    if (unsupported.length > 0 && !options.allowUnsupported) {
      unsupported.forEach((reason) => log(logs, 'UNSUPPORTED ' + reason));
      return {
        success: false,
        status: 'unsupported',
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        seed,
        message: 'Scenario has unsupported preparation. Pass allowUnsupported=true to run command steps anyway.',
        unsupported,
        logs,
        context: context.snapshot()
      };
    }

    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      log(logs, '');
      log(logs, '[' + (index + 1) + '/' + scenario.steps.length + '] ' + step.title);

      const payload = resolvePayload(step, context, data);
      context.put(step.id + '.command', payload);

      if (step.execution === 'AUTOMATIC') {
        log(logs, 'AUTO waiting for ' + expectedEventNames(step).join(', '));
        await expectEvents(step, observer, context, logs);
        log(logs, 'PASS');
        continue;
      }

      if (step.expectedRejection) {
        await expectRejection(step, payload, client, context, logs);
        log(logs, 'PASS');
        continue;
      }

      log(logs, 'COMMAND ' + step.command + ' ' + (step.http?.method || 'POST') + ' ' + (step.http?.path || '/'));
      const result = await client.execute(step, payload);
      context.putStep(step.id, result.body);
      context.put(step.id + '.result', result.body);
      log(logs, 'HTTP ' + result.status);

      await expectEvents(step, observer, context, logs);
      log(logs, 'PASS');
    }

    log(logs, '');
    log(logs, 'Scenario PASSED');
    return {
      success: true,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      seed,
      logs,
      context: context.snapshot()
    };
  } catch (error) {
    log(logs, '');
    log(logs, 'Scenario FAILED');
    log(logs, error && error.message ? error.message : String(error));
    return {
      success: false,
      scenarioId: scenario?.id,
      scenarioName: scenario?.name,
      seed,
      message: error && error.message ? error.message : String(error),
      logs,
      context: context?.snapshot ? context.snapshot() : { values: {}, warnings: [] }
    };
  }
}

function unsupportedReasons(scenario) {
  return [
    ...(scenario.unsupported || []),
    ...(scenario.given || [])
      .filter((item) => !item.supported)
      .map((item) => item.title + ': ' + (item.reason || 'Unsupported preparation'))
  ];
}

function resolvePayload(step, context, data) {
  return Object.fromEntries((step.inputs || []).map((input) => {
    const value = resolveInput(step, input, context, data);
    context.put(step.id + '.' + input.name, value);
    return [input.name, value];
  }));
}

function resolveInput(step, input, context, data) {
  const source = input.source || { kind: 'Generated' };
  if (source.kind === 'Constant') {
    return source.value;
  }
  if (source.kind === 'PreviousStep') {
    const value = context.get(source.stepId + '.' + source.field) ?? context.findValue(source.field);
    if (value === undefined) {
      throw new Error('Cannot resolve previous step input: ' + step.id + '.' + input.name);
    }
    return value;
  }
  if (source.kind === 'PreviousEvent') {
    const value = context.eventValue(source.event, source.field) ?? context.findValue(source.field);
    if (value === undefined) {
      throw new Error('Cannot resolve previous event input: ' + source.event + '.' + source.field);
    }
    return value;
  }
  return data.value(input, step.id + '.' + input.name);
}

async function expectEvents(step, observer, context, logs) {
  for (const event of step.expectedEvents || []) {
    const payload = await observer.expect(event, (message) => log(logs, message));
    if (payload !== undefined) {
      context.putEvent(event.name, payload);
    }
  }
}

async function expectRejection(step, payload, client, context, logs) {
  log(logs, 'COMMAND ' + step.command + ' expecting rejection');
  try {
    const result = await client.execute(step, payload);
    context.putStep(step.id, result.body);
  } catch (error) {
    context.putStep(step.id, { rejected: true, status: error.status, body: error.body, message: error.message });
    log(logs, 'REJECTED ' + (error.status || 'error'));
    return;
  }
  throw new Error('Expected command rejection but command succeeded: ' + step.command);
}

function expectedEventNames(step) {
  return (step.expectedEvents || []).map((event) => event.name);
}

function findScenario(model, value) {
  if (!value) {
    const scenario = model.scenarios[0];
    if (!scenario) throw new Error('No simulation scenarios were generated.');
    return scenario;
  }
  const scenario = model.scenarios.find((item) =>
    item.id === value ||
    item.name === value ||
    item.className === value
  );
  if (!scenario) {
    throw new Error('Simulation scenario not found: ' + value);
  }
  return scenario;
}

function log(logs, message) {
  logs.push(message);
  console.log(message);
}
`;
}

function renderReadme(model) {
    const firstScenario = model.scenarios?.[0]?.id ?? '<scenario-id>';
    const scenarioList = (model.scenarios ?? [])
        .slice(0, 80)
        .map((scenario) => `- ${scenario.id}: ${scenario.name} (${scenario.steps?.length ?? 0} steps)`)
        .join('\n');
    return `# Medol Simulation Service

Generated service for executing business flows against a running business system.

## Start

\`\`\`bash
npm start
\`\`\`

The service has no package dependencies beyond Node.js 20+.

Configure the target business system:

\`\`\`bash
BUSINESS_BASE_URL=http://localhost:8080 npm start
\`\`\`

## Execute A Scenario

\`\`\`bash
curl -sS -X POST http://localhost:3199/simulations/${firstScenario}/run \\
  -H 'content-type: application/json' \\
  -d '{"seed":1001}'
\`\`\`

Or from the command line:

\`\`\`bash
npm run simulate -- ${firstScenario} --seed 1001
\`\`\`

## Event Observation

Command steps call the business system through HTTP command endpoints derived from the generated Axon 5 resources.

Automatic steps are not called directly. The service waits for their expected events. To enforce event assertions, either post events back to this service:

\`\`\`bash
curl -sS -X POST http://localhost:3199/events \\
  -H 'content-type: application/json' \\
  -d '{"eventName":"OrganizationRegistered","payload":{"organizationId":"..."}}'
\`\`\`

or set \`EVENT_OBSERVER_URL\` to an event observer service exposing \`GET /events?eventName=<name>\`.

Set \`STRICT_EVENTS=true\` when missing expected events should fail the simulation.
Set \`WAIT_FOR_EVENTS=true\` when non-strict simulations should still wait for posted or observed events.

## API

- \`GET /health\`
- \`GET /scenarios\`
- \`GET /scenarios/:id\`
- \`POST /simulations\`
- \`POST /simulations/:id/run\`
- \`GET /events\`
- \`POST /events\`

## Generated Scenarios

${scenarioList || '- none'}

The model-first flow is:

\`\`\`text
codegen-model.json
  -> SimulationModel
  -> Simulation service
  -> HTTP command calls to business system
  -> optional event observation
\`\`\`
`;
}

function trimRoot(value) {
    const root = String(value ?? '').replace(/^\/+|\/+$/g, '');
    return root === '.' ? '' : root;
}

function outputPath(root, file) {
    return root ? `${root}/${file}` : file;
}

module.exports = {
    simulationFiles
};
