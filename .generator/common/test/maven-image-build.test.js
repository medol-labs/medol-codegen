const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const ejs = require('../../node_modules/ejs');

test('Maven entry point reuses compilation across architectures and images across repeats', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maven-image-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const put = (name, value, mode) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, value, {mode}); };
    const common = path.resolve(__dirname, '..');
    put('scripts/image-bundle.mjs', ejs.render(fs.readFileSync(path.join(common, '../axon5/app/templates/image-bundle.mjs.tpl'), 'utf8'), {imageModules: ['app'], imageTarName: 'images.tar'}));
    put('scripts/cache.mjs', fs.readFileSync(path.join(common, 'maven-build-cache.mjs')));
    put('scripts/maven-build-cache.mjs', `import {createMavenBuildCache as create} from './cache.mjs';
export const createMavenBuildCache = options => create({...options, repository: options.root+'/.medol/repository', settingsRoot: options.root+'/.medol/settings'});`);
    put('scripts/image-archive-runtime.mjs', 'export const writeArchiveManifest=()=>{}, verifyArchiveManifest=()=>{}, verifyLoadedImages=()=>{};');
    put('scripts/release-runtime.mjs', `import fs from 'node:fs'; import path from 'node:path';
export const defaultImageVersion=()=> 'dev';
export const prepareRelease=()=>({manifest:{},labels:{build:'test'},jibArgs:[],embed(files){for(const file of files){fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,'{}');}},writeManifest(){}});`);
    put('scripts/image-platform-runtime.mjs', `import fs from 'node:fs';
const read=()=>fs.existsSync('.medol/images.json')?JSON.parse(fs.readFileSync('.medol/images.json')):{};
export const createPlatformCache=()=>({nativePlatform:()=> 'linux/amd64',find:(name,platform)=>read()[platform],pin:()=>read().latest,activate(){}});`);
    put('pom.xml', '<project/>');
    put('app/pom.xml', '<project/>');
    put('app/src/main/kotlin/App.kt', 'class App');
    put('mvnw', `#!/usr/bin/env node
const fs=require('fs'); const args=process.argv.slice(2);
if(args.includes('-v')) {console.log('Maven test JDK21');process.exit(0);}
fs.appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');
if(args.includes('install')) {fs.mkdirSync('app/target/classes/META-INF',{recursive:true}); fs.writeFileSync('app/target/classes/App.class',fs.readFileSync('app/src/main/kotlin/App.kt'));}
else {const arch=args.find(x=>x.startsWith('-Djib.container.platform.architecture=')).split('=')[1];const file='.medol/images.json';const images=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{}; images.latest={Id:'image-'+arch,Config:{Labels:{build:'test'}}};images['linux/'+arch]=images.latest;fs.writeFileSync(file,JSON.stringify(images));}
`, 0o755);
    const run = (...args) => spawnSync(process.execPath, ['scripts/image-bundle.mjs', 'build', ...args], {cwd: root, encoding: 'utf8', env: {...process.env, FAST_IMAGE_BUILD: '', FORCE_IMAGE_BUILD: ''}});
    const calls = () => fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    for (const [arch, count] of [['amd64', 2], ['amd64', 2], ['arm64', 3], ['amd64', 3]]) {
        const result = run('--platform', 'linux/'+arch);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(calls().length, count);
    }
    assert.equal(calls().filter(a => a.includes('install')).length, 1);
    put('app/src/main/kotlin/App.kt', 'class Changed');
    let result = run('--platform', 'linux/arm64', '--skip-install');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verified unchanged/);
    result = run('--platform', 'linux/arm64');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls().length, 5);
    result = run('--platform', 'linux/arm64', '--force-build');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls().length, 7);
});
