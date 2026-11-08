// Generated MEDOL document-generation runtime. Operational state and outbox commit together.
package <%= rootPackage %>.documentgeneration.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.security.access.AccessDeniedException
import java.util.UUID
import java.time.Instant
import java.sql.Timestamp

@Service
class DocumentService(private val jdbc:JdbcTemplate, private val mapper:ObjectMapper,
 transactions:PlatformTransactionManager, private val properties:DocumentProperties,
 providers:List<DocumentDataProvider>, renderers:List<DocumentRenderer>,
 private val validation:DocumentValidation, private val files:DocumentArtifactStore) {
 private val providers=providers.associateBy {it.key}
 private val renderers=renderers.associateBy {it.key}
 private val tx=TransactionTemplate(transactions).apply {propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW;timeout=30}
 init {
  require(this.providers.size==providers.size && this.renderers.size==renderers.size) { "Duplicate document provider/renderer key" }
  require((transactions as? org.springframework.orm.jpa.JpaTransactionManager)?.dataSource === jdbc.dataSource ||
   (transactions as? org.springframework.jdbc.datasource.DataSourceTransactionManager)?.dataSource === jdbc.dataSource) { "Document runtime requires the primary datasource transaction manager" }
  providers.forEach {require(it.key.isNotBlank() && it.key.length<=160);validation.contract(it.contract)}
 }
 private fun <T:Any> tx(block:()->T):T=requireNotNull(tx.execute {block()})
 private fun enabled()=require(properties.enabled) { "Document generation disabled" }
 private fun identity(actor:String):DocumentIdentity {
  if(actor.isBlank() || actor=="anonymous" || actor.length>160) throw AccessDeniedException("Authenticated document identity required")
  return DocumentIdentity(actor)
 }
 private fun provider(key:String)=requireNotNull(providers[key]) { "Document data provider is not installed" }
 private fun renderer(key:String)=requireNotNull(renderers[key]) { "Document renderer is not installed" }
 private fun now()=Timestamp.from(Instant.now())
 private fun template(id:UUID,lock:Boolean=false)=jdbc.queryForMap("select * from medol_document_templates where id=?"+(if(lock) " for update" else ""),id)
 private fun job(id:UUID,lock:Boolean=false)=jdbc.queryForMap("select * from medol_document_jobs where id=?"+(if(lock) " for update" else ""),id)
 private fun json(value:Any)=mapper.writeValueAsString(value)
 private fun event(kind:String,id:UUID,revision:Long,payload:Map<String,Any?>,actor:String) {
  val eventId=UUID.nameUUIDFromBytes("documents:$kind:$id:$revision".toByteArray(Charsets.UTF_8))
  jdbc.update("insert into medol_document_outbox(id,event_kind,payload_json,actor_id,correlation_id,created_at) values (?,?,?,?,?,?)",eventId,kind,json(payload),actor,id.toString(),now())
 }
 private fun templateEvent(kind:String,row:Map<String,Any?>,actor:String) {
  event(kind,row["id"] as UUID,(row["revision"] as Number).toLong(),mapOf(
   "templateVersionId" to row["id"],"templateKey" to row["template_key"],"versionLabel" to row["version_label"],
   "providerKey" to row["provider_key"],"contractVersion" to row["contract_version"],"rendererKey" to row["renderer_key"],
   "templateContent" to row["template_json"],"revision" to row["revision"],"state" to row["state"]),actor)
 }
 private fun jobEvent(kind:String,row:Map<String,Any?>,actor:String=row["requested_by"] as String) {
  event(kind,row["id"] as UUID,(row["revision"] as Number).toLong(),mapOf(
   "documentId" to row["id"],"templateVersionId" to row["template_id"],"objectRef" to row["object_ref"],
   "locale" to row["locale"],"timeZone" to row["time_zone"],"requestedBy" to row["requested_by"],
   "revision" to row["revision"],"state" to row["state"],"fileRef" to row["file_ref"],"fileHash" to row["file_hash"],"errorCode" to row["error_code"]),actor)
 }
 private fun templateText(content:String,provider:DocumentDataProvider,renderer:DocumentRenderer):String {
  require(content.toByteArray(Charsets.UTF_8).size<=262144) { "Template exceeds 256 KiB" }
  val parsed=try {requireNotNull(mapper.readTree(content)) { "Template JSON is empty" }} catch(e:com.fasterxml.jackson.core.JsonProcessingException) {throw IllegalArgumentException("Template must be valid JSON",e)}
  renderer.validate(parsed,provider.contract)
  return json(parsed)
 }
 fun create(definition:TemplateDefinition,actor:String) {enabled();identity(actor);tx {
  with(definition) {
   require(templateKey.matches(Regex("[A-Za-z0-9_.-]{1,160}")) && versionLabel.matches(Regex("[A-Za-z0-9_.-]{1,100}")))
   val p=provider(providerKey);require(p.contract.version==contractVersion) { "Contract version mismatch" }
   val content=templateText(templateContent,p,renderer(rendererKey));val schema=json(p.contract)
   val inserted=jdbc.update("insert into medol_document_templates(id,template_key,version_label,provider_key,contract_version,contract_json,renderer_key,template_json,revision,state,template_hash) values (?,?,?,?,?,?,?,?,1,'Draft',?) on conflict do nothing",templateVersionId,templateKey,versionLabel,providerKey,contractVersion,schema,rendererKey,content,documentHash(content))
   val existing=jdbc.queryForList("select * from medol_document_templates where id=? for update",templateVersionId).firstOrNull()
   require(existing!=null) { "Template key/version already exists" }
   if(inserted==0) require(existing["state"]=="Draft" && existing["template_key"]==templateKey && existing["version_label"]==versionLabel && existing["provider_key"]==providerKey && existing["contract_json"]==schema && existing["renderer_key"]==rendererKey && existing["template_json"]==content) { "Template identifier already used" }
   else templateEvent("DocumentTemplateVersionCreated",existing,actor)
  };true
 } }
 fun revise(id:UUID,expected:Long,content:String,actor:String) {enabled();identity(actor);tx {
  val t=template(id,true);require(t["state"]=="Draft" && (t["revision"] as Number).toLong()==expected) { "Template is immutable or revision changed" }
  val p=provider(t["provider_key"] as String);require(json(p.contract)==t["contract_json"]) { "Contract changed; create a new template version" }
  val text=templateText(content,p,renderer(t["renderer_key"] as String))
  jdbc.update("update medol_document_templates set template_json=?,template_hash=?,revision=revision+1 where id=?",text,documentHash(text),id)
  templateEvent("DocumentTemplateVersionRevised",template(id),actor);true
 } }
 fun transition(id:UUID,expected:Long,publish:Boolean,actor:String) {enabled();identity(actor);tx {
  val t=template(id,true);require(t["state"]==(if(publish) "Draft" else "Published") && (t["revision"] as Number).toLong()==expected) { "Invalid template state or revision" }
  if(publish) {
   val p=provider(t["provider_key"] as String);require(json(p.contract)==t["contract_json"]) { "Contract changed" }
   val r=renderer(t["renderer_key"] as String);r.validate(mapper.readTree(t["template_json"] as String),p.contract);r.version()
  }
  jdbc.update("update medol_document_templates set state=?,revision=revision+1 where id=?",if(publish) "Published" else "Retired",id)
  templateEvent(if(publish) "DocumentTemplateVersionPublished" else "DocumentTemplateVersionRetired",template(id),actor);true
 } }
 fun request(id:UUID,templateId:UUID,input:DocumentInput,actor:String) {enabled();val who=identity(actor);tx {
  require(input.objectRef.isNotBlank() && input.objectRef.length<=1000 && input.locale.length<=80 && input.timeZone.length<=100)
  require(java.util.Locale.forLanguageTag(input.locale).language.isNotBlank());java.time.ZoneId.of(input.timeZone)
  val requestHash=documentHash(json(listOf(templateId,input,actor)))
  jdbc.update("insert into medol_document_request_keys(id,request_hash) values (?,?) on conflict do nothing",id,requestHash)
  require(jdbc.queryForObject("select request_hash from medol_document_request_keys where id=? for update",String::class.java,id)==requestHash) { "Document identifier already used with other inputs" }
  val previous=jdbc.queryForList("select * from medol_document_jobs where id=? for update",id).firstOrNull()
  if(previous!=null) {require(previous["request_hash"]==requestHash) { "Document identifier already used with other inputs" };authorize(previous,who,DocumentAction.GENERATE);return@tx true}
  val t=template(templateId,true);require(t["state"]=="Published") { "Template must be Published" }
  val p=provider(t["provider_key"] as String);require(json(p.contract)==t["contract_json"]) { "Data contract changed; publish a compatible template version" }
  p.authorize(who,input.objectRef,DocumentAction.GENERATE)
  val snapshot=p.snapshot(who,input);require(snapshot.sourceVersion.isNotBlank()) { "Snapshot source version required" };validation.data(p.contract,snapshot.data)
  val snapshotJson=json(snapshot.data);require(snapshotJson.toByteArray(Charsets.UTF_8).size<=4194304) { "Snapshot exceeds 4 MiB" }
  val r=renderer(t["renderer_key"] as String);val rv=r.version()
  val inputHash=documentHash(json(listOf(requestHash,t["template_hash"],t["contract_json"],snapshot.sourceVersion,documentHash(snapshotJson),r.key,rv)))
  jdbc.update("insert into medol_document_jobs(id,template_id,request_hash,object_ref,locale,time_zone,requested_by,provider_key,source_version,contract_json,template_json,snapshot_json,template_hash,snapshot_hash,input_hash,renderer_key,renderer_version,revision,state,attempts,retry_at,created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'Requested',0,?,?)",
   id,templateId,requestHash,input.objectRef,input.locale,input.timeZone,actor,p.key,snapshot.sourceVersion,t["contract_json"],t["template_json"],snapshotJson,t["template_hash"],documentHash(snapshotJson),inputHash,r.key,rv,now(),now())
  jobEvent("DocumentGenerationRequested",job(id));true
 } }
 private fun authorize(row:Map<String,Any?>,who:DocumentIdentity,action:DocumentAction)=provider(row["provider_key"] as String).authorize(who,row["object_ref"] as String,action)
 fun retry(id:UUID,expected:Long,actor:String) {enabled();tx {
  val j=job(id,true);authorize(j,identity(actor),DocumentAction.GENERATE)
  val expired=j["state"]=="Processing" && jdbc.queryForObject("select retry_at<CURRENT_TIMESTAMP from medol_document_jobs where id=?",Boolean::class.java,id)==true
  require((j["state"]=="Failed" || expired) && (j["revision"] as Number).toLong()==expected) { "Only failed or expired jobs at the current revision can retry" }
  jdbc.update("update medol_document_jobs set state='Requested',revision=revision+1,attempts=0,lease_token=null,retry_at=?,error_code=null where id=?",now(),id)
  jobEvent("DocumentGenerationRetried",job(id),actor);true
 } }
 fun status(id:UUID,actor:String):Map<String,Any?> {
  val j=job(id);authorize(j,identity(actor),DocumentAction.READ)
  return j.filterKeys {it in setOf("id","template_id","object_ref","source_version","locale","time_zone","requested_by","revision","state","attempts","file_ref","file_hash","error_code","created_at","renderer_key","renderer_version","template_hash","snapshot_hash")}
 }
 fun download(id:UUID,actor:String):ByteArray {
  val j=job(id);authorize(j,identity(actor),DocumentAction.READ);require(j["state"]=="Completed") { "Document is not complete" }
  return files.read(id,j["input_hash"] as String,j["file_hash"] as String)
 }
 fun projectCatalogue(isTemplate:Boolean,id:UUID,block:()->Unit) {
  TransactionTemplate(tx.transactionManager!!).execute {
   val table=if(isTemplate) "medol_document_templates" else "medol_document_jobs"
   require(jdbc.queryForList("select id from $table where id=? for update",id).isNotEmpty()) { "Restore document operational records before replay" }
   block()
  }
 }
 fun source(id:UUID):String=template(id)["template_json"] as String
 fun preview(id:UUID,sample:com.fasterxml.jackson.databind.JsonNode):ByteArray {
  val t=template(id);val contract=mapper.readValue(t["contract_json"] as String,DocumentContract::class.java)
  require(json(sample).toByteArray(Charsets.UTF_8).size<=4194304);validation.data(contract,sample)
  val r=renderer(t["renderer_key"] as String);val content=mapper.readTree(t["template_json"] as String);r.validate(content,contract);val bytes=r.render(content,sample);require(bytes.size in 1..33554432) { "Document output exceeds 32 MiB" };return bytes
 }
 @Scheduled(fixedDelayString="\${medol.documents.worker-delay-ms:1000}")
 fun runPending() {
  if(!properties.enabled) return
  try {work()} catch(e:Exception) {org.slf4j.LoggerFactory.getLogger(javaClass).warn("Document worker unavailable: {}",e.javaClass.simpleName)}
 }
 private fun work() {
  val claimed=tx {
   val j=jdbc.queryForList("select * from medol_document_jobs where state in ('Requested','Failed','Processing') and attempts<5 and retry_at<=CURRENT_TIMESTAMP order by retry_at limit 1 for update skip locked").firstOrNull() ?: return@tx emptyMap<String,Any?>()
   val token=UUID.randomUUID();jdbc.update("update medol_document_jobs set state='Processing',revision=revision+1,attempts=attempts+1,lease_token=?,retry_at=? where id=?",token,Timestamp.from(Instant.now().plusSeconds(300)),j["id"])
   val current=job(j["id"] as UUID);jobEvent("DocumentGenerationStarted",current);current
  }
  if(claimed.isEmpty()) return
  val id=claimed["id"] as UUID;val token=claimed["lease_token"] as UUID
  try {
   val inputHash=claimed["input_hash"] as String
   require(inputHash==documentHash(json(listOf(claimed["request_hash"],claimed["template_hash"],claimed["contract_json"],claimed["source_version"],claimed["snapshot_hash"],claimed["renderer_key"],claimed["renderer_version"])))) { "Frozen document metadata checksum mismatch" }
   val artifact=files.find(id,inputHash) ?: run {
    val r=renderer(claimed["renderer_key"] as String);require(r.version()==claimed["renderer_version"]) { "Renderer version changed" }
    require(documentHash(claimed["template_json"] as String)==claimed["template_hash"] && documentHash(claimed["snapshot_json"] as String)==claimed["snapshot_hash"]) { "Frozen document input checksum mismatch" }
    val contract=mapper.readValue(claimed["contract_json"] as String,DocumentContract::class.java)
    val template=mapper.readTree(claimed["template_json"] as String);val data=mapper.readTree(claimed["snapshot_json"] as String)
    validation.data(contract,data);r.validate(template,contract)
    val bytes=r.render(template,data);require(r.version()==claimed["renderer_version"]) { "Renderer changed during rendering" };require(bytes.size in 1..33554432) { "Document output exceeds 32 MiB" }
    files.putIfAbsent(id,inputHash,bytes)
   }
   tx {
    val changed=jdbc.update("update medol_document_jobs set state='Completed',revision=revision+1,file_ref=?,file_hash=?,error_code=null where id=? and lease_token=? and state='Processing'",artifact.reference,artifact.sha256,id,token)
    if(changed==1) jobEvent("DocumentGenerationCompleted",job(id));true
   }
  } catch(e:Exception) {tx {
   val changed=jdbc.update("update medol_document_jobs set state='Failed',revision=revision+1,error_code=?,retry_at=? where id=? and lease_token=? and state='Processing'",e.javaClass.simpleName.take(100),Timestamp.from(Instant.now().plusSeconds(30)),id,token)
   if(changed==1) jobEvent("DocumentGenerationFailed",job(id));true
  }}
 }
}
