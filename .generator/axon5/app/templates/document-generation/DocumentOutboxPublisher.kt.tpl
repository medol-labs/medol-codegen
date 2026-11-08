package <%= rootPackage %>.documentgeneration.infrastructure

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
class DocumentOutboxPublisher(private val jdbc:JdbcTemplate,private val mapper:ObjectMapper,
 private val transactions:PlatformTransactionManager,private val stores:ObjectProvider<EventStore>) {
 @Scheduled(fixedDelayString="\${medol.documents.outbox-delay-ms:1000}")
 fun publishPending() {
  try {repeat(30) {
   val sent=TransactionTemplate(transactions).apply {propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW;timeout=30}.execute {
    val row=jdbc.queryForList("select * from medol_document_outbox where delivered=false order by created_at,id limit 1 for update").firstOrNull() ?: return@execute false
    val type=when(row["event_kind"]) {
<%- eventTypes %>
     else -> error("Unsupported document event")
    }
    val event=mapper.readValue(row["payload_json"] as String,type)
    val created=jdbc.queryForObject("select created_at from medol_document_outbox where id=?",java.sql.Timestamp::class.java,row["id"])!!.toInstant()
    stores.getObject().publish(null,listOf(GenericEventMessage(row["id"].toString(),MessageType(type),event,
     mapOf("userId" to row["actor_id"].toString(),"correlationId" to row["correlation_id"].toString()),created))).join()
    jdbc.update("update medol_document_outbox set delivered=true where id=?",row["id"]);true
   }
   if(sent!=true) return
  }} catch(error:Exception) {org.slf4j.LoggerFactory.getLogger(javaClass).error("Document event publication failed: {}",error.javaClass.simpleName)}
 }
}
