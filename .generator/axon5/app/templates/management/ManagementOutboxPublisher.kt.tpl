package <%= rootPackage %>.management.infrastructure

import java.util.UUID
import com.fasterxml.jackson.databind.ObjectMapper
import org.axonframework.eventsourcing.eventstore.EventStore
import org.axonframework.messaging.eventhandling.GenericEventMessage
import org.axonframework.messaging.core.MessageType
import org.springframework.beans.factory.ObjectProvider
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate

@Component
class ManagementOutboxPublisher(private val jdbc:JdbcTemplate,private val mapper:ObjectMapper,
 private val transactions:PlatformTransactionManager,private val stores:ObjectProvider<EventStore>) {
 @Scheduled(fixedDelayString="\${medol.management.outbox-delay-ms:1000}")
 fun publishPending() {
<% if (tenancy) { %>  <%= rootPackage %>.shared.application.tenancy.TenantScope.control { publishControl() }
<% } else { %>  publishControl()
<% } %> }
 private fun publishControl() {
  try {repeat(30) {
   val sent=TransactionTemplate(transactions).apply {propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW;timeout=30}.execute {
    val row=jdbc.queryForList("select * from medol_management_outbox where delivered=false and capability in (<%- capabilities.map(c => "'" + c + "'").join(",") %>) order by created_at,event_id limit 1 for update").firstOrNull() ?: return@execute false
    val type=when(row["event_kind"]) {
<%- eventTypes %>
     else -> error("Unsupported management event")
    }
    val event=mapper.readValue(row["payload_json"] as String,type)
    val created=jdbc.queryForObject("select created_at from medol_management_outbox where event_id=?",java.sql.Timestamp::class.java,row["event_id"])!!.toInstant()
    stores.getObject().publish(null,listOf(GenericEventMessage(row["event_id"].toString(),MessageType(type),event,
     mapOf("userId" to row["actor_id"].toString(),"correlationId" to row["correlation_id"].toString()),created))).join()
    jdbc.update("update medol_management_outbox set delivered=true where event_id=?",row["event_id"]);true
   }
   if(sent!=true) return
  }} catch(error:Exception) {org.slf4j.LoggerFactory.getLogger(javaClass).error("Management event publication failed: {}",error.javaClass.simpleName)}
 }
}
