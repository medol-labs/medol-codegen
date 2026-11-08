// Generated MEDOL archiving runtime.
package <%= rootPackage %>.archiving.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Value
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.security.MessageDigest

@Service
class ArchivingService(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper,
 transactions: PlatformTransactionManager, adapters: List<ArchiveTargetAdapter>,
 @Value("\${medol.archiving.enabled:false}") private val enabled: Boolean,
 @Value("\${medol.archiving.datasource.url:}") url: String,
 @Value("\${medol.archiving.datasource.username:}") username: String,
 @Value("\${medol.archiving.datasource.password:}") password: String
) : ArchiveRegistry {
 private val targets = adapters.associateBy { it.targetKey }
 private val archive = if(url.isNotBlank()) JdbcTemplate(DriverManagerDataSource(url,username,password)).apply { queryTimeout=30 } else null
 private val tx = TransactionTemplate(transactions).apply { propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW; timeout=30 }
 init {
  require((transactions as? org.springframework.orm.jpa.JpaTransactionManager)?.dataSource === jdbc.dataSource ||
   (transactions as? org.springframework.jdbc.datasource.DataSourceTransactionManager)?.dataSource === jdbc.dataSource) {
   "Archiving requires the transaction manager for the primary JdbcTemplate datasource"
  }
  if(url.isNotBlank()) {
   require(url.startsWith("jdbc:h2:mem:") || (url.startsWith("jdbc:postgresql:") && Regex("[?&]connectTimeout=[1-9][0-9]*(?:&|$)").containsMatchIn(url) && Regex("[?&]socketTimeout=[1-9][0-9]*(?:&|$)").containsMatchIn(url))) { "Archive URL requires positive PostgreSQL connectTimeout and socketTimeout" }
   jdbc.dataSource!!.connection.use { primary ->
    require(primary.metaData.url.substringBefore('?') != url.substringBefore('?')) { "Archive datasource must differ from primary" }
   }
  }
  require(targets.size==adapters.size) { "Duplicate archive target" }
  val supportedBindings=setOf<Pair<String,String>>(<%- projectionBindings.map(([c,r]) => JSON.stringify(c)+' to '+JSON.stringify(r)).join(',') %>)
  require(adapters.all { a -> a.projectionBindings.all { it in supportedBindings } }) { "Archive projection binding is not a generated guarded projection in this deployment" }
  require(!enabled || (url.isNotBlank() && username.isNotBlank() && password.isNotBlank())) { "Explicit archive datasource credentials required" }
<% if (tenancy) { %>  error("Archiving does not support tenant-enabled generation")
<% } %> }
 private fun lockTimeout() {
  jdbc.execute(org.springframework.jdbc.core.ConnectionCallback<Unit> { c ->
   c.createStatement().use { statement ->
    if(c.metaData.databaseProductName=="PostgreSQL") statement.execute("SET LOCAL lock_timeout = '5s'")
    else if(c.metaData.databaseProductName=="H2") statement.execute("SET LOCK_TIMEOUT 5000")
   }
  })
 }
 private fun <T:Any> transaction(block:()->T):T = requireNotNull(tx.execute { lockTimeout(); block() })
 private fun id(vararg parts:Any):UUID = UUID.nameUUIDFromBytes(mapper.writeValueAsBytes(parts.toList()))
 private fun hash(s:String)=MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
 private fun target(key:String):ArchiveTargetAdapter { require(enabled) { "Archiving disabled" }; return requireNotNull(targets[key]) { "Unregistered archive target" } }
 fun validateBatch(targetKey:String,cutoffAt:Instant,batchSize:Int) { target(targetKey); require(batchSize in 1..1000); require(!cutoffAt.isAfter(Instant.now())) }
 fun validateRestore(archiveId:UUID) {
  require(enabled) { "Archiving disabled" }
  val doc=try { read(archiveId) } catch(e:org.springframework.dao.EmptyResultDataAccessException) { throw IllegalArgumentException("Archive not found",e) }
  target(doc.targetKey)
  val current=jdbc.queryForList("select state,archive_id from medol_archive_registry where target_key=? and object_id=?",doc.targetKey,doc.snapshot.objectId).firstOrNull()
  require(current?.get("state")=="ARCHIVED" && current["archive_id"]==archiveId) { "Archive is not the current archived version of this object" }
 }
 override fun lock(targetKey:String,objectId:String) {
  check(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive())
  jdbc.execute(org.springframework.jdbc.core.ConnectionCallback<Unit> { connection ->
   check(org.springframework.jdbc.datasource.DataSourceUtils.isConnectionTransactional(org.springframework.jdbc.datasource.DataSourceUtils.getTargetConnection(connection),jdbc.dataSource!!)) {
    "Archive registry lock requires the primary datasource transaction"
   }
  })
  jdbc.update("insert into medol_archive_registry(target_key,object_id,state) values (?,?,'LIVE') on conflict do nothing",targetKey,objectId)
  jdbc.queryForObject("select state from medol_archive_registry where target_key=? and object_id=? for update",String::class.java,targetKey,objectId)
 }
 override fun state(targetKey:String,objectId:String):String? = jdbc.query("select state from medol_archive_registry where target_key=? and object_id=?",{r,_->r.getString(1)},targetKey,objectId).firstOrNull()
 private fun bindings(adapter:ArchiveTargetAdapter):String = mapper.writeValueAsString(adapter.projectionBindings.map { listOf(it.first,it.second) }.sortedBy { mapper.writeValueAsString(it) })
 private fun protectBindings(adapter:ArchiveTargetAdapter) {
  val expected=bindings(adapter)
  jdbc.update("insert into medol_archive_bindings(target_key,bindings_json) values (?,?) on conflict do nothing",adapter.targetKey,expected)
  val existing=jdbc.queryForObject("select bindings_json from medol_archive_bindings where target_key=? for update",String::class.java,adapter.targetKey)
  if(existing!=expected) {
   check(jdbc.queryForObject("select count(*) from medol_archive_registry where target_key=? and state not in ('LIVE','RESTORED')",Long::class.java,adapter.targetKey)==0L) { "Cannot change projection bindings while objects are protected" }
   jdbc.update("update medol_archive_bindings set bindings_json=? where target_key=?",expected,adapter.targetKey)
  }
 }
 private fun mark(key:String,obj:String,state:String) { jdbc.update("update medol_archive_registry set state=? where target_key=? and object_id=?",state,key,obj) }
 fun project(context:String,readModel:String,event:Any,block:()->Unit) {
  // Join the projector transaction: never commit its data independently of its token.
  val joined=TransactionTemplate(tx.transactionManager!!).apply { timeout=30 }
  joined.execute {
   lockTimeout()
   jdbc.queryForList("select distinct r.target_key,b.bindings_json from medol_archive_registry r left join medol_archive_bindings b on b.target_key=r.target_key where r.state not in ('LIVE','RESTORED')").forEach { protected ->
    val adapter=targets[protected["target_key"] as String] ?: error("Missing archive adapter for protected objects")
    check(protected["bindings_json"]==bindings(adapter)) { "Projection bindings changed for protected archive target" }
   }
   val mapped=targets.values.filter { (context to readModel) in it.projectionBindings }.map { a -> a.targetKey to requireNotNull(a.projectionObjectId(context,readModel,event)) { "Projection identity required" } }.sortedBy { it.first+":"+it.second }
   mapped.forEach { lock(it.first,it.second) }
   if(mapped.all { state(it.first,it.second) in setOf("LIVE","RESTORED") }) block()
  }
 }
 private fun completed(jobId:UUID,kind:String,args:String):Boolean {
  val row=jdbc.queryForList("select kind,args,state from medol_archive_jobs where id=?",jobId).firstOrNull() ?: return false
  require(row["kind"]==kind && row["args"]==args) { "Operation ID conflict" }
  return row["state"]=="DONE"
 }
 private fun job(jobId:UUID,kind:String,args:String):Boolean {
  jdbc.update("insert into medol_archive_jobs values (?,?,?,'NEW') on conflict do nothing",jobId,kind,args)
  val row=jdbc.queryForMap("select * from medol_archive_jobs where id=? for update",jobId)
  require(row["kind"]==kind && row["args"]==args) { "Operation ID reused with different parameters" }
  return row["state"]=="DONE"
 }
 private fun record(event:ArchiveOperationRecorded) {
  jdbc.update("insert into medol_archive_outbox(id,kind,payload_json) values (?,?,?) on conflict do nothing",id(event.archiveId?:"",event.restoreId?:"",event.operation,event.state),"ArchiveOperationRecorded",mapper.writeValueAsString(event))
 }
 fun requestBatch(batchId:UUID,targetKey:String,cutoffAt:Instant,batchSize:Int) {
  require(targetKey.isNotBlank() && batchSize in 1..1000)
  enqueue(batchId,"BATCH",mapper.writeValueAsString(listOf(targetKey,cutoffAt.toString(),batchSize)))
 }
 fun requestRestore(restoreId:UUID,archiveId:UUID) {
  enqueue(restoreId,"RESTORE",archiveId.toString())
 }
 private fun enqueue(id:UUID,kind:String,args:String) {
  TransactionTemplate(tx.transactionManager!!).execute {
   jdbc.update("insert into medol_archive_queue(id,kind,args) values (?,?,?) on conflict do nothing",id,kind,args)
   val r=jdbc.queryForMap("select kind,args from medol_archive_queue where id=?",id)
   require(r["kind"]==kind && r["args"]==args) { "Operation ID conflict" }
  }
 }
 @org.springframework.scheduling.annotation.Scheduled(fixedDelayString="\${medol.archiving.worker-delay-ms:1000}")
 fun runPending() {
  try { workPending() } catch(e:Exception) { org.slf4j.LoggerFactory.getLogger(javaClass).warn("Archive worker unavailable: {}",e.javaClass.simpleName) }
 }
 fun retryFailed(jobId:UUID,kind:String) {
  transaction {
   val updated=jdbc.update("update medol_archive_queue set state='PENDING',attempts=0,lease_token=null,retry_at=CURRENT_TIMESTAMP,error=null where id=? and kind=? and ((state='FAILED' and attempts>=5) or (state='RUNNING' and retry_at<CURRENT_TIMESTAMP))",jobId,kind)
   require(updated==1) { "Job is not terminal failed or expired running" }; true
  }
 }
 private fun workPending() {
  if(!enabled) return
  // Short lease; execution itself is idempotent and object locks serialize expired leases.
  val jobs=transaction {
   val rows=jdbc.queryForList("select * from medol_archive_queue where state<>'DONE' and attempts<5 and retry_at<=CURRENT_TIMESTAMP order by retry_at limit 1 for update skip locked")
   rows.map { row ->
    val token=UUID.randomUUID()
    jdbc.update("update medol_archive_queue set attempts=attempts+1,state='RUNNING',lease_token=?,retry_at=? where id=?",token,java.sql.Timestamp.from(Instant.now().plusSeconds(300)),row["id"])
    row + ("lease_token" to token)
   }
  }
  jobs.forEach { row ->
   try {
    val id=row["id"] as UUID
    if(row["kind"]=="BATCH") { val a=mapper.readTree(row["args"] as String); executeBatch(id,a[0].asText(),Instant.parse(a[1].asText()),a[2].asInt()) }
    else executeRestore(id,UUID.fromString(row["args"] as String))
    transaction { jdbc.update("update medol_archive_queue set state='DONE',error=null where id=? and lease_token=? and state='RUNNING'",id,row["lease_token"]); true }
   } catch(e:Exception) {
    transaction { jdbc.update("update medol_archive_queue set state='FAILED',error=?,retry_at=? where id=? and lease_token=? and state='RUNNING'",e.javaClass.simpleName,java.sql.Timestamp.from(Instant.now().plusSeconds(30)),row["id"],row["lease_token"]); true }
   }
  }
 }
 private fun executeBatch(batchId:UUID,targetKey:String,cutoffAt:Instant,batchSize:Int) {
  if(completed(batchId,"BATCH",mapper.writeValueAsString(listOf(targetKey,cutoffAt.toString(),batchSize)))) return
  validateBatch(targetKey,cutoffAt,batchSize); val a=target(targetKey)
  val args=mapper.writeValueAsString(listOf(targetKey,cutoffAt.toString(),batchSize))
  transaction {
   val done=job(batchId,"BATCH",args)
   if(!done && jdbc.queryForObject("select state from medol_archive_jobs where id=?",String::class.java,batchId)=="NEW") {
    protectBindings(a)
    a.candidates(cutoffAt,batchSize).distinct().take(batchSize).sorted().forEach { obj ->
     lock(targetKey,obj)
     if(state(targetKey,obj) in setOf("LIVE","RESTORED")) {
      val frozen=a.freeze(obj,cutoffAt)
      if(frozen!=null) {
       require(frozen.snapshot.objectId==obj && frozen.snapshot.schemaVersion>0)
       require(mapper.writeValueAsBytes(frozen).size <= 4*1024*1024) { "Archive snapshot exceeds 4 MiB; keep binary content in durable attachment storage" }
       val aid=id(batchId,targetKey,obj,frozen.snapshot.businessVersion)
       jdbc.update("insert into medol_archive_items values (?,?,?,?,?,'FROZEN')",aid,batchId,targetKey,obj,mapper.writeValueAsString(frozen))
       mark(targetKey,obj,"FROZEN")
       jdbc.update("update medol_archive_registry set archive_id=? where target_key=? and object_id=?",aid,targetKey,obj)
      }
     }
    }
    jdbc.update("update medol_archive_jobs set state='RUNNING' where id=?",batchId)
   }; true
  }
  val items=jdbc.queryForList("select archive_id from medol_archive_items where batch_id=? order by archive_id",batchId)
  items.forEach { entry -> transaction {
   // A resumed batch must retain the binding contract used when it froze the objects.
   protectBindings(a)
   val aid=entry["archive_id"] as UUID
   val row=jdbc.queryForMap("select * from medol_archive_items where archive_id=? for update",aid)
   if(row["state"]!="DONE") {
    val f=mapper.readValue(row["frozen_json"] as String,FrozenArchive::class.java)
    lock(targetKey,f.snapshot.objectId)
    check(state(targetKey,f.snapshot.objectId)=="FROZEN" && jdbc.queryForObject("select archive_id from medol_archive_registry where target_key=? and object_id=?",UUID::class.java,targetKey,f.snapshot.objectId)==aid) { "Frozen archive no longer owns this object" }
    val json=mapper.writeValueAsString(f.snapshot); val digest=hash(aid.toString()+":"+targetKey+":"+json)
    archive!!.update("insert into medol_archive_documents(archive_id,target_key,object_id,business_version,schema_version,payload_json,sha256) values (?,?,?,?,?,?,?) on conflict do nothing",aid,targetKey,f.snapshot.objectId,f.snapshot.businessVersion,f.snapshot.schemaVersion,json,digest)
    val verified=read(aid)
    check(verified.targetKey==targetKey && verified.sha256==digest) { "Archive verification failed" }
    a.cleanup(f.snapshot.objectId,f.token)
    mark(targetKey,f.snapshot.objectId,"ARCHIVED")
    jdbc.update("update medol_archive_items set state='DONE',frozen_json='' where archive_id=?",aid)
    record(ArchiveOperationRecorded(aid,batchId,null,targetKey,"ARCHIVE","DONE"))
   }; true
  } }
  transaction { jdbc.update("update medol_archive_jobs set state='DONE' where id=?",batchId); true }
 }
 private fun executeRestore(restoreId:UUID,archiveId:UUID) {
  if(completed(restoreId,"RESTORE",archiveId.toString())) return
  transaction {
   if(!job(restoreId,"RESTORE",archiveId.toString())) {
    val doc=read(archiveId)
    protectBindings(target(doc.targetKey))
    lock(doc.targetKey,doc.snapshot.objectId)
    check(state(doc.targetKey,doc.snapshot.objectId)=="ARCHIVED" && jdbc.queryForObject("select archive_id from medol_archive_registry where target_key=? and object_id=?",UUID::class.java,doc.targetKey,doc.snapshot.objectId)==archiveId) { "Object is not archived" }
    target(doc.targetKey).restore(restoreId,doc.snapshot)
    mark(doc.targetKey,doc.snapshot.objectId,"RESTORED")
    jdbc.update("update medol_archive_jobs set state='DONE' where id=?",restoreId)
    record(ArchiveOperationRecorded(archiveId,null,restoreId,doc.targetKey,"RESTORE","DONE"))
   }; true
  }
 }
 fun status(batchId:UUID):Map<String,Any?>? {
  val job=jdbc.queryForList("select * from medol_archive_queue where id=? and kind='BATCH'",batchId).firstOrNull() ?: return null
  val counts=jdbc.queryForMap("select count(*) as selected, count(case when state='DONE' then 1 end) as completed from medol_archive_items where batch_id=?",batchId)
  return job + counts
 }
 fun restoreStatus(restoreId:UUID)=jdbc.queryForList("select * from medol_archive_queue where id=? and kind='RESTORE'",restoreId).firstOrNull()
 fun read(archiveId:UUID):ArchiveDocument {
  require(archive!=null) { "Archive datasource is not configured" }
  val r=archive!!.queryForMap("select * from medol_archive_documents where archive_id=?",archiveId)
  val json=r["payload_json"] as String; check(hash(archiveId.toString()+":"+r["target_key"]+":"+json)==r["sha256"]) { "Archive checksum mismatch" }
  val snapshot=mapper.readValue(json,ArchiveSnapshot::class.java)
  check(snapshot.objectId==r["object_id"] && snapshot.businessVersion==r["business_version"] && snapshot.schemaVersion==(r["schema_version"] as Number).toInt())
  return ArchiveDocument(archiveId,r["target_key"] as String,snapshot,r["sha256"] as String)
 }
 fun list(targetKey:String?,limit:Int,after:UUID?=null):List<ArchiveSummary> {
  require(archive!=null) { "Archive datasource is not configured" }; require(limit in 1..1000)
  val clauses=mutableListOf<String>(); val args=mutableListOf<Any>()
  if(targetKey!=null) { clauses.add("target_key=?"); args.add(targetKey) }
  if(after!=null) { clauses.add("archive_id>?"); args.add(after) }; args.add(limit)
  val where=if(clauses.isEmpty()) "" else " where "+clauses.joinToString(" and ")
  return archive!!.query("select archive_id,target_key,object_id,business_version,schema_version from medol_archive_documents"+where+" order by archive_id limit ?",{r,_->
   ArchiveSummary(r.getObject("archive_id",UUID::class.java),r.getString("target_key"),r.getString("object_id"),r.getString("business_version"),r.getInt("schema_version"))
  },*args.toTypedArray())
 }
}
