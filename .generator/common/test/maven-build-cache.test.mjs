import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {createMavenBuildCache} from '../maven-build-cache.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'maven-cache-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const put = (name, value) => { const file = join(root, name); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, value); };
    put('pom.xml', '<project/>');
    put('app/src/main/kotlin/App.kt', 'class App');
    put('app/target/classes/App.class', 'compiled');
    const options = {root, modules: ['app'], toolchain: 'jdk21', env: {}, repository: join(root, '.medol/repository'), settingsRoot: join(root, '.medol/settings')};
    return {put, options, cache: createMavenBuildCache(options)};
}

test('compilation is architecture independent, image records are platform specific', t => {
    const {cache, put} = fixture(t);
    assert.equal(cache.valid(), false);
    cache.record();
    assert.equal(cache.valid(), true);
    const amd = cache.imageKey({platform: 'linux/amd64'});
    const arm = cache.imageKey({platform: 'linux/arm64'});
    assert.notEqual(amd, arm);
    cache.recordImage(amd, {Id: 'image1'});
    assert.equal(cache.imageMatches(amd, {Id: 'image1'}), true);
    assert.equal(cache.imageMatches(arm, {Id: 'image1'}), false);
    assert.equal(cache.imageMatches(amd, {Id: 'replaced'}), false);
    put('app/src/main/resources/META-INF/medol-build.json', 'new platform metadata');
    put('app/target/classes/META-INF/medol-build.json', 'new platform metadata');
    assert.equal(cache.valid(), true);
    assert.equal(cache.imageKey({platform: 'linux/amd64'}), amd);
});

for (const name of ['pom.xml', 'app/src/main/kotlin/App.kt', 'app/src/main/resources/application.yml', 'app/target/classes/App.class', '.medol/repository/dependency.jar', '.medol/settings/settings.xml']) {
    test(`invalidates on changes to ${name}`, t => {
        const {cache, put} = fixture(t);
        cache.record();
        put(name, 'changed');
        assert.equal(cache.valid(), false);
    });
}

test('toolchain changes invalidate compilation and locks prevent concurrent writers', t => {
    const {cache, options} = fixture(t);
    cache.record();
    assert.equal(createMavenBuildCache({...options, toolchain: 'jdk22'}).valid(), false);
    cache.withLock(() => assert.throws(() => cache.withLock(() => {}), /EEXIST/));
    cache.withLock(() => {});
    rmSync(join(options.root, 'app/target'), {recursive: true});
    assert.equal(cache.valid(), false);
    assert.throws(() => cache.record(), /did not produce/);
});
