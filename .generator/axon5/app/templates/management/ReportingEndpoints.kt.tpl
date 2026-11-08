package <%= rootPackage %>.management.infrastructure

import java.util.UUID
import java.time.Instant
import org.springframework.web.bind.annotation.*
import org.springframework.http.*
import org.springframework.core.io.FileSystemResource
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.context.SecurityContextHolder
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import <%= rootPackage %>.shared.security.CurrentUser

@RestController
@RequestMapping("/api/reports")
class ReportingEndpoints(private val service:ReportingService,private val worker:ReportingWorker,private val mapper:ObjectMapper) {
 private fun actor()=(SecurityContextHolder.getContext().authentication?.principal as? CurrentUser)?.id?.toString() ?: throw AccessDeniedException("Authenticated report identity required")
 data class Query(@com.fasterxml.jackson.databind.annotation.JsonDeserialize(using=ReportParametersDeserializer::class) val parameters:ObjectNode,val offset:Int=0,val limit:Int=50)
 data class Export(val executionId:UUID,@com.fasterxml.jackson.databind.annotation.JsonDeserialize(using=ReportParametersDeserializer::class) val parameters:ObjectNode)
 data class Retry(val expectedRevision:Long)
 @GetMapping("/{id}/contract")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('report_definition_catalog:read')")
 fun contract(@PathVariable id:UUID)=service.contract(id)
 @PostMapping("/{id}/query")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('report_definition_catalog:read')")
 fun query(@PathVariable id:UUID,@RequestBody input:Query)=ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.query(id,input.parameters.toString(),actor(),input.offset,input.limit))
 @PostMapping("/{id}/exports")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('request_report_execution:execute')")
 fun export(@PathVariable id:UUID,@RequestBody input:Export):Map<String,UUID> {
  service.execute("RequestReportExecution",mapper.createObjectNode().put("executionId",input.executionId.toString()).put("reportVersionId",id.toString()).put("parametersJson",input.parameters.toString()),actor())
  return mapOf("executionId" to input.executionId)
 }
 @GetMapping("/{id}/executions")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('request_report_execution:execute')")
 fun mine(@PathVariable id:UUID,@RequestParam(defaultValue="0") offset:Int,@RequestParam(defaultValue="50") limit:Int)=ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.mine(id,actor(),offset,limit))
 @GetMapping("/executions/{id}")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('request_report_execution:execute')")
 fun status(@PathVariable id:UUID)=ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.status(id,actor()))
 @PostMapping("/executions/{id}/retry")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('retry_report_execution:execute')")
 fun retry(@PathVariable id:UUID,@RequestBody input:Retry) {service.execute("RetryReportExecution",mapper.createObjectNode().put("executionId",id.toString()).put("expectedRevision",input.expectedRevision),actor())}
 @GetMapping("/executions/{id}/file")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('request_report_execution:execute')")
 fun download(@PathVariable id:UUID)=ResponseEntity.ok().contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
  .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"$id.csv\"").header("X-Content-Type-Options","nosniff")
  .cacheControl(CacheControl.noStore()).body(FileSystemResource(worker.download(id,actor())))
 @ExceptionHandler(IllegalArgumentException::class)
 @ResponseStatus(HttpStatus.BAD_REQUEST)
 fun invalid(e:IllegalArgumentException)=mapOf("detail" to (e.message ?: "Invalid report request"))
}
