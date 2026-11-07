import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageCompose, writePublishScript} from '../templates/package-compose.mjs';

test('packages all sites, excludes secrets and merges repeated deliveries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'compose-test-'));
    const put = (path, data) => { const file = join(root, path); mkdirSync(join(file, '..'), {recursive: true}); writeFileSync(file, data); };
    try {
        put('operations/model/test/operations-model.json', JSON.stringify({networkTopology: {sites: [{name: 'a'}, {name: 'b'}]}}));
        for (const name of ['a', 'b']) {
            const site = `operations/docker-compose/test/sites/${name}`;
            put(`${site}/docker-compose.yml`, 'services: {}\n');
            put(`${site}/.env-example`, 'TOKEN=\n');
            put(`${site}/.env`, 'SECRET=do-not-copy');
            put(`${site}/gateway/config.yaml`, 'gateway: true');
            put(`${site}/gateway/private.yaml`, 'SECRET=do-not-copy');
            put(`operations/images/test/.work/image-bundle/images/${name}-backend-images.tar`, 'fixture');
            put(`operations/images/test/.work/image-bundle/images/${name}-dependency-images.tar`, 'fixture');
            put(`operations/images/test/.work/image-bundle/images/${name}-backend-images.tar.manifest.json`, JSON.stringify({images: [{name: 'fl/app:1'}]}));
            put(`operations/images/test/.work/image-bundle/images/${name}-dependency-images.tar.manifest.json`, JSON.stringify({images: [{name: 'postgres:16'}, {name: 'docker.io/rancher/pause:1'}]}));
        }
        const output = join(root, 'delivery');
        await packageCompose({root, environment: 'test', output});
        for (const site of ['a', 'b']) {
            assert.ok(existsSync(join(output, site, 'images', `${site}-backend-images.tar`)));
            assert.ok(!existsSync(join(output, site, '.env')));
            assert.ok(!existsSync(join(output, site, 'gateway/private.yaml')));
            assert.match(readFileSync(join(output, site, 'SHA256SUMS'), 'utf8'), /docker-compose.yml/);
            assert.equal(readFileSync(join(output, site, 'publish.tsv'), 'utf8'), 'docker.io/rancher/pause:1\t<REGISTRY>/rancher/pause:1\nfl/app:1\t<REGISTRY>/fl/app:1\npostgres:16\t<REGISTRY>/library/postgres:16\n');
            assert.match(readFileSync(join(output, site, 'SHA256SUMS'), 'utf8'), /publish.tsv/);
            assert.equal(spawnSync('bash', ['-n', join(output, site, 'install.sh')]).status, 0);
            assert.equal(spawnSync('bash', ['-n', join(output, site, 'publish.sh')]).status, 0);
        }
        put('delivery/a/.env', 'TOKEN=private');
        put('operations/docker-compose/test/sites/a/docker-compose.yml', 'services: {updated: {}}\n');
        await packageCompose({root, environment: 'test', output});
        assert.equal(readFileSync(join(output, 'a/.env'), 'utf8'), 'TOKEN=private');
        assert.equal(readFileSync(join(output, 'a/docker-compose.yml'), 'utf8'), 'services: {updated: {}}\n');
        symlinkSync(join(root, 'delivery'), join(root, 'operations/docker-compose/test/sites/a/gateway/link'));
        await assert.rejects(packageCompose({root, environment: 'test', site: 'a', output: join(root, 'invalid')}), /Symlink/);
        assert.ok(!existsSync(join(root, 'invalid')));
        await assert.rejects(packageCompose({root, environment: 'test', site: 'missing'}), /No matching/);
    } finally { rmSync(root, {recursive: true, force: true}); }
});

test('publish command loads then preflights and pushes, stopping on load failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'publish-test-'));
    try {
        mkdirSync(join(root, 'images'));
        mkdirSync(join(root, 'bin'));
        writeFileSync(join(root, 'images/app.tar'), 'fixture');
        writeFileSync(join(root, 'publish.tsv'), 'fl/app:1\t<REGISTRY>/fl/app:1\n');
        writeFileSync(join(root, 'SHA256SUMS'), '');
        writePublishScript(root);
        writeFileSync(join(root, 'bin/sha256sum'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
        writeFileSync(join(root, 'bin/docker'), '#!/bin/sh\necho "$*" >> "$LOG"\nif [ "$1" = load ] && [ "$FAIL_LOAD" = yes ]; then exit 1; fi\n', {mode: 0o755});
        const env = {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, LOG: join(root, 'log')};
        const run = spawnSync('bash', [join(root, 'publish.sh'), 'all', 'registry.example.com:5000'], {env});
        assert.equal(run.status, 0, run.stderr.toString());
        assert.equal(readFileSync(env.LOG, 'utf8'), 'load -i images/app.tar\nimage inspect fl/app:1\ntag fl/app:1 registry.example.com:5000/fl/app:1\npush registry.example.com:5000/fl/app:1\n');
        writeFileSync(env.LOG, '');
        assert.notEqual(spawnSync('bash', [join(root, 'publish.sh'), 'all', 'registry.example.com:5000'], {env: {...env, FAIL_LOAD: 'yes'}}).status, 0);
        assert.equal(readFileSync(env.LOG, 'utf8'), 'load -i images/app.tar\n');
        assert.notEqual(spawnSync('bash', [join(root, 'publish.sh'), 'push', 'http://registry.example.com:5000'], {env}).status, 0);
    } finally { rmSync(root, {recursive: true, force: true}); }
});
