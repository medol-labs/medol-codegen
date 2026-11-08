package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Component
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import java.util.UUID
import java.nio.file.*
import java.nio.channels.FileChannel
import java.security.MessageDigest
import java.io.OutputStream
import java.io.FilterOutputStream

@Component
class ReportingWorker(private val service:ReportingService,private val store:ManagementStore,private val mapper:ObjectMapper,private val jdbc:JdbcTemplate,
 @Value("\${medol.reporting.enabled:false}") private val enabled:Boolean,
 @Value("\${medol.reporting.storage-path:build/reports}") storagePath:String) {
 private val root=Path.of(storagePath).toAbsolutePath().normalize()
 private val running=java.util.concurrent.atomic.AtomicBoolean(false)
 private val executor=java.util.concurrent.Executors.newSingleThreadExecutor {task->Thread(task,"medol-report-worker").apply {isDaemon=true}}
 @jakarta.annotation.PreDestroy
 fun close() {executor.shutdownNow()}
 @Scheduled(fixedDelayString="\${medol.reporting.poll-ms:2000}")
 fun tick() {
  if(!enabled || !running.compareAndSet(false,true)) return
  try {executor.execute {
   try {processOne()} catch(e:Exception) {org.slf4j.LoggerFactory.getLogger(javaClass).error("Report worker failed: {}",e.javaClass.simpleName)} finally {running.set(false)}
  }} catch(e:java.util.concurrent.RejectedExecutionException) {running.set(false)}
 }
 /** Claims and completes under short transactions. Business reads never hold the capability lock. */
 fun processOne():Boolean {
  val job=store.locked("reporting") {
   val job=jdbc.queryForList("select * from medol_report_executions where state='Requested' order by created_at,id limit 1").firstOrNull() ?: return@locked null
   val id=UUID.fromString(job["id"].toString());val token=UUID.randomUUID()
   jdbc.update("update medol_report_executions set state='Processing',attempt_token=?,lease_until=CURRENT_TIMESTAMP + INTERVAL '10' MINUTE where id=?",token,id)
   val row=requireNotNull(store.record("reporting",id));row.put("state","Processing");row.put("attempt",row.path("attempt").asLong()+1)
   store.save("reporting","ReportExecution",id,row,"ReportExecutionStarted",job["actor_id"].toString())
   job.toMutableMap().apply {put("attempt_token",token)}
  } ?: return false
  val id=UUID.fromString(job["id"].toString());val token=UUID.fromString(job["attempt_token"].toString());val actor=job["actor_id"].toString()
  var staging:Path?=null
  try {
   val p=service.providerForJob(job);val params=service.parameters(job["parameters_json"] as String,p)
   p.authorize(actor,params.deepCopy(),ReportAction.EXPORT)
   Files.createDirectories(root);staging=Files.createTempDirectory(root,".report-");val file=staging.resolve("result.csv")
   var count=0L;val deadline=System.nanoTime()+300_000_000_000L
   val source=p.openExport(actor,params.deepCopy()).use {stream->
    val source=stream.source
    Files.newOutputStream(file,StandardOpenOption.CREATE_NEW).use {raw->
     val bounded=object:FilterOutputStream(raw) {
      var size=0L
      override fun write(b:Int) {require(++size<=134217728L) {"CSV exceeds 128 MiB"};out.write(b)}
      override fun write(b:ByteArray,off:Int,len:Int) {size+=len;require(size<=134217728L) {"CSV exceeds 128 MiB"};out.write(b,off,len)}
     }
     bounded.bufferedWriter(Charsets.UTF_8).use {writer->
      fun line(values:List<String>,numeric:Set<Int> = emptySet()) {writer.write(values.mapIndexed {i,v->csvCell(v,i !in numeric)}.joinToString(","));writer.write("\r\n")}
      line(p.contract.columns.map {it.label})
      while(true) {
       require(System.nanoTime()<deadline) {"Report export time limit exceeded"}
       val batch=stream.nextBatch(500);require(batch.size<=500)
       if(batch.isEmpty()) break
       for(row in batch) {
        require(++count<=1_000_000L) {"Report exceeds one million rows"};validateReportValues(row,p.contract.columns)
        line(p.contract.columns.map {field->row[field.name]?.takeUnless {it.isNull}?.asText() ?: ""},p.contract.columns.mapIndexedNotNull {i,f->if(f.type in setOf(ReportValueType.INTEGER,ReportValueType.DECIMAL)) i else null}.toSet())
       }
      }
     }
    };source
   }
   p.authorize(actor,params.deepCopy(),ReportAction.EXPORT)
   FileChannel.open(file,StandardOpenOption.WRITE).use {it.force(true)}
   val hash=hash(file);sync(staging)
   Files.move(staging,root.resolve(token.toString()),StandardCopyOption.ATOMIC_MOVE);staging=null;sync(root)
   store.locked("reporting") {
    if(!owned(id,token)) return@locked
    val row=requireNotNull(store.record("reporting",id));row.put("state","Completed");row.put("rowCount",count);row.put("fileHash",hash);row.remove("errorCode")
    jdbc.update("update medol_report_executions set state='Completed',source_json=?,lease_until=null where id=?",mapper.writeValueAsString(source),id)
    store.save("reporting","ReportExecution",id,row,"ReportExecutionCompleted",actor)
   }
  } catch(e:Exception) {
   store.locked("reporting") {
    if(!owned(id,token)) return@locked
    val row=requireNotNull(store.record("reporting",id));row.put("state","Failed");row.put("errorCode","REPORT_EXECUTION_FAILED")
    jdbc.update("update medol_report_executions set state='Failed',lease_until=null where id=?",id)
    store.save("reporting","ReportExecution",id,row,"ReportExecutionFailed",actor)
   }
   org.slf4j.LoggerFactory.getLogger(javaClass).warn("Report {} failed: {}",id,e.javaClass.simpleName)
  } finally {staging?.let {Files.deleteIfExists(it.resolve("result.csv"));Files.deleteIfExists(it)}}
  return true
 }
 private fun owned(id:UUID,token:UUID)=jdbc.queryForObject("select count(*) from medol_report_executions where id=? and state='Processing' and attempt_token=? and lease_until>CURRENT_TIMESTAMP",Int::class.java,id,token)==1
 private fun sync(path:Path) {FileChannel.open(path,StandardOpenOption.READ).use {it.force(true)}}
 private fun hash(file:Path):String {
  val digest=MessageDigest.getInstance("SHA-256");Files.newInputStream(file).use {input->val buffer=ByteArray(65536);while(true) {val n=input.read(buffer);if(n<0) break;digest.update(buffer,0,n)}}
  return digest.digest().joinToString("") {"%02x".format(it)}
 }
 fun download(id:UUID,actor:String):Path {
  val job=service.authorizedJob(id,actor,ReportAction.DOWNLOAD)
  val row=service.status(id,actor);require(row.path("state").asText()=="Completed") {"Report is not completed"}
  val token=UUID.fromString(job["attempt_token"].toString());val path=root.resolve(token.toString()).resolve("result.csv")
  require(Files.isRegularFile(path) && Files.size(path) in 1..134217728L && hash(path)==row.path("fileHash").asText()) {"Report artifact missing or damaged"}
  service.audit("ReportDownloadAuthorized",UUID.fromString(job["report_version_id"].toString()),id,actor);return path
 }
}
/** Quote every cell, escape quotes, and neutralize spreadsheet formulas including whitespace-prefixed formulas. */
internal fun csvCell(value:String,neutralize:Boolean=true):String {
 val suspicious=value.trimStart().firstOrNull() in listOf('=','+','-','@') || value.startsWith('\t') || value.startsWith('\r') || value.startsWith('\n')
 val safe=if(neutralize && suspicious) "'$value" else value
 return "\""+safe.replace("\"","\"\"")+"\""
}
