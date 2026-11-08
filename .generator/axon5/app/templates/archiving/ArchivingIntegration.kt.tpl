// Generated MEDOL archiving event integration. Operational records must survive replay resets.
package <%= rootPackage %>.archiving.infrastructure

import org.axonframework.messaging.core.annotation.Namespace
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.eventhandling.replay.annotation.DisallowReplay
import org.springframework.stereotype.Component
import java.time.ZoneOffset
import <%= rootPackage %>.archiving.events.ArchiveBatchRequestedEvent
import <%= rootPackage %>.archiving.events.ArchiveRestoreRequestedEvent

@Component
@Namespace("archiving-integration")
@DisallowReplay
class ArchivingIntegration(private val service: ArchivingService) {
 @EventHandler
 fun on(event: ArchiveBatchRequestedEvent) = service.requestBatch(event.batchId,event.targetKey,event.cutoffAt.toInstant(ZoneOffset.UTC),event.batchSize)
 @EventHandler
 fun on(event: ArchiveRestoreRequestedEvent) = service.requestRestore(event.restoreId,event.archiveId)
}
