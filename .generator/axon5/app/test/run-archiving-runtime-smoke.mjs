import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../..');
const medol=process.env.MEDOL_SOURCE_ROOT ?? path.resolve(repo,'../medol');
const workspace=mkdtempSync(path.join(tmpdir(),'medol-archiving-'));
const source=path.join(workspace,'source.medol');
copyFileSync(path.join(here,'fixtures/archiving/source.medol'),source);
const json=execFileSync(process.execPath,['--import',path.join(medol,'node_modules/tsx/dist/loader.mjs'),path.join(medol,'src/lib/dslToCodegenModelCli.ts'),source],{encoding:'utf8'});
writeFileSync(path.join(workspace,'codegen-model.json'),json);
execFileSync(process.execPath,[path.join(repo,'gen.sh'),path.join(repo,'.generator/axon5/app'),'--generator-type','all','--output-root','axon5','--force','--skip-install'],{cwd:workspace,stdio:'inherit',env:{...process.env,CODEGEN_DEPLOYMENT:'',CODEGEN_DOMAIN:''}});
const target=path.join(workspace,'axon5/src/test/kotlin/tech/medo/archiving/infrastructure');
mkdirSync(target,{recursive:true});
copyFileSync(path.join(here,'fixtures/archiving/ArchivingRuntimeTest.kt'),path.join(target,'ArchivingRuntimeTest.kt'));
console.log(`Archiving runtime fixture: ${workspace}`);
runMaven();
function runMaven() {
let container;
try {
 if(process.argv.includes('--postgres')) {
  container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=test','-p','127.0.0.1::5432','postgres:16'],{encoding:'utf8'}).trim();
  let ready=false;
  for(let i=0;i<60;i++) {try {execFileSync('docker',['exec',container,'pg_isready','-U','postgres'],{stdio:'ignore'});ready=true;break;} catch {awaitSleep();}}
  if(!ready) throw new Error('PostgreSQL startup timeout');
  execFileSync('docker',['exec',container,'createdb','-U','postgres','archive_primary']);
  execFileSync('docker',['exec',container,'createdb','-U','postgres','archive_cold']);
  const port=execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  process.env.ARCHIVING_TEST_PRIMARY_URL=`jdbc:postgresql://127.0.0.1:${port}/archive_primary`;
  process.env.ARCHIVING_TEST_COLD_URL=`jdbc:postgresql://127.0.0.1:${port}/archive_cold?connectTimeout=5&socketTimeout=30`;
  process.env.ARCHIVING_TEST_USER='postgres';
 }
 execFileSync(process.env.MAVEN_BIN ?? 'mvn',['-q','-Dtest=ArchivingRuntimeTest','-Dsurefire.failIfNoSpecifiedTests=false','-Dkotlin.compiler.daemon=false','test'],{cwd:path.join(workspace,'axon5'),stdio:'inherit'});

} finally {if(container) execFileSync('docker',['rm','-f',container],{stdio:'ignore'});}
}
function awaitSleep() {Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
