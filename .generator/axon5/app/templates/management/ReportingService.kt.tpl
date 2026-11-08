package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.stereotype.Service
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.AccessDeniedException
import java.util.UUID
import java.time.Instant
import java.sql.Timestamp

@Service
class ReportingService(private val store:ManagementStore,private val mapper:ObjectMapper,private val jdbc:JdbcTemplate,providers:List<ReportProvider>) {
 private val providers=providers.associateBy {it.key}.also {require(it.size==providers.size) {"Duplicate report provider"}}
 private val definitionFields=listOf("reportKey","versionLabel","reportName","providerKey","contractVersion")
 private fun actor(actor:String) {require(actor.isNotBlank() && actor!="anonymous" && actor.length<=160)}
 private fun text(n:JsonNode,key:String)=n.path(key).takeIf {it.isTextual && it.asText().isNotBlank()}?.asText() ?: throw IllegalArgumentException("$key is required")
 internal fun definition(id:UUID)=requireNotNull(store.record("reporting",id)) {"Report version does not exist"}.also {require(it.has("reportKey"))}
 internal fun provider(row:JsonNode):ReportProvider {
  val p=requireNotNull(providers[text(row,"providerKey")]) {"Report provider is not installed"}
  validateReportContract(p.contract);require(p.contract.version==text(row,"contractVersion")) {"Report contract version changed"}
  require(p.fingerprint.isNotBlank() && p.fingerprint.length<=200 && p.fingerprint==text(row,"providerFingerprint")) {"Report implementation changed; publish a new version"}
  require(mapper.readTree(text(row,"contractJson"))==mapper.valueToTree<JsonNode>(p.contract)) {"Report contract changed; publish a new version"}
  return p
 }
 private fun published(id:UUID)=definition(id).also {require(it.path("state").asText()=="Published") {"Only Published reports accept new queries or exports"}}
 internal fun parameters(raw:String,p:ReportProvider):ObjectNode {
  val n=try {reportJson(mapper,raw)} catch(e:Exception) {throw IllegalArgumentException("Invalid report parameters",e)}
  validateReportValues(n.reportValues(),p.contract.parameters);return n
 }
 fun execute(operation:String,input:JsonNode,identity:String):Unit=store.locked("reporting") {
  actor(identity)
  when(operation) {
   "RequestReportExecution"->request(input,identity)
   "RetryReportExecution"->retry(input,identity)
   else->definitionOperation(operation,input,identity)
  }
 }
 private fun definitionOperation(operation:String,input:JsonNode,identity:String) {
  require(operation in setOf("CreateReportDefinition","ReviseReportDefinition","PublishReportDefinition","RetireReportDefinition"))
  val id=UUID.fromString(text(input,"reportVersionId"));val existing=store.record("reporting",id)
  val create=operation=="CreateReportDefinition"
  if(create && existing!=null) {require(definitionFields.all {existing[it]==input[it]}) {"Report ID already exists"};return}
  val row=if(create) mapper.createObjectNode().put("reportVersionId",id.toString()) else definition(id).also {revision(it,input)}
  when(operation) {
   "CreateReportDefinition","ReviseReportDefinition"->{
    require(create || row.path("state").asText()=="Draft") {"Only Draft definitions can be revised"}
    if(!create) require(row["reportKey"]==input["reportKey"] && row["versionLabel"]==input["versionLabel"]) {"Report code and version are immutable"}
    definitionFields.forEach {row.set<JsonNode>(it,input.path(it))}
    for(key in listOf("reportKey","versionLabel","providerKey","contractVersion")) require(text(row,key).matches(Regex("[A-Za-z0-9_.-]{1,100}")))
    require(text(row,"reportName").length<=160)
    require(store.rows("reporting","ReportDefinition").none {it.path("reportVersionId").asText()!=id.toString() && it["reportKey"]==row["reportKey"] && it["versionLabel"]==row["versionLabel"]}) {"Report version already exists"}
    val p=requireNotNull(providers[text(row,"providerKey")]) {"Report provider is not installed"};validateReportContract(p.contract)
    require(p.contract.version==text(row,"contractVersion"));require(p.fingerprint.isNotBlank() && p.fingerprint.length<=200);row.put("providerFingerprint",p.fingerprint);row.put("contractJson",mapper.writeValueAsString(p.contract));row.put("state","Draft")
   }
   "PublishReportDefinition"->{require(row.path("state").asText()=="Draft");provider(row);row.put("state","Published")}
   "RetireReportDefinition"->{require(row.path("state").asText()=="Published");row.put("state","Retired")}
  }
  val event=when(operation) {"CreateReportDefinition"->"ReportDefinitionCreated";"ReviseReportDefinition"->"ReportDefinitionRevised";"PublishReportDefinition"->"ReportDefinitionPublished";else->"ReportDefinitionRetired"}
  store.save("reporting","ReportDefinition",id,row,event,identity)
 }
 private fun revision(row:JsonNode,input:JsonNode) {
  require(input.path("expectedRevision").isIntegralNumber && input.path("expectedRevision").canConvertToLong() && input.path("expectedRevision").asLong()==row.path("revision").asLong()) {"Revision conflict"}
 }
 private fun request(input:JsonNode,identity:String) {
  val id=UUID.fromString(text(input,"executionId"));val reportId=UUID.fromString(text(input,"reportVersionId"))
  val previous=jdbc.queryForList("select * from medol_report_executions where id=?",id).firstOrNull()
  if(previous!=null) {
   require(previous["actor_id"]==identity && previous["report_version_id"].toString()==reportId.toString() && mapper.readTree(previous["parameters_json"] as String)==reportJson(mapper,text(input,"parametersJson"))) {"Execution ID already exists with different input"}
   authorizedJob(id,identity,ReportAction.EXPORT);return
  }
  require(store.record("reporting",id)==null) {"Execution ID collides with an existing definition"}
  val row=published(reportId);val p=provider(row);val params=parameters(text(input,"parametersJson"),p)
  p.authorize(identity,params.deepCopy(),ReportAction.EXPORT)
  jdbc.update("insert into medol_report_executions(id,report_version_id,actor_id,parameters_json,definition_json,fingerprint,state,created_at) values (?,?,?,?,?,?,?,?)",id,reportId,identity,params.toString(),row.toString(),p.fingerprint,"Requested",Timestamp.from(Instant.now()))
  val task=mapper.createObjectNode().put("executionId",id.toString()).put("reportVersionId",reportId.toString()).put("requestedBy",identity).put("state","Requested").put("attempt",0).put("rowCount",0)
  store.save("reporting","ReportExecution",id,task,"ReportExecutionRequested",identity)
 }
 private fun retry(input:JsonNode,identity:String) {
  val id=UUID.fromString(text(input,"executionId"));val job=authorizedJob(id,identity,ReportAction.EXPORT)
  val row=requireNotNull(store.record("reporting",id));revision(row,input)
  require(row.path("state").asText()=="Failed" || (row.path("state").asText()=="Processing" && jdbc.queryForObject("select count(*) from medol_report_executions where id=? and lease_until<CURRENT_TIMESTAMP",Int::class.java,id)==1)) {"Only failed or expired executions may retry"}
  providerForJob(job)
  jdbc.update("update medol_report_executions set state='Requested',attempt_token=null,lease_until=null,source_json=null where id=?",id)
  row.put("state","Requested");row.remove(listOf("errorCode","fileHash"));row.put("rowCount",0)
  store.save("reporting","ReportExecution",id,row,"ReportExecutionRetried",identity)
 }
 internal fun providerForJob(job:Map<String,Any>):ReportProvider=provider(mapper.readTree(job["definition_json"] as String)).also {require(it.fingerprint==job["fingerprint"]) {"Report implementation changed; restore it or request a new execution"}}
 internal fun authorizedJob(id:UUID,identity:String,action:ReportAction):Map<String,Any> {
  actor(identity)
  val job=jdbc.queryForList("select * from medol_report_executions where id=? and actor_id=?",id,identity).firstOrNull() ?: throw AccessDeniedException("Report execution is unavailable")
  val p=providerForJob(job);p.authorize(identity,parameters(job["parameters_json"] as String,p),action);return job
 }
 fun contract(id:UUID):ReportContract=store.locked("reporting") {provider(published(id)).contract}
 fun query(id:UUID,raw:String,identity:String,offset:Int,limit:Int):ReportPage {
  actor(identity);require(offset in 0..10000 && limit in 1..200)
  val row=store.locked("reporting") {published(id)};val p=provider(row);val params=parameters(raw,p)
  p.authorize(identity,params.deepCopy(),ReportAction.QUERY)
  val result=p.query(identity,params.deepCopy(),offset,limit)
  require(result.rows.size<=limit);result.rows.forEach {validateReportValues(it,p.contract.columns)}
  require(mapper.writeValueAsBytes(result).size<=4194304) {"Preview exceeds 4 MiB; use an export"}
  p.authorize(identity,params.deepCopy(),ReportAction.QUERY)
  audit("ReportQueryExecuted",id,null,identity);return result
 }
 fun status(id:UUID,identity:String):ObjectNode=store.locked("reporting") {
  val job=authorizedJob(id,identity,ReportAction.EXPORT)
  requireNotNull(store.record("reporting",id)).also {row->(job["source_json"] as? String)?.let {row.set<JsonNode>("source",mapper.readTree(it))}}
 }
 fun mine(reportId:UUID,identity:String,offset:Int,limit:Int):List<ObjectNode> {
  actor(identity);require(limit in 1..100 && offset in 0..10000)
  val ids=jdbc.queryForList("select id,created_at from medol_report_executions where actor_id=? and report_version_id=? order by created_at desc,id desc limit ? offset ?",identity,reportId,limit,offset)
  return ids.mapNotNull {r->try {status(UUID.fromString(r["id"].toString()),identity).put("createdAt",(r["created_at"] as Timestamp).toInstant().toString())} catch(e:AccessDeniedException) {null}}
 }
 internal fun audit(event:String,reportId:UUID,executionId:UUID?,identity:String)=store.locked("reporting") {
  val id=UUID.randomUUID();val row=mapper.createObjectNode().put("operationId",id.toString()).put("reportVersionId",reportId.toString()).put("actorId",identity)
  if(executionId!=null) row.put("executionId",executionId.toString())
  jdbc.update("insert into medol_management_outbox(event_id,capability,event_kind,payload_json,actor_id,correlation_id,created_at) values (?,?,?,?,?,?,?)",id,"reporting",event,row.toString(),identity,(executionId ?: reportId).toString(),Timestamp.from(Instant.now()))
 }
}
