package <%= rootPackage %>.documentgeneration.infrastructure

import java.util.UUID
import org.springframework.web.bind.annotation.*
import org.springframework.http.*
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.multipart.MultipartFile
import <%= rootPackage %>.shared.security.CurrentUser
import com.fasterxml.jackson.databind.JsonNode

@RestController
@RequestMapping("/api/documents")
class DocumentEndpoints(private val service:DocumentService) {
 private fun actor():String=(SecurityContextHolder.getContext().authentication?.principal as? CurrentUser)?.id?.toString()
  ?: throw AccessDeniedException("Authenticated document identity required")
 private fun pdf(bytes:ByteArray,name:String)=ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
  .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"$name\"").header(HttpHeaders.CACHE_CONTROL,"no-store")
  .header("X-Content-Type-Options","nosniff").body(bytes)
 @GetMapping("/{id}")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('generated_document_catalog:read')")
 fun status(@PathVariable id:UUID)=service.status(id,actor())
 @GetMapping("/{id}/file")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('generated_document_catalog:read')")
 fun download(@PathVariable id:UUID)=pdf(service.download(id,actor()),"$id.pdf")
 @GetMapping("/templates/{id}/source")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('document_template_catalog:read')")
 fun source(@PathVariable id:UUID)=ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON)
  .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"$id.json\"").header(HttpHeaders.CACHE_CONTROL,"no-store").body(service.source(id))
 @PostMapping("/templates/{id}/preview")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('document_template_catalog:read')")
 fun preview(@PathVariable id:UUID,@RequestBody sample:JsonNode)=pdf(service.preview(id,sample),"preview.pdf")
 @PostMapping("/templates/import",consumes=[MediaType.MULTIPART_FORM_DATA_VALUE])
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('create_document_template_version:execute')")
 fun importTemplate(@RequestParam templateVersionId:UUID,@RequestParam templateKey:String,@RequestParam versionLabel:String,
  @RequestParam providerKey:String,@RequestParam contractVersion:String,@RequestParam rendererKey:String,@RequestPart file:MultipartFile) {
  require(file.size in 1..262144) { "Template must be at most 256 KiB" }
  service.create(TemplateDefinition(templateVersionId,templateKey,versionLabel,providerKey,contractVersion,rendererKey,file.bytes.toString(Charsets.UTF_8)),actor())
 }
 @ExceptionHandler(IllegalArgumentException::class)
 @ResponseStatus(HttpStatus.BAD_REQUEST)
 fun invalid(e:IllegalArgumentException)=mapOf("detail" to (e.message ?: "Invalid document request"))
 @ExceptionHandler(org.springframework.dao.EmptyResultDataAccessException::class)
 @ResponseStatus(HttpStatus.NOT_FOUND)
 fun missing()=mapOf("detail" to "Document or template does not exist")
}
