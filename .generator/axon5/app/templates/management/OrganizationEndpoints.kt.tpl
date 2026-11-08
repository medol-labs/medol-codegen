package <%= rootPackage %>.management.infrastructure
import java.util.UUID
import org.springframework.web.bind.annotation.*
import org.springframework.security.access.prepost.PreAuthorize

@RestController
@RequestMapping("/api/organization")
@PreAuthorize("hasAuthority('*:*') or hasAuthority('position_assignment_catalog:read')")
class OrganizationEndpoints(private val service:OrganizationService,private val store:ManagementStore) {
 @GetMapping("/members/{id}/assignments") fun assignments(@PathVariable id:UUID)=service.currentAssignments(id)
 @GetMapping("/units/{id}/subtree")
 @PreAuthorize("hasAuthority('*:*') or hasAuthority('organization_unit_catalog:read')")
 fun subtree(@PathVariable id:UUID)=service.subtree(id)
 @GetMapping("/history/{id}")
 @PreAuthorize("hasAuthority('*:*')")
 fun history(@PathVariable id:UUID,@RequestParam(defaultValue="0") after:Long,@RequestParam(defaultValue="100") limit:Int)=store.history("organization",id,after,limit)
 @ExceptionHandler(IllegalArgumentException::class) @ResponseStatus(org.springframework.http.HttpStatus.BAD_REQUEST)
 fun invalid(e:IllegalArgumentException)=mapOf("detail" to (e.message ?: "Invalid organization request"))
}
