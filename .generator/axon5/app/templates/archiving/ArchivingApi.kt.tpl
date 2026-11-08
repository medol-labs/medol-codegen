// Generated MEDOL archiving contract.
package <%= rootPackage %>.archiving.infrastructure

import java.time.Instant
import java.util.UUID
import com.fasterxml.jackson.databind.JsonNode

/** Immutable export, including attachment references (not attachment bytes). */
data class ArchiveSnapshot(val objectId: String, val businessVersion: String, val schemaVersion: Int,
 val payload: JsonNode, val attachmentReferences: List<String> = emptyList())
data class FrozenArchive(val token: String, val snapshot: ArchiveSnapshot)
data class ArchiveDocument(val archiveId: UUID, val targetKey: String, val snapshot: ArchiveSnapshot, val sha256: String)
data class ArchiveSummary(val archiveId: UUID, val targetKey: String, val objectId: String, val businessVersion: String, val schemaVersion: Int)
data class ArchiveOperationRecorded(val archiveId: UUID?, val batchId: UUID?, val restoreId: UUID?,
 val targetKey: String?, val operation: String, val state: String)

/** All mutation methods join the caller's primary database transaction.
 * Business writers must use the same registry object lock as project().
 * freeze locks authoritative business state and enforces retention/eligibility;
 * null means ineligible. Tokens survive process failure, cleanup is idempotent.
 * restore must reject conflicting live versions and be idempotent by restoreId.
 * Never delete aggregate events. Attachment references must remain durable.
 */
interface ArchiveTargetAdapter {
 val targetKey: String
 /** Explicit context/readModel bindings; empty only for targets without projections. */
 val projectionBindings: Set<Pair<String, String>>
 fun candidates(cutoffAt: Instant, limit: Int): List<String>
 fun freeze(objectId: String, cutoffAt: Instant): FrozenArchive?
 fun cleanup(objectId: String, frozenToken: String)
 fun restore(restoreId: UUID, snapshot: ArchiveSnapshot)
 fun projectionObjectId(context: String, readModel: String, event: Any): String? = null
}
interface ArchiveRegistry {
 fun state(targetKey: String, objectId: String): String?
 /** Must be invoked inside a primary DB transaction; locks last until commit. */
 fun lock(targetKey: String, objectId: String)
}
