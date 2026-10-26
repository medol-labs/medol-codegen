/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

function documentSupportFiles(model, environment) {
    return {
        'docs/document-support/README.md': renderReadme(),
        'docs/document-support/collect-engineering-facts.mjs': renderEngineeringFactsScript(),
        'docs/document-support/i18n.mjs': renderI18nHelperScript(),
        'docs/document-support/i18n/base.json': `${JSON.stringify(baseMessages(), null, 2)}\n`,
        'docs/document-support/i18n/en-US.json': `${JSON.stringify(enMessages(), null, 2)}\n`,
        'docs/document-support/i18n/zh-CN.json': `${JSON.stringify(zhMessages(), null, 2)}\n`,
        'docs/document-support/config/engineering-facts-sources.json': `${JSON.stringify(engineeringFactsSources(model, environment), null, 2)}\n`
    };
}

function engineeringFactsSources(model, environment) {
    const applicationFiles = [];
    for (const application of model.applications ?? []) {
        applicationFiles.push(`${application.name}/Dockerfile`);
        applicationFiles.push(`${application.name}/docker-compose.yml`);
        applicationFiles.push(`${application.name}/.env-example`);
    }
    return {
        environment,
        operationsModel: `operations/model/${environment}/operations-model.json`,
        dockerCompose: `operations/docker-compose/${environment}/docker-compose.yml`,
        operationsReadmes: [
            `operations/model/${environment}/README.md`,
            `operations/model/${environment}/network-topology.md`,
            `operations/docker-compose/${environment}/README.md`,
            'operations/k3s/README.md',
            'operations/kubernetes/README.md'
        ],
        applicationFiles,
        technologyProjects: (model.applications ?? []).map(({ name, kind }) => ({ name, kind }))
    };
}

function renderReadme() {
    return [
        '# Document Support',
        '',
        'This directory contains reusable technical-document support assets generated for the project.',
        '',
        '## Engineering Facts',
        '',
        'Collect deployment and operations facts from the current project:',
        '',
        '```bash',
        'node docs/document-support/collect-engineering-facts.mjs',
        '```',
        '',
        'The default output is `docs/generated/facts/engineering-facts.json`.',
        'Backend and frontend technology stacks are read from generated Maven `pom.xml` and frontend `package.json` files when this command runs.',
        '',
        '## Internationalization',
        '',
        'Reusable document labels live under `docs/document-support/i18n/`.',
        'Add a project language file such as `ja-JP.json` when another output language is required.',
        'Missing keys fall back to `en-US`, then `base`, then the key itself.',
        ''
    ].join('\n');
}

function baseMessages() {
    return {
        fallbackLanguage: 'en-US'
    };
}

function enMessages() {
    return {
        'document.sections.deploymentUnits': 'Deployment Units',
        'document.sections.infrastructure': 'Infrastructure',
        'document.sections.gateway': 'Gateway',
        'document.sections.deploymentModes': 'Deployment Modes',
        'document.sections.referenceCommands': 'Reference Commands',
        'document.sections.configuration': 'Configuration',
        'document.sections.storageAndSecurity': 'Storage and Security',
        'document.sections.technologyStack': 'Technology Stack',
        'document.fields.name': 'Name',
        'document.fields.type': 'Type',
        'document.fields.image': 'Image',
        'document.fields.port': 'Port',
        'document.fields.path': 'Path',
        'document.fields.upstream': 'Upstream',
        'document.fields.dependencies': 'Dependencies',
        'document.fields.healthCheck': 'Health Check',
        'document.fields.volume': 'Volume',
        'document.fields.service': 'Service',
        'document.fields.configurationKey': 'Configuration Key',
        'document.fields.required': 'Required',
        'document.fields.defaultOrExample': 'Default / Example',
        'document.fields.technology': 'Technology',
        'document.fields.version': 'Version',
        'document.values.none': 'None',
        'document.values.yes': 'Yes',
        'document.values.no': 'No',
        'document.text.installationOverview': 'The installation scope includes the application software and its supporting runtime components.',
        'document.text.deploymentEnvironment': 'Deployment environment: {environment}.',
        'document.text.gatewaySummary': 'Gateway provider: {provider}, image: {image}, port: {port}.',
        'document.text.installationProcedure': 'Prepare the container runtime, database, event store persistence, application services, and external gateway before validation.',
        'document.text.testEnvironment': 'The test environment should cover frontend applications, backend services, runtime agents, databases, event storage, and the gateway.',
        'document.text.testPreparation': 'Test preparation includes starting the environment, checking health endpoints, initializing base data, configuring dataset directories, preparing sample data, and setting access tokens.',
        'document.text.architectureFacts': 'The system is deployed as frontend applications, platform services, support services, runtime agents, and runtime engine components.',
        'document.text.persistenceFacts': 'Database and event storage configuration is separated by deployment unit and controlled through environment variables.',
        'document.text.userOperationFacts': 'Users access platform-side features through the platform console and participant-side features through the participant console.'
    };
}

function zhMessages() {
    return {
        'document.sections.deploymentUnits': '部署单元',
        'document.sections.infrastructure': '支撑组件',
        'document.sections.gateway': '访问入口',
        'document.sections.deploymentModes': '部署方式',
        'document.sections.referenceCommands': '参考命令',
        'document.sections.configuration': '配置项',
        'document.sections.storageAndSecurity': '存储与保密',
        'document.sections.technologyStack': '技术栈',
        'document.fields.name': '名称',
        'document.fields.type': '类型',
        'document.fields.image': '镜像',
        'document.fields.port': '端口',
        'document.fields.path': '路径',
        'document.fields.upstream': '上游服务',
        'document.fields.dependencies': '依赖',
        'document.fields.healthCheck': '健康检查',
        'document.fields.volume': '持久化卷',
        'document.fields.service': '服务',
        'document.fields.configurationKey': '配置项',
        'document.fields.required': '必填',
        'document.fields.defaultOrExample': '默认/示例',
        'document.fields.technology': '技术',
        'document.fields.version': '版本',
        'document.values.none': '无',
        'document.values.yes': '是',
        'document.values.no': '否',
        'document.text.installationOverview': '安装对象包括应用软件及其运行支撑组件。',
        'document.text.deploymentEnvironment': '部署环境为 {environment}。',
        'document.text.gatewaySummary': '网关类型：{provider}，镜像：{image}，端口：{port}。',
        'document.text.installationProcedure': '安装过程应先准备容器运行环境、数据库与事件存储持久化目录，再部署应用服务和外部访问入口。',
        'document.text.testEnvironment': '测试环境应覆盖前端、平台服务、支撑服务、运行时代理、数据库、事件存储和网关入口。',
        'document.text.testPreparation': '测试准备包括启动部署环境、确认健康检查、初始化基础数据、配置数据目录、准备样例数据和访问令牌。',
        'document.text.architectureFacts': '系统采用前端控制台、平台服务、支撑服务、运行时代理和训练运行时分层部署。',
        'document.text.persistenceFacts': '数据库和事件存储按部署单元隔离配置，应用服务通过环境变量连接数据库与事件存储服务。',
        'document.text.userOperationFacts': '用户通过平台控制台访问平台侧功能，通过参与方控制台访问本地运行时代理功能。'
    };
}

function renderI18nHelperScript() {
    return `#!/usr/bin/env node
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');

export function createTranslator(options = {}) {
  const language = options.language ?? process.env.DOCUMENT_LANGUAGE ?? 'zh-CN';
  const fallbackLanguage = options.fallbackLanguage ?? process.env.DOCUMENT_FALLBACK_LANGUAGE ?? 'en-US';
  const dictionaries = [
    loadDictionary('base'),
    loadDictionary(fallbackLanguage),
    loadDictionary(language),
    options.messages ?? {}
  ];
  return function translate(key, variables = {}) {
    const template = findValue(dictionaries, key) ?? key;
    return String(template).replace(/\\{([a-zA-Z0-9_.-]+)\\}/g, (_, name) => variables[name] ?? '');
  };
}

function findValue(dictionaries, key) {
  for (let index = dictionaries.length - 1; index >= 0; index -= 1) {
    if (Object.prototype.hasOwnProperty.call(dictionaries[index], key)) {
      return dictionaries[index][key];
    }
  }
  return undefined;
}

function loadDictionary(language) {
  const path = resolve(repositoryRoot, 'docs/document-support/i18n', \`\${language}.json\`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}
`;
}

function renderEngineeringFactsScript() {
    return `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const args = parseArgs(process.argv.slice(2));
const configPath = resolve(repositoryRoot, args.config ?? 'docs/document-support/config/engineering-facts-sources.json');
const outputPath = resolve(repositoryRoot, args.out ?? 'docs/generated/facts/engineering-facts.json');

if (!existsSync(configPath)) {
  fail(\`Engineering facts source config does not exist: \${configPath}\`);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const operationsModelPath = resolve(repositoryRoot, config.operationsModel);
if (!existsSync(operationsModelPath)) {
  fail(\`Operations model does not exist: \${operationsModelPath}\`);
}

const operationsModel = JSON.parse(readFileSync(operationsModelPath, 'utf8'));
const facts = collectFacts(config, operationsModel);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, \`\${JSON.stringify(facts, null, 2)}\\n\`, 'utf8');
console.log(\`[document-support] Collected engineering facts in \${relative(repositoryRoot, outputPath)}\`);

function collectFacts(config, model) {
  const applications = (model.applications ?? []).map((app) => ({
    name: app.name,
    title: app.title,
    kind: app.kind,
    image: app.imageName ? \`\${app.artifactName ?? app.name}:\${model.imageTag ?? 'latest'}\` : '',
    port: app.servicePort ?? null,
    gatewayPath: app.gatewayPath ?? '',
    contexts: app.contexts ?? [],
    dependencies: app.dependencies ?? [],
    healthCheck: normalizeHealthCheck(app.healthCheck),
    environmentVariables: normalizeEnvironment(app.environmentVariables),
  }));

  const infrastructure = (model.infrastructure ?? [])
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      name: item.name,
      type: item.type,
      image: item.image,
      port: item.servicePort ?? item.managementPort ?? null,
      volumes: item.volumeNames ?? (item.volumeName ? [item.volumeName] : []),
      healthCheck: normalizeHealthCheck(item.healthCheck),
      environmentVariables: normalizeEnvironment(item.environmentVariables),
    }));

  const gateway = model.gateway?.enabled
    ? {
        provider: model.gateway.provider,
        image: model.gateway.image,
        port: model.gateway.servicePort,
        routes: (model.gateway.routes ?? []).map((route) => ({
          path: (route.paths ?? []).join(', '),
          upstream: route.upstreamId,
        })),
      }
    : null;

  const sourceFiles = [
    config.operationsModel,
    config.dockerCompose,
    ...(config.operationsReadmes ?? []),
    ...(config.applicationFiles ?? []),
  ].filter(Boolean);

  const fileInventory = sourceFiles
    .map((file) => {
      const path = resolve(repositoryRoot, file);
      if (!existsSync(path)) return null;
      return {
        path: file,
        kind: classifyFile(file),
        summary: summarizeFile(file, readFileSync(path, 'utf8')),
      };
    })
    .filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    environment: config.environment ?? 'dev',
    imagePrefix: '',
    imageTag: model.imageTag ?? '',
    applications,
    technologyStacks: (config.technologyProjects ?? []).map(collectTechnologyStack).filter(Boolean),
    infrastructure,
    gateway,
    deploymentModes: deploymentModes(config),
    sourceFiles: fileInventory,
    operationsCommands: operationsCommands(config),
    securityNotes: securityNotes(applications),
    storageNotes: storageNotes(infrastructure, fileInventory),
  };
}

function collectTechnologyStack(project) {
  const manifestName = project.kind === 'backend' ? 'pom.xml' : 'package.json';
  const candidates = [];
  if (project.kind === 'backend') {
    for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        candidates.push(join(entry.name, project.name, manifestName));
      }
    }
  }
  candidates.push(join(project.name, manifestName));
  const manifest = candidates.find((candidate) => existsSync(resolve(repositoryRoot, candidate)));
  if (!manifest) return null;
  const source = readFileSync(resolve(repositoryRoot, manifest), 'utf8');
  const technologies = project.kind === 'backend' ? backendTechnologies(source) : frontendTechnologies(JSON.parse(source));
  return { application: project.name, kind: project.kind, manifest, technologies };
}

function backendTechnologies(pom) {
  const element = (source, name) => {
    const open = '<' + name + '>';
    const close = '</' + name + '>';
    const start = source.indexOf(open);
    const end = start < 0 ? -1 : source.indexOf(close, start + open.length);
    return end < 0 ? undefined : source.slice(start + open.length, end).trim();
  };
  const property = (name) => element(pom, name);
  const technologies = [];
  const add = (name, version) => technologies.push({ name, version: version ?? '' });
  add('Java', property('java.version'));
  add('Kotlin', property('kotlin.version'));
  add('Axon Framework', property('axon.version'));
  const parent = element(pom, 'parent') ?? '';
  if (parent.includes('<artifactId>spring-boot-starter-parent</artifactId>')) {
    add('Spring Boot', element(parent, 'version'));
  }
  if (pom.includes('<artifactId>spring-boot-starter-data-jpa</artifactId>')) add('Spring Data JPA', null);
  if (pom.includes('<artifactId>spring-boot-starter-security</artifactId>')) add('Spring Security', null);
  if (pom.includes('<artifactId>spring-cloud-starter-openfeign</artifactId>')) add('Spring Cloud OpenFeign', property('spring-cloud.version'));
  return technologies;
}

function frontendTechnologies(pkg) {
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const technologies = [
    ['React', 'react'],
    ['Refine', '@refinedev/core'],
    ['Vite', 'vite'],
    ['TypeScript', 'typescript'],
    ['Tailwind CSS', 'tailwindcss'],
    ['shadcn', 'shadcn'],
  ].filter(([, dependency]) => dependencies[dependency])
    .map(([name, dependency]) => ({ name, version: dependencies[dependency] }));
  if (pkg.packageManager) technologies.push({ name: 'Package manager', version: pkg.packageManager });
  return technologies;
}

function normalizeEnvironment(items = []) {
  return items.map((item) => ({
    name: item.name,
    value: redactValue(item.value ?? ''),
    required: /:\\?/.test(String(item.value ?? '')),
  }));
}

function normalizeHealthCheck(healthCheck) {
  if (!healthCheck) return null;
  return {
    path: healthCheck.path ?? '',
    command: healthCheck.command ?? '',
    port: healthCheck.port ?? null,
    intervalSeconds: healthCheck.intervalSeconds ?? null,
    timeoutSeconds: healthCheck.timeoutSeconds ?? null,
    retries: healthCheck.retries ?? null,
  };
}

function redactValue(value) {
  const text = String(value);
  if (/PASSWORD|TOKEN|KEY|SECRET|CREDENTIAL/i.test(text)) {
    return text.replace(/:-[^}]+/g, ':-***').replace(/:\\?[^}]+/g, ':?***');
  }
  return text
    .replace(/\\$\\{POSTGRES_USER:-medol\\}/gu, '\${POSTGRES_USER:-<db_user>}')
    .replace(/\\$\\{POSTGRES_DB:-medol\\}/gu, '\${POSTGRES_DB:-<db_name>}')
    .replace(/:-medol/gu, ':-<value>');
}

function classifyFile(file) {
  if (/docker-compose.*\\.ya?ml$/u.test(file)) return 'docker-compose';
  if (/k3s/u.test(file)) return 'k3s';
  if (/kubernetes/u.test(file)) return 'kubernetes';
  if (/Dockerfile/u.test(file)) return 'dockerfile';
  if (/\\.env-example$/u.test(file)) return 'environment-example';
  if (extname(file) === '.json') return 'json';
  if (extname(file) === '.md') return 'markdown';
  return 'file';
}

function summarizeFile(file, content) {
  if (/\\.env-example$/u.test(file)) {
    const keys = content
      .split(/\\r?\\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=')[0].trim())
      .filter(Boolean);
    return \`\${keys.length} environment variable(s): \${keys.slice(0, 12).join(', ')}\${keys.length > 12 ? ', ...' : ''}\`;
  }
  if (/Dockerfile/u.test(file)) {
    const from = content.match(/^FROM\\s+(.+)$/mu)?.[1] ?? 'unknown base image';
    return \`Docker image build file, base \${from}.\`;
  }
  if (/docker-compose.*\\.ya?ml$/u.test(file)) {
    const services = [...content.matchAll(/^\\s{2}([a-zA-Z0-9_.-]+):\\s*$/gmu)].map((match) => match[1]);
    return \`Docker Compose file with service(s): \${services.slice(0, 12).join(', ')}\${services.length > 12 ? ', ...' : ''}\`;
  }
  const heading = content.match(/^#\\s+(.+)$/mu)?.[1];
  return heading ? \`Documentation: \${heading}.\` : \`\${basename(file)} (\${content.length} bytes).\`;
}

function deploymentModes(config) {
  const files = [
    config.dockerCompose,
    ...(config.operationsReadmes ?? []),
    ...(config.applicationFiles ?? []),
  ].filter(Boolean);
  const modes = [];
  if (files.some((file) => /docker-compose/u.test(file))) modes.push('Docker Compose');
  if (files.some((file) => /k3s/u.test(file))) modes.push('K3s');
  if (files.some((file) => /kubernetes/u.test(file))) modes.push('Kubernetes');
  return [...new Set(modes)];
}

function operationsCommands(config) {
  const environment = config.environment ?? 'dev';
  return [
    \`cp operations/docker-compose/\${environment}/.env-example operations/docker-compose/\${environment}/.env\`,
    \`docker compose --env-file operations/docker-compose/\${environment}/.env -f operations/docker-compose/\${environment}/docker-compose.yml up -d\`,
    \`node operations/images/\${environment}/images.mjs list\`,
    \`node operations/images/\${environment}/images.mjs all\`,
    \`kubectl apply -k operations/kubernetes/environments/\${environment}\`,
  ];
}

function securityNotes(applications) {
  const envNames = new Set(applications.flatMap((app) => app.environmentVariables.map((env) => env.name)));
  const notes = [];
  if (envNames.has('MEDOL_SECURITY_INTERNAL_TOKEN')) {
    notes.push('Service-to-service calls may use an internal bearer token configured per environment.');
  }
  if ([...envNames].some((name) => /ALLOWED_ORIGINS/u.test(name))) {
    notes.push('Browser access is constrained by configured CORS allowed origins.');
  }
  if ([...envNames].some((name) => /ADMIN_BOOTSTRAP/u.test(name))) {
    notes.push('Initial administrator setup is controlled by bootstrap environment variables.');
  }
  return notes;
}

function storageNotes(infrastructure, files) {
  const notes = [];
  const volumes = infrastructure.flatMap((item) => item.volumes ?? []);
  if (volumes.length) notes.push(\`Persistent volumes: \${[...new Set(volumes)].join(', ')}.\`);
  const datasetFiles = files.filter((file) => /DATASET|datasets|RUNTIME_AGENT_LOCAL_RUNTIME_ENGINE_DATASET/u.test(file.summary));
  if (datasetFiles.length) notes.push('Runtime dataset directories are configured through deployment environment files.');
  return notes;
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const [key, ...rest] = body.split('=');
    parsed[key] = rest.length ? rest.join('=') : 'true';
  }
  if (parsed.help) {
    console.log(\`Usage: node docs/document-support/\${basename(fileURLToPath(import.meta.url))} [options]

Options:
  --config=docs/document-support/config/engineering-facts-sources.json
  --out=docs/generated/facts/engineering-facts.json
\`);
    process.exit(0);
  }
  return parsed;
}

function fail(message) {
  console.error(\`[document-support] \${message}\`);
  process.exit(1);
}
`;
}

module.exports = {
    documentSupportFiles
};
