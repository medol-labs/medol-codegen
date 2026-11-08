import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(['--calendar','--tenant','--reporting'].filter(f=>process.argv.includes(f)).length>1) throw new Error('Calendar and tenant fixtures are separate');
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../..');
const medol=process.env.MEDOL_SOURCE_ROOT ?? path.resolve(repo,'../medol');
const workspace=mkdtempSync(path.join(tmpdir(),'medol-management-'));
if(process.argv.includes('--isolated') && (!process.argv.includes('--postgres') || !process.argv.includes('--tenant'))) throw new Error('--isolated requires --tenant --postgres');
const fixture=process.argv.includes('--reporting')?'reporting':process.argv.includes('--calendar')?'business-calendar':process.argv.includes('--tenant')?'configuration-tenant':'management';
const testClass=process.argv.includes('--reporting')?'ReportingRuntimeTest':process.argv.includes('--calendar')?'BusinessCalendarRuntimeTest':process.argv.includes('--tenant')?'ConfigurationTenantRuntimeTest':'ManagementRuntimeTest';
const source=path.join(workspace,'source.medol');
copyFileSync(path.join(here,`fixtures/${fixture}/source.medol`),source);
const json=execFileSync(process.execPath,['--import',path.join(medol,'node_modules/tsx/dist/loader.mjs'),path.join(medol,'src/lib/dslToCodegenModelCli.ts'),source],{encoding:'utf8'});
writeFileSync(path.join(workspace,'codegen-model.json'),json);
execFileSync(process.execPath,[path.join(repo,'gen.sh'),path.join(repo,'.generator/axon5/app'),'--generator-type','all','--output-root','axon5','--force','--skip-install'],{cwd:workspace,stdio:'inherit',env:{...process.env,CODEGEN_DEPLOYMENT:'',CODEGEN_DOMAIN:''}});
const target=path.join(workspace,'axon5/src/test/kotlin/tech/medo/management/infrastructure');
mkdirSync(target,{recursive:true});
copyFileSync(path.join(here,`fixtures/${fixture}/${testClass}.kt`),path.join(target,`${testClass}.kt`));
console.log(`Management runtime fixture: ${workspace}`);
runMaven();
function runMaven() {
let container;
try {
 if(process.argv.includes('--postgres')) {
  container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=test','-p','127.0.0.1::5432','postgres:16'],{encoding:'utf8'}).trim();
  let ready=false;
  for(let i=0;i<60;i++) {try {execFileSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'});ready=true;break;} catch {awaitSleep();}}
  if(!ready) throw new Error('PostgreSQL startup timeout');
  execFileSync('docker',['exec',container,'createdb','-h','127.0.0.1','-U','postgres','management_primary']);
  const port=execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  process.env.MANAGEMENT_TEST_PRIMARY_URL=`jdbc:postgresql://127.0.0.1:${port}/management_primary`;
  process.env.MANAGEMENT_TEST_USER='postgres';
  if(process.argv.includes('--isolated')) {
   process.env.MANAGEMENT_TEST_ISOLATED='true';
   const sql=readFileSync(path.join(repo,'.generator/axon5/app/templates/V1__baseline.sql'),'utf8')+'\n'+readFileSync(path.join(here,'fixtures/configuration-tenant/control.sql'),'utf8')+'\n'+readFileSync(path.join(repo,'.generator/axon5/app/templates/management/V2026110804__management.sql'),'utf8');
   execFileSync('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-d','management_primary','-v','ON_ERROR_STOP=1'],{input:sql,stdio:['pipe','ignore','inherit']});
  }
 }
 execFileSync(process.env.MAVEN_BIN ?? 'mvn',['-q',...(process.argv.includes('--isolated')?['-Dmedol.tenancy.mode=SEPARATE_SCHEMA']:[]),`-Dtest=${testClass}`,'-Dsurefire.failIfNoSpecifiedTests=false','-Dkotlin.compiler.daemon=false','test'],{cwd:path.join(workspace,'axon5'),stdio:'inherit'});

} finally {if(container) execFileSync('docker',['rm','-f',container],{stdio:'ignore'});}
}
function awaitSleep() {Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
