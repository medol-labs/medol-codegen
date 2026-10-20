const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function fixture(local = {}) {
    const api = await import('../image-config-runtime.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-source-'));
    fs.writeFileSync(path.join(dir, 'operations-model.json'), JSON.stringify({imagePrefix: 'team', imageTag: 'v1'}));
    fs.writeFileSync(path.join(dir, 'operations-model.local.json'), JSON.stringify(local));
    return {api, config: (options = {}) => api.resolveImageConfig(dir, {env: {}, ...options}), close: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('environment registry configuration is shared by build and deployment and supports another environment', async () => {
    for (const host of ['localhost:5000', 'registry.test.example', '[::1]:5001']) {
        const f = await fixture({registry: {host, namespace: 'team'}});
        try {
            const c = f.config();
            assert.equal(c.imagePrefix, `${host}/team`);
            assert.equal(c.buildPrefix, c.imagePrefix);
            assert.equal(c.mode, 'registry');
            assert.equal(c.version, 'v1');
        } finally { f.close(); }
    }
});

test('explicit overrides have precedence and invalid acquisition modes fail clearly', async () => {
    const f = await fixture({registry: {host: 'old.example', namespace: 'team'}});
    try {
        const c = f.config({prefix: 'new.example/group', version: 'v2', env: {DOCKER_IMAGE_PREFIX: 'ignored.example/team'}});
        assert.equal(c.imagePrefix, 'new.example/group');
        assert.equal(c.buildPrefix, c.imagePrefix);
        assert.equal(c.version, 'v2');
        assert.throws(() => f.config({mode: 'auto'}), /import or registry/);
        assert.throws(() => f.config({prefix: 'team', mode: 'registry'}), /registry-qualified/);
    } finally { f.close(); }
});

test('registry mode pulls the configured host address and deploys the same digest under the node address', async () => {
    const f = await fixture({registry: {host: 'registry.internal:5000', pushHost: 'localhost:5000', namespace: 'team'}});
    try {
        const c = f.config();
        const calls = [];
        const hash = 'a'.repeat(64);
        const result = f.api.resolveImageArtifact(c, 'registry.internal:5000/team/app:v1', {
            pull: (ref) => calls.push(ref),
            inspect: (ref) => ({Id: 'sha256:new', RepoDigests: [`localhost:5000/team/app@sha256:${hash}`]}),
            tag: () => assert.fail('Registry mode must not retag or push local images'),
        });
        assert.deepEqual(calls, ['localhost:5000/team/app:v1']);
        assert.equal(result.reference, `registry.internal:5000/team/app@sha256:${hash}`);
        assert.equal(result.id, 'sha256:new');
    } finally { f.close(); }
});

test('import mode never falls back to another prefix or pulls from a registry', async () => {
    const f = await fixture({registry: {host: 'registry.example', namespace: 'team'}, imageSource: 'import'});
    try {
        const inspected = [];
        const io = {pull: () => assert.fail('Unexpected pull'), tag: () => assert.fail('Unexpected retag'),
            inspect: (ref) => { inspected.push(ref); return ref.startsWith('team/') ? {Id: 'sha256:stale'} : null; }};
        assert.throws(() => f.api.resolveImageArtifact(f.config(), 'registry.example/team/app:v1', io), /no alternate prefix/);
        assert.deepEqual(inspected, ['registry.example/team/app:v1']);
        const result = f.api.resolveImageArtifact(f.config(), 'registry.example/team/app:v1', {...io, inspect: () => ({Id: 'sha256:new'})});
        assert.equal(result.reference, 'registry.example/team/app:v1');
    } finally { f.close(); }
});

test('registry mode refuses an absent or unrelated manifest digest', async () => {
    const f = await fixture({registry: {host: 'registry.example', namespace: 'team'}});
    try {
        assert.throws(() => f.api.resolveImageArtifact(f.config(), 'registry.example/team/app:v1', {
            pull() {}, inspect: () => ({Id: 'sha256:local', RepoDigests: ['other.example/team/app@sha256:' + 'b'.repeat(64)]}),
        }), /verifiable digest/);
    } finally { f.close(); }
});

test('an unpublished newer local build is preserved and cannot be silently replaced by an older registry image', async () => {
    const f = await fixture({registry: {host: 'registry.example', namespace: 'team'}});
    try {
        let pulled = false;
        const tags = [];
        assert.throws(() => f.api.resolveImageArtifact(f.config(), 'registry.example/team/app:v1', {
            pull: () => { pulled = true; },
            inspect: () => pulled ? {Id: 'old', Created: '2026-01-01T00:00:00Z'} : {Id: 'new', Created: '2026-01-02T00:00:00Z'},
            tag: (...args) => tags.push(args),
        }), /Push the new build first/);
        assert.deepEqual(tags, [['new', 'registry.example/team/app:v1']]);
    } finally { f.close(); }
});
