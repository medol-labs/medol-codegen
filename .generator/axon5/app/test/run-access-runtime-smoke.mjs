import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {writeAccessSupport, writeBusinessAccessSource} = require('../access-policy');
const workspace = mkdtempSync(join(tmpdir(), 'medol-access-runtime-'));
const write = (file, value) => { mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, value); };
const main = join(workspace, 'src/main/kotlin');
const enabled = !process.argv.includes('--disabled');
const generator = {model: {...(enabled ? {dataAccess: {enabled: true}} : {}), rootPackage: 'example', accessPolicies: [{name: 'Participants', rules: [{kind: 'scope', field: 'organizationId', source: 'People.Members.organizationId', subjectField: 'userId', subjectSource: 'identity.userId'}]}]}, fs: {write}, _sharedKernelKotlinPath: p => join(main, 'example', p), _sharedKernelResourcePath: p => join(workspace, 'src/main/resources', p)};
writeAccessSupport(generator);
Object.assign(generator, require('../read-model-writer').readModelWriterMethods);
generator._writeDataExportSupport();
writeBusinessAccessSource(generator, {context: 'People', readmodel: {name: 'Members', fields: [{name: 'userId', type: 'UUID'}, {name: 'organizationId', type: 'UUID'}, {name: 'state', type: 'String'}], eligibility: [{operator: 'AND', conditions: [{left: 'state', operator: '==', right: 'Active'}]}]}, packageName: 'example', entityName: 'MemberEntity', path: join(main, 'example/MemberEntityAccessScopeSource.kt'), scoped: false});
for (const file of ['CurrentUser.kt', 'CurrentUserProvider.kt']) write(join(main, 'example/shared/security', file), readFileSync(join(here, '../templates/security', `${file}.tpl`), 'utf8').replaceAll('<%= rootPackage %>', 'example'));
write(join(main, 'example/Entities.kt'), readFileSync(join(here, 'fixtures/access/Entities.kt'), 'utf8'));
const testFile = enabled ? 'AccessRuntimeTest.kt' : 'DisabledAccessRuntimeTest.kt';
write(join(workspace, 'src/test/kotlin/example', testFile), readFileSync(join(here, 'fixtures/access', testFile), 'utf8'));
write(join(workspace, 'pom.xml'), `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.5.11</version></parent><groupId>example</groupId><artifactId>access-runtime</artifactId><version>1</version><properties><java.version>21</java.version><kotlin.version>2.3.20</kotlin.version></properties><dependencies>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
<dependency><groupId>org.springframework.security</groupId><artifactId>spring-security-core</artifactId></dependency>
<dependency><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-stdlib</artifactId></dependency>
<dependency><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-reflect</artifactId></dependency>
<dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><scope>test</scope></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
</dependencies><build><sourceDirectory>src/main/kotlin</sourceDirectory><testSourceDirectory>src/test/kotlin</testSourceDirectory><plugins><plugin><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-maven-plugin</artifactId><configuration><jvmTarget>21</jvmTarget></configuration><executions><execution><id>compile</id><goals><goal>compile</goal></goals></execution><execution><id>test-compile</id><goals><goal>test-compile</goal></goals></execution></executions></plugin></plugins></build></project>`);
console.log(`Access runtime fixture: ${workspace}`);
execFileSync('mvn', ['-o', '-q', 'test'], {cwd: workspace, stdio: 'inherit', env: {...process.env, MAVEN_OPTS: `${process.env.MAVEN_OPTS ?? ''} -Dkotlin.compiler.daemon=false`}});
