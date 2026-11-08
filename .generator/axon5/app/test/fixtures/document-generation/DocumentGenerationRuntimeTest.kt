package tech.medo.documentgeneration.infrastructure

import java.util.UUID
import java.time.Instant
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.commandhandling.GenericCommandMessage
import org.axonframework.messaging.core.MessageType
import tech.medo.documentgeneration.createdocumenttemplateversion.CreateDocumentTemplateVersionCommand
import tech.medo.documentgeneration.publishdocumenttemplateversion.PublishDocumentTemplateVersionCommand
import tech.medo.documentgeneration.requestdocumentgeneration.RequestDocumentGenerationCommand
import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@org.springframework.context.annotation.Import(DocumentGenerationRuntimeTest.Config::class)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:documents;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;INIT=CREATE DOMAIN IF NOT EXISTS BLOB AS BYTEA","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=test","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.documents.enabled=true","medol.documents.worker-delay-ms=3600000","medol.documents.outbox-delay-ms=3600000"])
class DocumentGenerationRuntimeTest @Autowired constructor(private val service:DocumentService,private val jdbc:JdbcTemplate,
 private val mapper:ObjectMapper,private val provider:ProbeProvider,private val renderer:PdfDocumentRenderer,
 private val flaky:FlakyRenderer,private val properties:DocumentProperties,private val publisher:DocumentOutboxPublisher,
 private val gateway:CommandGateway,private val store:DocumentArtifactStore) {
 companion object {
  val storage=Files.createTempDirectory("document-runtime-artifacts-")
  @JvmStatic @org.springframework.test.context.DynamicPropertySource
  fun database(r:org.springframework.test.context.DynamicPropertyRegistry) {
   r.add("medol.documents.storage-path"){storage.toString()}
   System.getenv("DOCUMENTS_TEST_PRIMARY_URL")?.let {url->r.add("spring.datasource.url"){url};r.add("spring.datasource.driver-class-name"){"org.postgresql.Driver"};r.add("spring.datasource.username"){"postgres"}}
  }
 }
 class ProbeProvider(private val mapper:ObjectMapper):DocumentDataProvider {
  override val key="delivery"
  override val contract=DocumentContract("v1",DocumentField("object",properties=mapOf(
   "number" to DocumentField("string"),"customer" to DocumentField("string"),
   "lines" to DocumentField("array",items=DocumentField("object",properties=mapOf("name" to DocumentField("string"),"quantity" to DocumentField("number")))))))
  var customer="Original customer"
  var denied=false
  var allowedUsers=setOf("operator")
  val captures=AtomicInteger()
  override fun authorize(identity:DocumentIdentity,objectRef:String,action:DocumentAction) {
   if(identity.userId !in allowedUsers || denied) throw org.springframework.security.access.AccessDeniedException("Denied")
   require(objectRef.startsWith("order-"))
  }
  override fun snapshot(identity:DocumentIdentity,input:DocumentInput):DocumentSnapshot {
   captures.incrementAndGet()
   return DocumentSnapshot("source-7",mapper.readTree("""{"number":"ORD-007","customer":"$customer","lines":[{"name":"Apples","quantity":3},{"name":"Bananas","quantity":5}]}"""))
  }
 }
 class FlakyRenderer(private val pdf:PdfDocumentRenderer):DocumentRenderer {
  override val key="flaky"
  var fail=true
  var oversized=false
  override fun version()="flaky-1/"+pdf.version()
  override fun validate(template:com.fasterxml.jackson.databind.JsonNode,contract:DocumentContract)=pdf.validate(template,contract)
  override fun render(template:com.fasterxml.jackson.databind.JsonNode,data:com.fasterxml.jackson.databind.JsonNode):ByteArray {
   if(fail) error("Transient failure");if(oversized) return ByteArray(33554433);return pdf.render(template,data)
  }
 }
 @org.springframework.boot.test.context.TestConfiguration
 class Config {
  @org.springframework.context.annotation.Bean fun provider(mapper:ObjectMapper)=ProbeProvider(mapper)
  @org.springframework.context.annotation.Bean fun flaky(pdf:PdfDocumentRenderer)=FlakyRenderer(pdf)
 }
 private val content="""{"title":"Delivery {{number}}","header":"Example Company","footer":"Internal business document","blocks":[{"type":"text","text":"Customer: {{customer}}"},{"type":"table","items":"lines","columns":[{"label":"Product","field":"name"},{"label":"Quantity","field":"quantity"}]}]}"""
 private fun setup() {
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_document_jobs'",Int::class.java)==0)
   javaClass.getResource("/db/migration/V2026110803__document_generation.sql")!!.readText().split(';').filter{it.isNotBlank()}.forEach{jdbc.execute(it)}
  // Keep prior projections and authoritative rows for event handlers; remove runnable jobs between tests.
  jdbc.update("update medol_document_jobs set attempts=5 where state<>'Completed'")
  provider.customer="Original customer";provider.denied=false;provider.allowedUsers=setOf("operator");flaky.oversized=false;provider.captures.set(0);flaky.fail=true;properties.fontPath="";properties.maxPages=200
 }
 private fun draft(engine:String="pdfbox-layout"):UUID {
  val id=UUID.randomUUID();service.create(TemplateDefinition(id,"delivery-${UUID.randomUUID()}","v1",provider.key,"v1",engine,content),"operator");return id
 }
 private fun published(engine:String="pdfbox-layout"):UUID=draft(engine).also{service.transition(it,1,true,"operator")}
 private fun request(template:UUID,id:UUID=UUID.randomUUID()):UUID {service.request(id,template,DocumentInput("order-1","en-US","UTC"),"operator");return id}
 private fun state(id:UUID)=service.status(id,"operator")["state"]
 private fun revision(id:UUID)=(service.status(id,"operator")["revision"] as Number).toLong()
 private fun send(command:Any)=gateway.send(GenericCommandMessage(MessageType(command.javaClass),command,mapOf("userId" to "operator"))).resultMessage.join()
 private fun waitFor(predicate:()->Boolean) {val end=System.nanoTime()+20_000_000_000;while(!predicate()){if(System.nanoTime()>end) fail<Unit>("Projection timeout");Thread.sleep(25)}}
 @Test fun lifecycleRejectsDraftGenerationAndPublishedMutation() {
  setup();val id=draft();assertThrows(Exception::class.java){request(id)}
  assertThrows(Exception::class.java){service.revise(id,2,content,"operator")}
  service.transition(id,1,true,"operator");assertThrows(Exception::class.java){service.revise(id,2,content,"operator")}
  val job=request(id);service.transition(id,2,false,"operator")
  assertThrows(Exception::class.java){request(id)}
  service.runPending();assertEquals("Completed",state(job))
 }
 @Test fun snapshotIsFixedAndRequestIsIdempotent() {
  setup();val template=published();val job=request(template);provider.customer="Changed after request"
  request(template,job);assertEquals(1,provider.captures.get())
  service.runPending();assertEquals("Completed",state(job))
  val pdf=service.download(job,"operator")
  Loader.loadPDF(pdf).use {doc->val text=PDFTextStripper().getText(doc);assertTrue(text.contains("Original customer"));assertFalse(text.contains("Changed after request"))}
  Files.write(storage.resolve("preview-sample.pdf"),pdf)
  assertFalse(service.status(job,"operator").containsKey("snapshot_json"))
  assertThrows(Exception::class.java){service.request(job,template,DocumentInput("order-other","en-US","UTC"),"operator")}
 }
 @Test fun unknownFieldsAndMissingRequiredDataFailBeforeRendering() {
  setup()
  assertThrows(Exception::class.java){service.create(TemplateDefinition(UUID.randomUUID(),"bad","1",provider.key,"v1",renderer.key,content.replace("{{customer}}","{{missing}}")),"operator")}
  val id=published();assertThrows(Exception::class.java){service.preview(id,mapper.readTree("{}"))}
  assertThrows(Exception::class.java){service.preview(id,mapper.readTree("""{"number":"n","customer":"c","lines":[{"name":"n","quantity":"not-a-number"}]}"""))}
 }
 @Test fun retryUsesOriginalSnapshotAndPinnedRenderer() {
  setup();val job=request(published("flaky"));service.runPending();assertEquals("Failed",state(job))
  provider.customer="New";flaky.fail=false;service.retry(job,revision(job),"operator");service.runPending()
  assertEquals("Completed",state(job));assertEquals(1,provider.captures.get())
  Loader.loadPDF(service.download(job,"operator")).use {assertTrue(PDFTextStripper().getText(it).contains("Original customer"))}
  val pinned=request(published());properties.maxPages=199;service.runPending();assertEquals("Failed",state(pinned));properties.maxPages=200
 }
 @Test fun authorizationIsRecheckedForEveryDownloadAndRetry() {
  setup();val job=request(published());service.runPending();provider.denied=true
  assertThrows(org.springframework.security.access.AccessDeniedException::class.java){service.download(job,"operator")}
  assertThrows(org.springframework.security.access.AccessDeniedException::class.java){service.status(job,"operator")}
  assertThrows(org.springframework.security.access.AccessDeniedException::class.java){service.retry(job,3,"operator")}
  provider.denied=false;assertThrows(Exception::class.java){service.download(job,"intruder")}
 }
 @Test fun concurrentWorkersProduceOneCompleteArtifactAndChecksumDetectsTampering() {
  setup();val job=request(published());val pool=java.util.concurrent.Executors.newFixedThreadPool(3)
  try {pool.invokeAll((1..3).map {java.util.concurrent.Callable{service.runPending()}}).forEach{it.get()}} finally{pool.shutdownNow()}
  assertEquals("Completed",state(job));val original=service.download(job,"operator")
  Files.write(storage.resolve(job.toString()).resolve("result.pdf"),"tampered".toByteArray())
  assertThrows(Exception::class.java){service.download(job,"operator")}
  Files.write(storage.resolve(job.toString()).resolve("result.pdf"),original)
 }
 @Test fun lostCompletionReusesExistingArtifactEvenWhenRendererChanged() {
  setup();val job=request(published());service.runPending();val original=service.download(job,"operator")
  jdbc.update("update medol_document_jobs set state='Requested',attempts=0,retry_at=? where id=?",java.sql.Timestamp.from(Instant.EPOCH),job)
  properties.maxPages=199;service.runPending();assertEquals("Completed",state(job));assertArrayEquals(original,service.download(job,"operator"));properties.maxPages=200
 }
 @Test fun modeledCommandsPublishToCatalogAndAudit() {
  setup();val id=UUID.randomUUID();send(CreateDocumentTemplateVersionCommand(id,"cmd-${UUID.randomUUID()}","1",provider.key,"v1",renderer.key,content));send(PublishDocumentTemplateVersionCommand(id,1))
  val job=UUID.randomUUID();send(RequestDocumentGenerationCommand(job,id,"order-1","en-US","UTC"));service.runPending();publisher.publishPending()
  waitFor{publisher.publishPending();jdbc.queryForObject("select count(*) from generated_document_catalog where document_id=? and state='Completed'",Int::class.java,job)==1}
  waitFor{jdbc.queryForObject("select count(*) from operation_audit_catalog where category='EVENT' and operation like '%DocumentGenerationCompleted%'",Int::class.java)!!>0}
 }
 @Test fun concurrentDuplicateRequestsCaptureOnce() {
  setup();val t=published();val id=UUID.randomUUID();val pool=java.util.concurrent.Executors.newFixedThreadPool(3)
  try {pool.invokeAll((1..3).map {java.util.concurrent.Callable{request(t,id)}}).forEach{it.get()}} finally{pool.shutdownNow()}
  assertEquals(1,provider.captures.get());service.runPending();assertEquals("Completed",state(id))
 }
 @Test fun frozenMetadataAndDataCorruptionDoNotCreateFiles() {
  setup();val id=request(published());jdbc.update("update medol_document_jobs set source_version='corrupted' where id=?",id)
  service.runPending();assertEquals("Failed",state(id));assertFalse(Files.exists(storage.resolve(id.toString())))
  val second=request(published());jdbc.update("update medol_document_jobs set snapshot_json='{}' where id=?",second)
  service.runPending();assertEquals("Failed",state(second));assertFalse(Files.exists(storage.resolve(second.toString())))
 }
 @Test fun staleLeaseCannotPublishCompletionAndRetryReusesFile() {
  setup();val id=request(published());val original=jdbc.queryForMap("select * from medol_document_jobs where id=?",id)
  // Simulate a complete artifact saved before the process lost its lease/DB completion.
  val bytes=renderer.render(mapper.readTree(original["template_json"] as String),mapper.readTree(original["snapshot_json"] as String))
  store.putIfAbsent(id,original["input_hash"] as String,bytes)
  jdbc.update("update medol_document_jobs set state='Processing',revision=revision+1,lease_token=?,retry_at=? where id=?",UUID.randomUUID(),java.sql.Timestamp.from(Instant.EPOCH),id)
  service.retry(id,revision(id),"operator");service.runPending()
  assertEquals("Completed",state(id));assertArrayEquals(bytes,service.download(id,"operator"))
 }
 @Test fun previewChineseMultiPageAndLongCells() {
  setup();val font=System.getenv("DOCUMENTS_TEST_FONT_PATH")
  org.junit.jupiter.api.Assumptions.assumeTrue(font!=null,"Set DOCUMENTS_TEST_FONT_PATH to test embedded Unicode TTF")
  properties.fontPath=font!!;val t=published()
  val sample=mapper.createObjectNode().put("number","出库单-001").put("customer","测试客户")
  val lines=sample.putArray("lines")
  repeat(100) {i->lines.addObject().put("name","商品名称与长文本换行测试 $i").put("quantity",i+1)}
  val pdf=service.preview(t,sample);Files.write(storage.resolve("unicode-multipage.pdf"),pdf)
  Loader.loadPDF(pdf).use {doc->assertTrue(doc.numberOfPages>=3);val text=PDFTextStripper().getText(doc);assertTrue(text.contains("测试客户"));assertTrue(text.contains("99"))}
  properties.fontPath=""
 }
 @Test fun invalidLayoutAndMalformedJsonAreRejected() {
  setup()
  for(template in listOf("not json","null",content.replace("\"type\":\"text\"","\"type\":\"script\""),content.replace("{{customer}}","{{ customer + 1 }}")))
   assertThrows(Exception::class.java){service.create(TemplateDefinition(UUID.randomUUID(),"bad-${UUID.randomUUID()}","1",provider.key,"v1",renderer.key,template),"operator")}
 }

 @Test fun retryAuditUsesActingUserAndKeepsOriginalRequester() {
  setup();val id=request(published("flaky"));service.runPending();assertEquals("Failed",state(id))
  provider.allowedUsers=setOf("operator","retry-operator")
  service.retry(id,revision(id),"retry-operator")
  assertEquals("retry-operator",jdbc.queryForObject("select actor_id from medol_document_outbox where event_kind='DocumentGenerationRetried' and correlation_id=?",String::class.java,id.toString()))
  assertEquals("operator",service.status(id,"retry-operator")["requested_by"])
 }
 @Test fun previewRejectsOversizedCustomRendererOutput() {
  setup();flaky.fail=false;val t=draft("flaky");flaky.oversized=true
  val data=provider.snapshot(DocumentIdentity("operator"),DocumentInput("order-1","en-US","UTC")).data
  assertThrows(IllegalArgumentException::class.java){service.preview(t,data)}
 }
 @Test fun concurrentArtifactPublicationKeepsOneCompleteFile() {
  setup();val id=UUID.randomUUID();val hash="same-frozen-input";val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
  try {
   val results=pool.invokeAll(listOf("first","second").map {value->java.util.concurrent.Callable {store.putIfAbsent(id,hash,value.toByteArray())}}).map {it.get()}
   assertEquals(results[0].sha256,results[1].sha256)
   val bytes=store.read(id,hash,results[0].sha256)
   assertTrue(String(bytes) in setOf("first","second"))
  } finally {pool.shutdownNow()}
 }

 @Test fun tallTableHeaderIsRejectedInsteadOfSplittingDataAcrossHeaderPages() {
  setup();val id=draft();val source=mapper.readTree(content)
  (source["blocks"][1]["columns"][0] as com.fasterxml.jackson.databind.node.ObjectNode).put("label","x\n".repeat(100))
  service.revise(id,1,mapper.writeValueAsString(source),"operator")
  val data=provider.snapshot(DocumentIdentity("operator"),DocumentInput("order-1","en-US","UTC")).data
  assertThrows(IllegalArgumentException::class.java){service.preview(id,data)}
 }

}
