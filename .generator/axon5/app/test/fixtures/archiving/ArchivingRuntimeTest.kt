package tech.medo.archiving.infrastructure

import java.time.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import tech.medo.archiving.requestarchivebatch.RequestArchiveBatchCommand
import tech.medo.archiving.requestarchiverestore.RequestArchiveRestoreCommand

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@org.springframework.context.annotation.Import(ArchivingRuntimeTest.Config::class)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:archiving;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;LOCK_TIMEOUT=15000;INIT=CREATE DOMAIN IF NOT EXISTS BLOB AS BYTEA","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.archiving.enabled=true","medol.archiving.datasource.url=jdbc:h2:mem:archive_remote;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE","medol.archiving.datasource.username=sa","medol.archiving.datasource.password=test","medol.archiving.worker-delay-ms=3600000","medol.archiving.outbox-delay-ms=3600000"])
class ArchivingRuntimeTest @Autowired constructor(private val gateway: CommandGateway, private val service: ArchivingService,
 private val projector: tech.medo.reports.reportcatalog.ReportCatalogReadModelProjector, private val publisher: ArchivingOutboxPublisher, private val transactions: org.springframework.transaction.PlatformTransactionManager, private val jdbc: JdbcTemplate, private val probe: Probe, private val mapper: ObjectMapper) {
 class Probe(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper): ArchiveTargetAdapter {
  override val targetKey="Reports.ReportRun"
  override var projectionBindings=setOf("Reports" to "ReportCatalog")
  val rejected=ConcurrentHashMap.newKeySet<String>()
  val cleanupTokens=ConcurrentHashMap<String,MutableList<String>>()
  var beforeCleanup:(()->Unit)?=null
  var failCleanup=false
  var failRestore=false
  var requestedLimit=0
  override fun candidates(cutoffAt: Instant,limit: Int): List<String> {requestedLimit=limit;return jdbc.query("select id from archive_test_live order by id limit ?",{rs,_->rs.getString(1)},limit)}
  override fun freeze(objectId: String,cutoffAt: Instant): FrozenArchive? {
   if(rejected.contains(objectId)) return null
   val rows=jdbc.query("select body from archive_test_live where id=? for update",{rs,_->rs.getString(1)},objectId)
   return rows.firstOrNull()?.let {FrozenArchive("frozen-$objectId",ArchiveSnapshot(objectId,"1",1,mapper.readTree(it),listOf("attachment://durable")))}
  }
  override fun cleanup(objectId: String,frozenToken: String) {
   cleanupTokens.computeIfAbsent(objectId){java.util.Collections.synchronizedList(mutableListOf())}.add(frozenToken)
   beforeCleanup?.invoke()
   if(failCleanup) error("simulated cleanup crash")
   jdbc.update("delete from report_catalog where run_id=?",UUID.fromString(objectId))
   jdbc.update("delete from archive_test_live where id=?",objectId)
  }
  override fun restore(restoreId: UUID,snapshot: ArchiveSnapshot) {
   if(failRestore) error("simulated restore failure")
   if(jdbc.dataSource!!.connection.use {it.metaData.databaseProductName}=="PostgreSQL")
    jdbc.update("insert into archive_test_live(id,body) values (?,?) on conflict(id) do update set body=excluded.body",snapshot.objectId,snapshot.payload.toString())
   else jdbc.update("merge into archive_test_live(id,body) key(id) values (?,?)",snapshot.objectId,snapshot.payload.toString())
  }
  override fun projectionObjectId(context: String,readModel: String,event: Any): String? =
   if(context=="Reports" && readModel=="ReportCatalog") mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(event)["runId"]?.asText() else null
 }
 @org.springframework.boot.test.context.TestConfiguration
 class Config { @org.springframework.context.annotation.Bean fun probe(jdbc: JdbcTemplate,mapper: ObjectMapper)=Probe(jdbc,mapper) }
 private fun seed(): String {
  val sql=javaClass.getResource("/db/migration/V2026110802__archiving.sql")!!.readText().replace("timestamptz","timestamp with time zone")
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_archive_jobs'",Int::class.java)==0) sql.split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
  jdbc.update("delete from medol_archive_queue")
  remote.execute("create table if not exists medol_archive_documents(archive_id uuid primary key,target_key text,object_id text,business_version text,schema_version int,payload_json text,sha256 text)")
  jdbc.execute("create table if not exists archive_test_live(id varchar(100) primary key,body text)")
  jdbc.update("delete from archive_test_live")
  probe.beforeCleanup=null;probe.failCleanup=false;probe.failRestore=false;probe.rejected.clear();probe.cleanupTokens.clear()
  val id=UUID.randomUUID().toString();jdbc.update("insert into archive_test_live values (?,?)",id,"{\"name\":\"report\"}");return id
 }
 companion object {
  private val coldUrl=System.getenv("ARCHIVING_TEST_COLD_URL") ?: "jdbc:h2:mem:archive_remote;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
  private val user=System.getenv("ARCHIVING_TEST_USER") ?: "sa"
  @JvmStatic @org.springframework.test.context.DynamicPropertySource
  fun databases(registry:org.springframework.test.context.DynamicPropertyRegistry) {
   System.getenv("ARCHIVING_TEST_PRIMARY_URL")?.let {url ->
    registry.add("spring.datasource.url"){url};registry.add("spring.datasource.driver-class-name"){"org.postgresql.Driver"}
    registry.add("spring.datasource.username"){user};registry.add("spring.datasource.password"){"test"}
    registry.add("medol.archiving.datasource.url"){coldUrl};registry.add("medol.archiving.datasource.username"){user}
   }
  }
 }
 private val remote=JdbcTemplate(org.springframework.jdbc.datasource.DriverManagerDataSource(coldUrl,user,"test"))
 private val cutoff=Instant.parse("2026-01-01T00:00:00Z")
 private fun batch(size:Int=10):UUID {val id=UUID.randomUUID();send(RequestArchiveBatchCommand(id,probe.targetKey,LocalDateTime.ofInstant(cutoff,ZoneOffset.UTC),size));waitFor{service.status(id)!=null};return id}
 private fun work() { service.runPending() }
 private fun archiveId(batch:UUID)=jdbc.queryForObject("select archive_id from medol_archive_items where batch_id=?",UUID::class.java,batch)!!
 private fun live(id:String)=jdbc.queryForObject("select count(*) from archive_test_live where id=?",Int::class.java,id)
 private fun send(command: Any)=gateway.send(command).resultMessage.join()
 private fun waitFor(test:()->Boolean) {val end=System.nanoTime()+Duration.ofSeconds(20).toNanos();while(!test()){if(System.nanoTime()>end) fail<Unit>("Archive operation did not converge");Thread.sleep(30)}}
 @Test fun copiedVerifiedThenCleanedAndDuplicateBatchDoesNotRepeat() {
  val obj=seed();val b=batch();assertEquals(1,live(obj));work()
  assertEquals(1L,(service.status(b)!!["selected"] as Number).toLong());assertEquals(1L,(service.status(b)!!["completed"] as Number).toLong())
  val aid=archiveId(b);assertEquals(0,live(obj));assertEquals("ARCHIVED",service.state(probe.targetKey,obj))
  assertEquals(obj,service.read(aid).snapshot.objectId)
  assertEquals(listOf("attachment://durable"),service.read(aid).snapshot.attachmentReferences)
  assertEquals("",jdbc.queryForMap("select * from medol_archive_items where archive_id=?",aid)["frozen_json"])
  service.requestBatch(b,probe.targetKey,cutoff,10);work()
  assertEquals(1,probe.cleanupTokens[obj]!!.size)
  assertEquals(1,jdbc.queryForObject("select count(*) from medol_archive_outbox where payload_json like ?",Int::class.java,"%$aid%"))
  send(RequestArchiveBatchCommand(b,probe.targetKey,LocalDateTime.ofInstant(cutoff,ZoneOffset.UTC),10))
  assertThrows(Exception::class.java){send(RequestArchiveBatchCommand(b,probe.targetKey,LocalDateTime.ofInstant(cutoff,ZoneOffset.UTC),11))}
 }
 @Test fun resumedCleanupRejectsChangedBindingsAndRetainsHotData() {
  val obj=seed();probe.failCleanup=true;val b=batch();work();val aid=archiveId(b)
  probe.failCleanup=false
  val original=probe.projectionBindings
  try {
   probe.projectionBindings=emptySet();retry();work()
   assertEquals(1,live(obj));assertEquals("FROZEN",service.state(probe.targetKey,obj))
   assertEquals("FAILED",service.status(b)!!["state"])
  } finally {probe.projectionBindings=original}
  retry();work();assertEquals(0,live(obj));assertEquals(aid,archiveId(b))
 }
 @Test fun restoreRejectsChangedBindingsAndAlreadyRestoredRequests() {
  val obj=seed();val b=batch();work();val aid=archiveId(b);val rid=UUID.randomUUID()
  service.requestRestore(rid,aid)
  val original=probe.projectionBindings
  try {
   probe.projectionBindings=emptySet();work()
   assertEquals(0,live(obj));assertEquals("ARCHIVED",service.state(probe.targetKey,obj))
   assertEquals("FAILED",service.restoreStatus(rid)!!["state"])
  } finally {probe.projectionBindings=original}
  retry();work();assertEquals(1,live(obj))
  assertThrows(Exception::class.java){send(RequestArchiveRestoreCommand(UUID.randomUUID(),aid))}
 }
 @Test fun cleanupRequiresOwnershipOfTheCurrentFrozenArchive() {
  val obj=seed();probe.failCleanup=true;val b=batch();work();val aid=archiveId(b)
  probe.failCleanup=false
  jdbc.update("update medol_archive_registry set archive_id=? where target_key=? and object_id=?",UUID.randomUUID(),probe.targetKey,obj)
  retry();work();assertEquals(1,live(obj));assertEquals("FAILED",service.status(b)!!["state"])
  jdbc.update("update medol_archive_registry set archive_id=? where target_key=? and object_id=?",aid,probe.targetKey,obj)
  retry();work();assertEquals(0,live(obj))
 }
 @Test fun cleanupCrashRetriesSameArchiveAndFrozenToken() {
  val obj=seed();probe.failCleanup=true;val b=batch();work();val aid=archiveId(b)
  assertEquals(1,live(obj));assertEquals(obj,service.read(aid).snapshot.objectId)
  assertNotEquals("DONE",service.status(b)!!["state"])
  probe.failCleanup=false;retry();work();assertEquals(aid,archiveId(b));assertEquals(0,live(obj))
  assertEquals(setOf("frozen-$obj"),probe.cleanupTokens[obj]!!.toSet());assertTrue(probe.cleanupTokens[obj]!!.size>=2)
 }
 @Test fun ineligibleObjectsAndBatchBounds() {
  val obj=seed();probe.rejected.add(obj);val b=batch(1);work();assertEquals(1,live(obj));assertFalse(probe.cleanupTokens.containsKey(obj))
  assertEquals(0,jdbc.queryForObject("select count(*) from medol_archive_items where batch_id=?",Int::class.java,b))
  assertThrows(Exception::class.java){service.validateBatch(probe.targetKey,cutoff,0)}
  assertThrows(Exception::class.java){service.validateBatch(probe.targetKey,cutoff,1001)}
  probe.rejected.clear();jdbc.update("insert into archive_test_live values (?,?)",UUID.randomUUID().toString(),"{}")
  val limited=batch(1);work();assertEquals(1,probe.requestedLimit)
  assertEquals(1,jdbc.queryForObject("select count(*) from medol_archive_items where batch_id=?",Int::class.java,limited))
  assertEquals(1,jdbc.queryForObject("select count(*) from archive_test_live",Int::class.java))
 }
 @Test fun restoreFailureRetryIdempotencyAndOldArchiveProtection() {
  val obj=seed();val b=batch();work();val aid=archiveId(b);val rid=UUID.randomUUID()
  probe.failRestore=true;send(RequestArchiveRestoreCommand(rid,aid));waitFor{service.restoreStatus(rid)!=null};work()
  assertEquals(0,live(obj));assertEquals("ARCHIVED",service.state(probe.targetKey,obj))
  probe.failRestore=false;retry();work();assertEquals(1,live(obj))
  send(RequestArchiveRestoreCommand(rid,aid));service.requestRestore(rid,aid);work();assertEquals(1,live(obj))
  val second=batch();work();assertNotEquals(aid,archiveId(second))
  runCatching {service.requestRestore(UUID.randomUUID(),aid);work()}
  assertEquals(0,live(obj));assertEquals("ARCHIVED",service.state(probe.targetKey,obj))
 }
 @Test fun historyRejectsPayloadAndTargetTampering() {
  seed();val b=batch();work();val aid=archiveId(b)
  val original=remote.queryForMap("select * from medol_archive_documents where archive_id=?",aid)
  remote.update("update medol_archive_documents set payload_json='{}' where archive_id=?",aid)
  assertThrows(Exception::class.java){service.read(aid)}
  remote.update("update medol_archive_documents set payload_json=?,target_key='forged' where archive_id=?",original["payload_json"],aid)
  assertThrows(Exception::class.java){service.read(aid)}
  remote.update("update medol_archive_documents set target_key=? where archive_id=?",probe.targetKey,aid)
 }
 @Test fun changedProjectionBindingsFailClosed() {
  seed();batch();work()
  val original=probe.projectionBindings
  try {
   probe.projectionBindings=emptySet()
   assertThrows(Exception::class.java){service.project("Reports","ReportCatalog",mapOf("runId" to UUID.randomUUID().toString())){fail<Unit>("Changed bindings must not project")}}
  } finally {probe.projectionBindings=original}
 }
 @Test fun outboxPublishesThroughAxonIntoOperationAuditExactlyOnce() {
  seed();val b=batch();work();val aid=archiveId(b)
  fun count()=jdbc.queryForObject("select count(*) from operation_audit_catalog where category='ARCHIVING' and outcome='DONE' and target_id=?",Int::class.java,aid.toString())!!
  publisher.publishPending();waitFor{count()==1}
  publisher.publishPending()
  assertEquals(1,count())
  assertEquals(0,jdbc.queryForObject("select count(*) from medol_archive_outbox where delivered=false and payload_json like ?",Int::class.java,"%$aid%"))
 }
 @Test fun completedRestoreJournalFinishesQueueWithoutColdStore() {
  val obj=seed();val b=batch();work();val aid=archiveId(b);val rid=UUID.randomUUID()
  service.requestRestore(rid,aid);work();assertEquals("DONE",service.restoreStatus(rid)!!["state"])
  jdbc.update("update medol_archive_queue set state='PENDING',retry_at=? where id=?",java.sql.Timestamp.from(Instant.EPOCH),rid)
  remote.execute("alter table medol_archive_documents rename to unavailable_archive_documents")
  try {work();assertEquals("DONE",service.restoreStatus(rid)!!["state"]);assertEquals(1,live(obj))}
  finally {remote.execute("alter table unavailable_archive_documents rename to medol_archive_documents")}
 }
 @Test fun disabledRuntimeStillReadsSummariesAndGuardsArchivedProjections() {
  val obj=seed();val b=batch();work();val aid=archiveId(b)
  val disabled=ArchivingService(jdbc,mapper,transactions,listOf(probe),false,coldUrl,user,"test")
  assertEquals(obj,disabled.read(aid).snapshot.objectId)
  val summary=disabled.list(probe.targetKey,1000).first {it.archiveId==aid}
  val json=mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(summary)
  assertFalse(json.has("payload"));assertFalse(json.has("snapshot"));assertFalse(json.has("attachmentReferences"))
  // A malformed payload must not force list() to deserialize or fetch full documents.
  val original=remote.queryForObject("select payload_json from medol_archive_documents where archive_id=?",String::class.java,aid)
  remote.update("update medol_archive_documents set payload_json='invalid JSON' where archive_id=?",aid)
  try {assertTrue(disabled.list(probe.targetKey,1000).any {it.archiveId==aid})}
  finally {remote.update("update medol_archive_documents set payload_json=? where archive_id=?",original,aid)}
  var updated=false;disabled.project("Reports","ReportCatalog",mapOf("runId" to obj)){updated=true};assertFalse(updated)
  assertThrows(Exception::class.java){disabled.validateBatch(probe.targetKey,cutoff,1)}
  assertThrows(Exception::class.java){disabled.lock(probe.targetKey,obj)}
 }
 @Test fun staleWorkerCannotCompleteReplacementLeaseAfterAttemptsReset() {
  seed();val b=batch();val replacement=UUID.randomUUID()
  probe.beforeCleanup={
   jdbc.update("update medol_archive_queue set lease_token=?,attempts=0,state='PENDING',retry_at=? where id=?",replacement,java.sql.Timestamp.from(Instant.EPOCH),b)
  }
  work();probe.beforeCleanup=null
  assertEquals("PENDING",service.status(b)!!["state"])
  assertEquals(replacement,service.status(b)!!["lease_token"])
  work();assertEquals("DONE",service.status(b)!!["state"])
 }
 @Test fun generatedProjectorReplayDoesNotResurrectArchivedRow() {
  val obj=seed()
  val event=tech.medo.reports.events.ReportRequestedEvent(UUID.fromString(obj),LocalDateTime.ofInstant(cutoff,ZoneOffset.UTC),"daily")
  val message=org.axonframework.messaging.eventhandling.GenericEventMessage(org.axonframework.messaging.core.MessageType(event.javaClass),event)
  projector.on(event,message)
  assertEquals(1,jdbc.queryForObject("select count(*) from report_catalog where run_id=?",Int::class.java,event.runId))
  batch();work()
  projector.on(event,message)
  assertEquals(0,jdbc.queryForObject("select count(*) from report_catalog where run_id=?",Int::class.java,event.runId))
 }
 @Test fun concurrentWorkersAndProjectionRegistry() {
  val obj=seed();val b=batch()
  val pool=java.util.concurrent.Executors.newFixedThreadPool(4)
  try {pool.invokeAll((1..4).map {java.util.concurrent.Callable {work()}}).forEach {it.get()}} finally {pool.shutdownNow()}
  assertEquals(0,live(obj));assertEquals(1,probe.cleanupTokens[obj]!!.size)
  var updates=0
  service.project("Reports","ReportCatalog",mapOf("runId" to obj)){updates++}
  assertEquals(0,updates)
  service.project("Reports","ReportCatalog",mapOf("runId" to UUID.randomUUID().toString())){updates++}
  assertEquals(1,updates);assertEquals("DONE",service.status(b)!!["state"])
 }
 private fun retry() {
  jdbc.update("update medol_archive_queue set retry_at=? where state<>'DONE'",java.sql.Timestamp.from(Instant.EPOCH))
 }

}
