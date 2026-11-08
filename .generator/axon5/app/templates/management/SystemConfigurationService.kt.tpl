package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.stereotype.Service
import java.util.UUID
import java.time.Duration
<% if (tenancy) { %>import <%= rootPackage %>.shared.application.tenancy.TenantAccess
<% } %>

@Service
class SystemConfigurationService(private val store:ManagementStore,private val mapper:ObjectMapper,
 definitions:List<ConfigurationDefinitionProvider><% if (tenancy) { %>,private val tenants:TenantAccess<% } %>) {
 private val providers=definitions.associateBy {it.groupKey}
 private val capability="configuration"
 init {
  require(providers.size==definitions.size) {"Duplicate configuration group"}
  definitions.forEach {p->
   require(p.groupKey.matches(Regex("[A-Za-z][A-Za-z0-9._-]{0,99}")) && p.version.isNotBlank() && p.version.length<=100)
   require(p.definitions.isNotEmpty() && p.definitions.size<=200 && p.definitions.map {it.key}.distinct().size==p.definitions.size)
   p.definitions.forEach {d->
    require(d.key.matches(Regex("[A-Za-z][A-Za-z0-9._-]{0,99}")))
    require(d.type in setOf("boolean","integer","decimal","string","enum","duration","json","secretReference"))
    require(d.effect in setOf("DYNAMIC","NEW_OPERATION")) {"Restart/reload settings belong to deployment configuration"}
    require(d.minimum==null || d.maximum==null || d.minimum<=d.maximum)
    require(d.type!="enum" || d.choices.isNotEmpty())
    d.defaultValue?.let {value(d,it)}
   }
  }
 }
 private fun provider(group:String)=requireNotNull(providers[group]) {"Configuration definition provider is not installed"}
 private fun required(input:JsonNode,key:String)=input.path(key).asText().takeIf {it.isNotBlank()} ?: throw IllegalArgumentException("$key is required")
 private fun parse(text:String):ObjectNode {
  require(text.toByteArray().size<=262144) {"Configuration JSON exceeds 256 KiB"}
  val node=try {mapper.readTree(text)} catch(e:Exception) {throw IllegalArgumentException("Invalid configuration JSON")}
  require(node is ObjectNode) {"Configuration values must be a JSON object"};return node
 }
 private fun scope(type:String,id:String,actor:String) {
  require(actor.isNotBlank() && actor!="anonymous") {"Authentication required"}
  when(type) {
   "APPLICATION" -> require(id=="application") {"Application scope ID must be application"}
   "TENANT" -> {
    require(id.isNotBlank() && id.length<=160)
<% if (tenancy) { %>    require(tenants.verify(id,actor).tenantId==id) {"Use the canonical tenant identifier"}
<% } else { %>    throw IllegalArgumentException("Tenant management is not enabled")
<% } %>   }
   else -> throw IllegalArgumentException("Unsupported configuration scope")
  }
 }
 private fun value(d:ConfigurationDefinition,v:JsonNode) {
  require(!v.isNull) {"${d.key} cannot be null"}
  val valid=when(d.type) {
   "boolean" -> v.isBoolean
   "integer" -> v.isIntegralNumber && v.canConvertToLong()
   "decimal" -> v.isNumber
   "string" -> v.isTextual && v.asText().length<=10000
   "enum" -> v.isTextual && v.asText() in d.choices
   "duration" -> v.isTextual && runCatching {val duration=Duration.parse(v.asText());!duration.isNegative && !duration.isZero}.getOrDefault(false)
   "secretReference" -> v.isTextual && v.asText().matches(Regex("[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9/_.-]{1,500}"))
   "json" -> v.isObject || v.isArray
   else -> false
  }
  require(valid) {"Invalid value for ${d.key} (${d.type})"}
  if(v.isNumber) require((d.minimum==null || v.decimalValue()>=d.minimum) && (d.maximum==null || v.decimalValue()<=d.maximum)) {"${d.key} is outside its allowed range"}
 }
 private fun checkedOverrides(p:ConfigurationDefinitionProvider,row:JsonNode,enforceVersion:Boolean=true):ObjectNode {
  require(!enforceVersion || row.path("definitionVersion").asText()==p.version) {"Configuration definition changed; migrate the stored set before use"}
  val overrides=parse(row.path("valuesJson").asText());val definitions=p.definitions.associateBy {it.key}
  overrides.fields().forEach { (key,v)->val d=requireNotNull(definitions[key]) {"Unknown configuration key: $key"};if(row.path("scopeType").asText()=="TENANT") require(d.tenantOverride) {"$key does not allow tenant overrides"};value(d,v)}
  return overrides
 }
 private fun effective(p:ConfigurationDefinitionProvider,app:JsonNode?,tenant:JsonNode?,enforceVersion:Boolean=true):ConfigurationSnapshot {
  val values=linkedMapOf<String,JsonNode>();val sources=linkedMapOf<String,String>()
  p.definitions.forEach {d->d.defaultValue?.let {values[d.key]=it.deepCopy();sources[d.key]="DEFAULT"}}
  listOf(app,tenant).filterNotNull().forEach {row->checkedOverrides(p,row,enforceVersion).fields().forEach {(key,v)->values[key]=v.deepCopy();sources[key]=row.path("scopeType").asText()}}
  p.definitions.forEach {d->val v=values[d.key];require(v!=null || !d.required) {"Missing required configuration: ${d.key}"};v?.let {value(d,it)}}
  p.validate(values.mapValues {it.value.deepCopy<JsonNode>()})
  return ConfigurationSnapshot(p.groupKey,p.version,app?.path("revision")?.asLong() ?: 0,tenant?.path("revision")?.asLong() ?: 0,values,sources)
 }
 private fun sets(group:String)=store.rows(capability,"ConfigurationSet").filter {it.path("groupKey").asText()==group}
 private fun checkAll(p:ConfigurationDefinitionProvider,candidate:ObjectNode) {
  val rows=sets(p.groupKey).filter {it.path("configurationSetId")!=candidate.path("configurationSetId")}+listOf(candidate)
  val app=rows.firstOrNull {it.path("scopeType").asText()=="APPLICATION"}
  // Validate compatibility under the current definition without silently migrating other sets.
  // Reads still require their stored definitionVersion to match.
  effective(p,app,null,false)
  val tenants=if(candidate.path("scopeType").asText()=="TENANT") listOf(candidate) else rows.filter {it.path("scopeType").asText()=="TENANT"}
  tenants.forEach {effective(p,app,it,false)}
 }
 fun execute(operation:String,input:JsonNode,actor:String):Unit=store.locked(capability) {
  val id=UUID.fromString(required(input,"configurationSetId"));val reason=required(input,"reason");require(reason.length<=1000)
  val existing=store.record(capability,id)
  val create=operation=="CreateConfigurationSet"
  val row=if(create) mapper.createObjectNode().apply {
   put("configurationSetId",id.toString());put("groupKey",required(input,"groupKey"));put("scopeType",required(input,"scopeType"));put("scopeId",required(input,"scopeId"));put("valuesJson",required(input,"valuesJson"));put("state","Active")
  } else requireNotNull(existing) {"Configuration set does not exist"}
  scope(row.path("scopeType").asText(),row.path("scopeId").asText(),actor)
  val p=provider(row.path("groupKey").asText())
  if(create) {
   row.put("definitionVersion",p.version);row.put("valuesJson",mapper.writeValueAsString(parse(row.path("valuesJson").asText())))
   if(existing!=null) {require(listOf("groupKey","scopeType","scopeId","valuesJson","definitionVersion").all {existing[it]==row[it]}) {"Configuration ID already exists with different data"};return@locked}
   require(sets(p.groupKey).none {it.path("scopeType")==row.path("scopeType") && it.path("scopeId")==row.path("scopeId")}) {"Configuration scope already exists"}
  } else {
   require(input.path("expectedRevision").isIntegralNumber && input.path("expectedRevision").asLong()==row.path("revision").asLong()) {"Revision conflict"}
   when(operation) {
    "ChangeConfigurationSet" -> {
     val overrides=parse(row.path("valuesJson").asText());val patch=parse(required(input,"changesJson"));val allowed=p.definitions.map {it.key}.toSet()
     patch.fields().forEach {(key,v)->require(key in allowed || (v.isNull && overrides.has(key))) {"Unknown configuration key: $key"};if(v.isNull) overrides.remove(key) else overrides.set<JsonNode>(key,v)}
     row.put("valuesJson",mapper.writeValueAsString(overrides))
    }
    "RollbackConfigurationSet" -> {require(input.path("targetRevision").isIntegralNumber);val previous=store.historical(capability,id,input.path("targetRevision").asLong());row.put("valuesJson",previous.path("valuesJson").asText())}
    else -> throw IllegalArgumentException("Unsupported configuration operation")
   }
   row.put("definitionVersion",p.version)
  }
  row.put("reason",reason);checkAll(p,row)
  val event=when(operation) {"CreateConfigurationSet"->"ConfigurationSetCreated";"ChangeConfigurationSet"->"ConfigurationSetChanged";else->"ConfigurationSetRolledBack"}
  store.save(capability,"ConfigurationSet",id,row,event,actor)
 }
 /** Fresh authoritative read on every call. No distributed stale-value cache; pin this snapshot for long jobs. */
 fun resolve(group:String,tenantId:String?,actor:String):ConfigurationSnapshot=store.locked(capability) {
  scope(if(tenantId==null) "APPLICATION" else "TENANT",tenantId ?: "application",actor)
  val rows=sets(group)
  effective(provider(group),rows.firstOrNull {it.path("scopeType").asText()=="APPLICATION"},tenantId?.let {id->rows.firstOrNull {it.path("scopeType").asText()=="TENANT" && it.path("scopeId").asText()==id}})
 }
 fun definitions()=providers.values.map {mapOf("groupKey" to it.groupKey,"version" to it.version,"definitions" to it.definitions)}
 fun history(id:UUID,actor:String,after:Long,limit:Int)=store.locked(capability) {
  val row=requireNotNull(store.record(capability,id));scope(row.path("scopeType").asText(),row.path("scopeId").asText(),actor);store.history(capability,id,after,limit)
 }
}
