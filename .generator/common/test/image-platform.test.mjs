import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformCache, platformReference} from '../image-platform-runtime.mjs';

function fixture() {
    const amd = {Id: 'amd-id', Os: 'linux', Architecture: 'amd64'};
    const arm = {Id: 'arm-id', Os: 'linux', Architecture: 'arm64'};
    const images = new Map([['db:16', amd], ['amd-id', amd], ['arm-id', arm]]);
    const calls = [];
    const cache = createPlatformCache({log() {}, execute(args) {
        calls.push(args);
        if (args[0] === 'info') return 'linux/x86_64';
        if (args[0] === 'image' && args[1] === 'inspect') return images.has(args[2]) ? JSON.stringify([images.get(args[2])]) : undefined;
        if (args[0] === 'tag') { images.set(args[2], images.get(args[1])); return ''; }
        if (args[0] === 'pull') { images.set(args[3], args[2] === 'linux/arm64' ? arm : amd); return ''; }
        if (args[1] === 'rm') { images.delete(args[2]); return ''; }
        throw Error('Unexpected Docker command');
    }});
    return {cache, images, calls};
}
test('native architecture comes from Docker and a cache hit never pulls', () => {
    const {cache, calls} = fixture();
    assert.equal(cache.nativePlatform(), 'linux/amd64');
    cache.ensure('db:16', 'linux/amd64');
    cache.ensure('db:16', 'linux/amd64');
    assert.equal(calls.filter(c => c[0] === 'pull').length, 0);
});
test('cross-architecture pull preserves the original tag and survives repeated selection', () => {
    const {cache, images, calls} = fixture();
    cache.ensure('db:16', 'linux/arm64');
    cache.ensure('db:16', 'linux/arm64');
    assert.equal(calls.filter(c => c[0] === 'pull').length, 1);
    assert.equal(images.get('db:16').Architecture, 'amd64');
    cache.withImages(['db:16'], 'linux/arm64', () => assert.equal(images.get('db:16').Architecture, 'arm64'));
    assert.equal(images.get('db:16').Architecture, 'amd64');
});
test('failed asynchronous export restores original tags', async () => {
    const {cache, images} = fixture();
    cache.ensure('db:16', 'linux/arm64');
    await assert.rejects(cache.withImages(['db:16'], 'linux/arm64', async () => {throw Error('save failed');}), /save failed/);
    assert.equal(images.get('db:16').Architecture, 'amd64');
});
test('export fails closed for a missing platform and refresh is explicit', () => {
    const {cache, calls} = fixture();
    assert.throws(() => cache.withImages(['db:16'], 'linux/arm64', () => assert.fail()), /Missing cached/);
    cache.ensure('db:16', 'linux/amd64', {refresh: true});
    assert.equal(calls.filter(c => c[0] === 'pull').length, 1);
    assert.notEqual(platformReference('db:16', 'linux/amd64'), platformReference('db:16', 'linux/arm64'));
});
test('select switches cached architectures without downloads', () => {
    const {cache, calls, images} = fixture();
    cache.ensure('db:16', 'linux/arm64');
    cache.activate(['db:16'], 'linux/arm64');
    cache.activate(['db:16'], 'linux/amd64');
    assert.equal(images.get('db:16').Architecture, 'amd64');
    assert.equal(calls.filter(c => c[0] === 'pull').length, 1);
});

test('an externally updated public tag supersedes the older platform cache', () => {
    const {cache, images} = fixture();
    cache.pin('db:16');
    const updated = {Id: 'new-amd', Os: 'linux', Architecture: 'amd64'};
    images.set('new-amd', updated);
    images.set('db:16', updated);
    cache.activate(['db:16'], 'linux/amd64');
    assert.equal(images.get('db:16').Id, 'new-amd');
    assert.equal(images.get(platformReference('db:16', 'linux/amd64')).Id, 'new-amd');
});

test('same-platform refresh keeps the newly pulled public tag', () => {
    const {cache, images} = fixture();
    const old = {Id: 'old-amd', Os: 'linux', Architecture: 'amd64'};
    images.set('old-amd', old);
    images.set('db:16', old);
    cache.ensure('db:16', 'linux/amd64', {refresh: true});
    assert.equal(images.get('db:16').Id, 'amd-id');
});
