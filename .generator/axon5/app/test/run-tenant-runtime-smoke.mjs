import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const medol = process.env.MEDOL_SOURCE_ROOT ?? path.resolve(repo, '../medol');
const require = createRequire(path.join(repo, '.generator/package.json'));
const workspace = mkdtempSync(path.join(tmpdir(), 'medol-same-schema-'));
const source = readFileSync(path.join(here, 'fixtures/tenant-isolation.medol'), 'utf8');
const exportModel = (text, cwd) => {
    mkdirSync(cwd, {recursive: true});
    const input = path.join(cwd, 'source.medol');
    writeFileSync(input, text);
    const json = execFileSync(process.execPath, ['--import', path.join(medol, 'node_modules/tsx/dist/loader.mjs'), path.join(medol, 'src/lib/dslToCodegenModelCli.ts'), input], {encoding: 'utf8'});
    writeFileSync(path.join(cwd, 'codegen-model.json'), json);
    return JSON.parse(json);
};
const generate = (cwd, deployment = '') => execFileSync(process.execPath, [path.join(repo, 'gen.sh'), path.join(repo, '.generator/axon5/app'), '--generator-type', 'all', '--output-root', 'axon5', '--force', '--skip-install'], {
    cwd, stdio: 'inherit', env: {...process.env, CODEGEN_DEPLOYMENT: deployment, CODEGEN_DOMAIN: ''}
});
const enabled = path.join(workspace, 'enabled');
assert(exportModel(source, enabled).tenancy);
generate(enabled);
const test = path.join(enabled, 'axon5/business/src/test/kotlin/tech/medo/tenancy/TenantStorageIsolationTest.kt');
mkdirSync(path.dirname(test), {recursive: true});
writeFileSync(test, require('ejs').render(readFileSync(path.join(here, 'fixtures/TenantStorageIsolationTest.kt.tpl'), 'utf8'), {rootPackage: 'tech.medo'}));
writeFileSync(path.join(path.dirname(test), 'TenantCommandIsolationIntegrationTest.kt'), require('ejs').render(readFileSync(path.join(here, 'fixtures/TenantCommandIsolationIntegrationTest.kt.tpl'), 'utf8'), {
    rootPackage: 'tech.medo', tenantFixture: require(path.join(here, '../tenant-support.js')).tenantTestFixture({rootPackage: 'tech.medo', tenancy: {enabled: true}})
}));
const controlTest = path.join(enabled, 'axon5/support/src/test/kotlin/tech/medo/tenancy/TenantControlPlaneBootstrapTest.kt');
mkdirSync(path.dirname(controlTest), {recursive: true});
writeFileSync(controlTest, require('ejs').render(readFileSync(path.join(here, 'fixtures/TenantControlPlaneBootstrapTest.kt.tpl'), 'utf8'), {rootPackage: 'tech.medo'}));
for (const module of ['business', 'support']) {
    const mockMaker = path.join(enabled, `axon5/${module}/src/test/resources/mockito-extensions/org.mockito.plugins.MockMaker`);
    mkdirSync(path.dirname(mockMaker), {recursive: true});
    writeFileSync(mockMaker, 'mock-maker-subclass\n');
}
execFileSync('mvn', [...(process.argv.includes('--offline') ? ['-o'] : []), '-q', '-Dkotlin.compiler.daemon=false', '-Dtest=SameSchemaTenantRuntimeTest,TenantStorageIsolationTest,TenantCommandIsolationIntegrationTest,TenantControlPlaneBootstrapTest,CreateRecordDecisionTest,CreateRecordIntegrationTest,*ApplicationTest', '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], {cwd: path.join(enabled, 'axon5'), stdio: 'inherit'});
const disabled = path.join(workspace, 'disabled');
const disabledSource = source.replace(/^import tenant-management[^\n]*\n/m, '');
assert.equal(exportModel(disabledSource, disabled).tenancy, undefined);
generate(disabled);
const files = (directory) => readdirSync(directory, {withFileTypes: true}).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
assert(!files(path.join(disabled, 'axon5')).some((file) => /TenantScope\.kt|TenantCapabilityConfiguration\.kt|SameSchemaTenantAccess\.kt/.test(file)));
assert(existsSync(test));
const selected = path.join(workspace, 'selected');
exportModel(source, selected);
generate(selected, 'Business');
const selectedBootstrap = path.join(selected, 'axon5/src/main/kotlin/tech/medo/infrastructure/tenancy/TenantCapabilityConfiguration.kt');
assert(readFileSync(selectedBootstrap, 'utf8').includes('tenant_management_tenant_catalog'));
exportModel(disabledSource, selected);
generate(selected, 'Business');
assert(!existsSync(selectedBootstrap));
assert(!files(path.join(selected, 'axon5')).some((file) => file.includes('/shared/application/tenancy/')));
console.log(`Tenant runtime smoke passed: ${workspace}`);
