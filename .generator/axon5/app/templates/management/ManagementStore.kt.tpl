// Generated MEDOL management runtime. Do not remove authoritative history or pending outbox rows.
package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.time.Instant
import java.sql.Timestamp

@Component
class ManagementStore(private val jdbc:JdbcTemplate,private val mapper:ObjectMapper,transactions:PlatformTransactionManager) {
 private val tx=TransactionTemplate(transactions).apply {propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW;timeout=30}
 init { require((transactions as? org.springframework.orm.jpa.JpaTransactionManager)?.dataSource === jdbc.dataSource ||
  (transactions as? org.springframework.jdbc.datasource.DataSourceTransactionManager)?.dataSource === jdbc.dataSource) {"Management requires the primary datasource transaction manager"} }
 fun <T> locked(capability:String,block:()->T):T =
<% if (tenancy) { %>  <%= rootPackage %>.shared.application.tenancy.TenantScope.control { transaction(capability,block) }
<% } else { %>  transaction(capability,block)
<% } %>
 private fun <T> transaction(capability:String,block:()->T):T {
  var result:Any?=null
  tx.executeWithoutResult {
   jdbc.queryForObject("select capability from medol_management_locks where capability=? for update",String::class.java,capability)
   result=block()
  }
  @Suppress("UNCHECKED_CAST") return result as T
 }
 fun record(capability:String,id:UUID):ObjectNode?=jdbc.queryForList("select payload_json from medol_management_records where capability=? and id=?",capability,id).firstOrNull()?.let {mapper.readTree(it["payload_json"] as String) as ObjectNode}
 fun rows(capability:String,kind:String):List<ObjectNode> = jdbc.queryForList("select payload_json from medol_management_records where capability=? and kind=? order by id",capability,kind).map {mapper.readTree(it["payload_json"] as String) as ObjectNode}
 fun historical(capability:String,id:UUID,revision:Long):ObjectNode = jdbc.queryForList("select payload_json from medol_management_history where capability=? and id=? and revision=?",capability,id,revision).firstOrNull()?.let {mapper.readTree(it["payload_json"] as String) as ObjectNode} ?: throw IllegalArgumentException("Revision does not exist")
 fun history(capability:String,id:UUID,after:Long,limit:Int):List<Map<String,Any>> {
  require(after>=0 && limit in 1..200)
  return jdbc.queryForList("select revision,event_kind,actor_id,created_at,payload_json from medol_management_history where capability=? and id=? and revision>? order by revision limit ?",capability,id,after,limit).map {row->row.filterKeys {it!="payload_json"}+mapOf("snapshot" to mapper.readTree(row["payload_json"] as String))}
 }
 fun save(capability:String,kind:String,id:UUID,row:ObjectNode,event:String,actor:String) {
  require(actor.isNotBlank() && actor.length<=160 && actor!="anonymous") {"Authenticated management identity required"}
  val current=record(capability,id);val revision=(current?.path("revision")?.asLong() ?: 0L)+1
  row.put("revision",revision)
  val json=mapper.writeValueAsString(row);require(json.toByteArray().size<=1048576) {"Management snapshot too large"}
  val eventId=UUID.nameUUIDFromBytes("management:$capability:$id:$revision".toByteArray())
  if(current==null) jdbc.update("insert into medol_management_records(capability,id,kind,revision,payload_json) values (?,?,?,?,?)",capability,id,kind,revision,json)
  else jdbc.update("update medol_management_records set revision=?,payload_json=? where capability=? and id=?",revision,json,capability,id)
  val now=Timestamp.from(Instant.now())
  jdbc.update("insert into medol_management_history(capability,id,revision,event_id,event_kind,payload_json,actor_id,created_at) values (?,?,?,?,?,?,?,?)",capability,id,revision,eventId,event,json,actor,now)
  jdbc.update("insert into medol_management_outbox(event_id,capability,event_kind,payload_json,actor_id,correlation_id,created_at) values (?,?,?,?,?,?,?)",eventId,capability,event,json,actor,id.toString(),now)
 }
}
