const YAML = require('yaml');
const {dockerComposeFiles} = require('./docker-compose-renderer');

function localDevelopmentFiles(model) {
    const root = 'operations/local';
    const original = dockerComposeFiles(model, 'local', {root});
    const compose = YAML.parse(original[`${root}/docker-compose.yml`]);
    const infrastructure = new Set(model.infrastructure.map((component) => component.name));
    compose.name = `${model.name}-host-local`;
    compose.services = Object.fromEntries(Object.entries(compose.services).filter(([name]) => infrastructure.has(name)));
    for (const service of Object.values(compose.services)) {
        service.ports = service.ports?.map((port) => `127.0.0.1:${port}`);
    }
    const files = {
        [`${root}/docker-compose.yml`]: YAML.stringify(compose),
        [`${root}/.env-example`]: original[`${root}/.env-example`] + [
            '',
            '# Host application authentication. Development only; replace outside local development.',
            '# The host launcher must export these values; Compose does not inject them into host processes.',
            'MEDOL_SECURITY_ADMIN_BOOTSTRAP_ENABLED=true',
            'MEDOL_SECURITY_ADMIN_BOOTSTRAP_SETUP_TOKEN=local-admin-setup',
            'MEDOL_SECURITY_INTERNAL_TOKEN=local-dev-internal-token',
            ''
        ].join('\n'),
        [`${root}/.gitignore`]: '.env\n*.local.env\n.work/\n',
        [`${root}/README.md`]: [
            '# Local Host Development', '',
            'Only infrastructure runs in Docker. Run backend and frontend source code on the host.',
            'This is separate from operations/docker-compose/local, which containerizes applications too.', '',
            '## Start infrastructure', '',
            '```bash', 'cd operations/local', 'cp -n .env-example .env',
            '# Set POSTGRES_PASSWORD and check published ports in .env.',
            'docker compose --env-file .env config --quiet',
            'docker compose --env-file .env up -d', 'docker compose ps', '```', '',
            'Ports bind to loopback only. Do not run another stack on the same ports.',
            'PostgreSQL initialization scripts execute only for a new data volume.', '',
            '## Run applications', '',
            'Use the project-owned host launcher when provided. Otherwise run Maven Wrapper',
            'and the frontend development server from their source directories.',
            'Disable Spring Docker Compose integration with SPRING_DOCKER_COMPOSE_ENABLED=false.',
            'Use localhost database/event-store addresses and explicit SERVER_PORT values.',
            'A Compose .env file is not automatically loaded into host application processes.', '',
            '| Backend | Host port |', '| --- | --- |',
            ...model.applications.filter((app) => app.kind === 'backend').map((app) => `| ${app.name} | ${app.servicePort} |`), '',
            '## Stop and diagnose', '', '```bash', 'docker compose logs --tail=100',
            'docker compose down', '```', '',
            'down preserves data. down -v permanently deletes this stack\'s database and event volumes.',
            'Training runtimes and other business-specific processes require project-owned configuration.', ''
        ].join('\n')
    };
    for (const [file, content] of Object.entries(original)) {
        if (file.includes('/infrastructure/') || file.includes('/configuration/')) files[file] = content;
    }
    return files;
}

module.exports = {localDevelopmentFiles};
