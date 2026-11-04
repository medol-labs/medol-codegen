package <%= rootPackage %>.shared.application.metadata

import java.time.Instant
import java.util.UUID
import org.axonframework.messaging.eventhandling.annotation.Event

data class OperationAuditObservation(
    val category: String,
    val operation: String,
    val outcome: String,
    val started: Instant,
    val actorId: String? = null,
    val tenantId: String? = null,
    val messageId: String? = null,
    val correlationId: String? = null,
    val targetId: String? = null,
    val errorCode: String? = null,
    val httpStatus: Int? = null,
    val completed: Instant = Instant.now()
)

/** Infrastructure event: no public command or business payload. */
@Event(namespace = "medol.audit", name = "OperationExecutionRecorded", version = "1.0")
data class OperationExecutionRecorded(
    val auditRecordId: UUID,
    val sourceDeployment: String,
    val observation: OperationAuditObservation
)
