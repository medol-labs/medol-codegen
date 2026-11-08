// Generated MEDOL archiving completion event publisher.
package <%= rootPackage %>.archiving.infrastructure

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
class ArchivingOutboxPublisher(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper,
 private val transactions: PlatformTransactionManager, private val stores: ObjectProvider<EventStore>) {
 private val log = org.slf4j.LoggerFactory.getLogger(javaClass)
 @Scheduled(fixedDelayString="\${medol.archiving.outbox-delay-ms:1000}")
 fun publishPending() {
  try { repeat(20) {
   val processed = TransactionTemplate(transactions).apply { propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW }.execute {
    val rows = jdbc.query("select id,payload_json,created_at from medol_archive_outbox where delivered=false order by created_at,id limit 1 for update", {rs,_ ->
     Triple(rs.getObject("id",UUID::class.java),rs.getString("payload_json"),rs.getTimestamp("created_at").toInstant())
    })
    val row = rows.firstOrNull() ?: return@execute false
    val event = mapper.readValue(row.second,ArchiveOperationRecorded::class.java)
    stores.getObject().publish(null,listOf(GenericEventMessage(row.first.toString(),MessageType(ArchiveOperationRecorded::class.java),event,
     mapOf("userId" to "archiving-worker", "correlationId" to (event.batchId ?: event.restoreId ?: event.archiveId).toString()),row.third))).join()
    jdbc.update("update medol_archive_outbox set delivered=true where id=?",row.first)
    true
   }
   if(processed!=true) return
  }} catch(error: Exception) { log.error("Archive completion publication failed: {}",error.javaClass.simpleName) }
 }
}
