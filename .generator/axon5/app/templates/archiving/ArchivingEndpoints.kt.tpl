// Generated MEDOL archiving authenticated history and execution status API.
package <%= rootPackage %>.archiving.infrastructure

import java.util.UUID
import org.springframework.web.bind.annotation.*
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.server.ResponseStatusException
import org.springframework.http.HttpStatus

@RestController
@RequestMapping("/api/archiving")
class ArchivingEndpoints(private val service: ArchivingService) {
 @ExceptionHandler(IllegalArgumentException::class)
 @ResponseStatus(HttpStatus.BAD_REQUEST)
 fun invalidRequest(error: IllegalArgumentException) = mapOf("detail" to (error.message ?: "Invalid archiving request"))

 @ExceptionHandler(org.springframework.dao.EmptyResultDataAccessException::class)
 @ResponseStatus(HttpStatus.NOT_FOUND)
 fun notFound() = mapOf("detail" to "Archive record does not exist")

 @GetMapping("/batches/{batchId}")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('archive_batch_catalog:read')")
 fun batch(@PathVariable batchId: UUID) = service.status(batchId) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND)

 @GetMapping("/restores/{restoreId}")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('archive_restore_catalog:read')")
 fun restore(@PathVariable restoreId: UUID) = service.restoreStatus(restoreId) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND)

 @PostMapping("/batches/{batchId}/retry")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('request_archive_batch:execute')")
 fun retryBatch(@PathVariable batchId: UUID) = service.retryFailed(batchId,"BATCH")

 @PostMapping("/restores/{restoreId}/retry")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('request_archive_restore:execute')")
 fun retryRestore(@PathVariable restoreId: UUID) = service.retryFailed(restoreId,"RESTORE")

 @GetMapping("/archives")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('archive_batch_catalog:read')")
 fun history(@RequestParam(required=false) targetKey: String?, @RequestParam(defaultValue="50") limit: Int, @RequestParam(required=false) after: UUID?) = service.list(targetKey,limit,after)

 @GetMapping("/archives/{archiveId}")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('archive_batch_catalog:read')")
 fun read(@PathVariable archiveId: UUID) = service.read(archiveId)
}
