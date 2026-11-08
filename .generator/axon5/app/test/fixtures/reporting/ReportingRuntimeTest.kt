package tech.medo.management.infrastructure

import java.util.UUID
import java.time.Instant
import java.nio.file.Files
import java.math.BigDecimal
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.AccessDeniedException
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.commandhandling.GenericCommandMessage
import org.axonframework.messaging.core.MessageType
import tech.medo.reporting.createreportdefinition.CreateReportDefinitionCommand
import tech.medo.reporting.publishreportdefinition.PublishReportDefinitionCommand

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:management;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;INIT=CREATE DOMAIN IF NOT EXISTS BLOB AS BYTEA","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=test","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.management.outbox-delay-ms=3600000"])
@Import(ReportingRuntimeTest.Providers::class)
class ReportingRuntimeTest @Autowired constructor(private val reports:ReportingService,private val worker:ReportingWorker,private val store:ManagementStore,
 private val mapper:ObjectMapper,private val jdbc:JdbcTemplate,private val gateway:CommandGateway,private val publisher:ManagementOutboxPublisher,private val provider:SampleReportProvider) {
 companion object {
  @JvmStatic @org.springframework.test.context.DynamicPropertySource fun database(r:org.springframework.test.context.DynamicPropertyRegistry) {
   r.add("medol.reporting.storage-path") {System.getProperty("java.io.tmpdir")+"/medol-report-test-"+ProcessHandle.current().pid()}
   System.getenv("MANAGEMENT_TEST_PRIMARY_URL")?.let {url->r.add("spring.datasource.url"){url};r.add("spring.datasource.driver-class-name"){"org.postgresql.Driver"};r.add("spring.datasource.username"){"postgres"}}
  }
 }
 @TestConfiguration class Providers {@Bean fun sampleReport(mapper:ObjectMapper)=SampleReportProvider(mapper)}
 class SampleReportProvider(private val mapper:ObjectMapper):ReportProvider {
  override val key="sample"
  override val contract=ReportContract("v1",listOf(ReportField("note","Note",ReportValueType.STRING)),listOf(ReportField("label","Label",ReportValueType.STRING),ReportField("amount","Amount",ReportValueType.DECIMAL)))
  override var fingerprint="query-v1"
  var fail=false;var revoke=false;var closed=0;var onOpen:(()->Unit)?=null
  override fun authorize(actor:String,parameters:ObjectNode,action:ReportAction) {if(actor!="operator" || revoke) throw AccessDeniedException("Outside report scope")}
  private fun row(p:ObjectNode)=mapOf("label" to p["note"],"amount" to mapper.valueToTree<JsonNode>(BigDecimal("12345678901234567890.12")))
  override fun query(actor:String,parameters:ObjectNode,offset:Int,limit:Int)=ReportPage(if(offset==0) listOf(row(parameters)) else emptyList(),false,ReportSource("projection:42","EVENTUAL"))
  override fun openExport(actor:String,parameters:ObjectNode):ReportStream {
   onOpen?.also {onOpen=null;it()}
   return object:ReportStream {
    override val source=ReportSource("snapshot:42","SNAPSHOT");var sent=false
    override fun nextBatch(limit:Int):List<Map<String,JsonNode>> {check(!fail);if(sent)return emptyList();sent=true;return listOf(row(parameters))}
    override fun close() {closed++}
   }
  }
 }
 private fun setup() {
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_management_records'",Int::class.java)==0)
   javaClass.getResource("/db/migration/V2026110804__management.sql")!!.readText().split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_report_executions'",Int::class.java)==0)
   javaClass.getResource("/db/migration/V2026110806__reporting.sql")!!.readText().split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
  provider.fail=false;provider.revoke=false;provider.fingerprint="query-v1";provider.onOpen=null
 }
 private fun input(vararg fields:Pair<String,Any?>):ObjectNode=mapper.valueToTree(mapOf(*fields))
 private fun definition(id:UUID)=input("reportVersionId" to id,"reportKey" to id.toString(),"versionLabel" to "v1","reportName" to "Example","providerKey" to "sample","contractVersion" to "v1")
 private fun change(op:String,id:UUID,rev:Long)=reports.execute(op,input("reportVersionId" to id,"expectedRevision" to rev),"operator")
 private fun draft()=UUID.randomUUID().also {reports.execute("CreateReportDefinition",definition(it),"operator")}
 private fun published()=draft().also {change("PublishReportDefinition",it,1)}
 private fun request(report:UUID,note:String="business-private"):UUID=UUID.randomUUID().also {reports.execute("RequestReportExecution",input("executionId" to it,"reportVersionId" to report,"parametersJson" to input("note" to note).toString()),"operator")}
 private fun drain() {while(worker.processOne()) {}}
 @Test fun lifecycleFreezesContractsAndRetiredReportsRejectNewWorkButFinishAcceptedWork() {
  setup();val id=draft()
  assertThrows(IllegalArgumentException::class.java){request(id)}
  change("PublishReportDefinition",id,1)
  assertThrows(IllegalArgumentException::class.java){reports.execute("ReviseReportDefinition",definition(id).put("expectedRevision",2),"operator")}
  val job=request(id);change("RetireReportDefinition",id,2)
  assertThrows(IllegalArgumentException::class.java){request(id)}
  assertThrows(IllegalArgumentException::class.java){reports.query(id,"{}","operator",0,50)}
  drain();assertEquals("Completed",reports.status(job,"operator").path("state").asText())
 }
 @Test fun validatesParametersPaginationAndPermissionsBeforeReading() {
  setup();val id=published()
  for(raw in listOf("{}","{\"note\":1}","{\"note\":\"ok\",\"extra\":1}","{\"note\":\"a\",\"note\":\"b\"}","{\"note\":\"ok\"} {}"))
   assertThrows(IllegalArgumentException::class.java){reports.query(id,raw,"operator",0,50)}
  assertThrows(IllegalArgumentException::class.java){reports.query(id,"{}","operator",10001,50)}
  assertThrows(AccessDeniedException::class.java){reports.query(id,"{\"note\":\"ok\"}","intruder",0,50)}
  assertEquals("projection:42",reports.query(id,"{\"note\":\"ok\"}","operator",0,50).source.sourceVersion)
 }
 @Test fun csvIsCompletePreciseAndFormulaSafeAndDownloadsRecheckScopeAndHash() {
  setup();val id=published();val job=request(id,"  =SUM(1,2)\"\nnext")
  drain();val status=reports.status(job,"operator");assertEquals("Completed",status.path("state").asText());assertEquals(1L,status.path("rowCount").asLong())
  val file=worker.download(job,"operator");val csv=Files.readString(file)
  assertTrue(csv.contains("12345678901234567890.12"));assertTrue(csv.contains("'  =SUM(1,2)"));assertTrue(csv.contains("\"\""));assertTrue(csv.endsWith("\r\n"));assertTrue(provider.closed>0)
  assertThrows(AccessDeniedException::class.java){worker.download(job,"intruder")}
  assertTrue(reports.mine(id,"intruder",0,50).isEmpty())
  provider.revoke=true;assertThrows(AccessDeniedException::class.java){worker.download(job,"operator")};provider.revoke=false
  Files.writeString(file,"tampered");assertThrows(IllegalArgumentException::class.java){worker.download(job,"operator")}
 }
 @Test fun failedJobsRetryWithRevisionAndRecordNewAttemptWithoutLeakingParameters() {
  setup();val id=published();val job=request(id);provider.fail=true;drain()
  val failed=reports.status(job,"operator");assertEquals("Failed",failed.path("state").asText())
  assertFalse(failed.toString().contains("business-private"))
  assertThrows(IllegalArgumentException::class.java){reports.execute("RetryReportExecution",input("executionId" to job,"expectedRevision" to 1),"operator")}
  provider.fail=false;reports.execute("RetryReportExecution",input("executionId" to job,"expectedRevision" to failed.path("revision").asLong()),"operator")
  drain();assertEquals(2L,reports.status(job,"operator").path("attempt").asLong())
  assertEquals(0,jdbc.queryForObject("select count(*) from medol_management_outbox where capability='reporting' and payload_json like '%business-private%'",Int::class.java))
 }
 @Test fun expiredAttemptCannotOverwriteANewerRetry() {
  setup();val job=request(published())
  provider.onOpen={
   val row=requireNotNull(store.record("reporting",job));val retry=input("executionId" to job,"expectedRevision" to row.path("revision").asLong())
   assertThrows(IllegalArgumentException::class.java){reports.execute("RetryReportExecution",retry,"operator")}
   jdbc.update("update medol_report_executions set lease_until=CURRENT_TIMESTAMP - INTERVAL '1' MINUTE where id=?",job)
   reports.execute("RetryReportExecution",retry,"operator")
  }
  worker.processOne();assertEquals("Requested",reports.status(job,"operator").path("state").asText())
  drain();assertEquals("Completed",reports.status(job,"operator").path("state").asText());assertEquals(2L,reports.status(job,"operator").path("attempt").asLong())
 }
 @Test fun implementationChangesFailPendingJobsClosed() {
  setup();val job=request(published());provider.fingerprint="query-v2";drain();provider.fingerprint="query-v1"
  assertEquals("Failed",reports.status(job,"operator").path("state").asText())
 }
 @Test fun parameterParsingPreservesDecimalPrecisionAndRejectsDuplicateHttpFields() {
  setup()
  val raw="""{"parameters":{"amount":12345678901234567890.123456789},"offset":0,"limit":50}"""
  val request=mapper.readValue(raw,ReportingEndpoints.Query::class.java)
  assertEquals("12345678901234567890.123456789",request.parameters.path("amount").asText())
  assertEquals("12345678901234567890.123456789",reportJson(mapper,"""{"amount":12345678901234567890.123456789}""").path("amount").asText())
  assertThrows(Exception::class.java){mapper.readValue("""{"parameters":{"note":"a","note":"b"}}""",ReportingEndpoints.Query::class.java)}
 }
 @Test fun duplicateRequestsAreIdempotentUnderConcurrencyAndNumericCsvIsNotConvertedToText() {
  setup();val report=published();val job=UUID.randomUUID()
  val request=input("executionId" to job,"reportVersionId" to report,"parametersJson" to """{"note":"same"}""")
  val executor=java.util.concurrent.Executors.newFixedThreadPool(2)
  try {
   val calls=(1..2).map {executor.submit {reports.execute("RequestReportExecution",request,"operator")}}
   calls.forEach {it.get(10,java.util.concurrent.TimeUnit.SECONDS)}
  } finally {executor.shutdownNow()}
  assertEquals(1,jdbc.queryForObject("select count(*) from medol_management_history where capability='reporting' and id=?",Int::class.java,job))
  assertThrows(IllegalArgumentException::class.java){reports.execute("RequestReportExecution",request.deepCopy().put("parametersJson","""{"note":"different"}"""),"operator")}
  assertEquals("\"-42\"",csvCell("-42",false));assertEquals("\"'-42\"",csvCell("-42"))
  drain()
 }
 @Test fun modeledCommandsPublishCatalogAndAuditEvents() {
  setup();val id=UUID.randomUUID()
  fun send(c:Any)=gateway.send(GenericCommandMessage(MessageType(c.javaClass),c,mapOf("userId" to "operator"))).resultMessage.join()
  send(CreateReportDefinitionCommand(id,id.toString(),"v1","Report","sample","v1"));send(PublishReportDefinitionCommand(id,1))
  val end=System.nanoTime()+20_000_000_000
  while(true) {
   publisher.publishPending()
   val catalog=jdbc.queryForObject("select count(*) from report_definition_catalog where report_version_id=? and state='Published' and revision=2",Int::class.java,id)==1
   val audit=jdbc.queryForObject("select count(*) from operation_audit_catalog where category='EVENT' and operation like '%ReportDefinitionPublished%'",Int::class.java)!!>0
   if(catalog && audit) break
   if(System.nanoTime()>end) fail<Unit>("Report catalog/audit timeout");Thread.sleep(25)
  }
 }
}
