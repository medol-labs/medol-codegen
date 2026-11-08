package <%= rootPackage %>.management.infrastructure
import java.util.UUID
import org.springframework.web.bind.annotation.*
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.context.SecurityContextHolder
import <%= rootPackage %>.shared.security.CurrentUser

@RestController
@RequestMapping("/api/system-configuration")
@PreAuthorize("hasAuthority('*:*') or hasAuthority('configuration_set_catalog:read')")
class ConfigurationEndpoints(private val service:SystemConfigurationService) {
 private fun actor()=(SecurityContextHolder.getContext().authentication?.principal as? CurrentUser)?.id?.toString() ?: throw AccessDeniedException("Authentication required")
 @GetMapping("/definitions") fun definitions()=service.definitions()
 @GetMapping("/effective/{group}") fun effective(@PathVariable group:String,@RequestParam(required=false) tenantId:String?)=service.resolve(group,tenantId,actor())
 @GetMapping("/history/{id}") fun history(@PathVariable id:UUID,@RequestParam(defaultValue="0") after:Long,@RequestParam(defaultValue="100") limit:Int)=service.history(id,actor(),after,limit)
 @ExceptionHandler(IllegalArgumentException::class) @ResponseStatus(org.springframework.http.HttpStatus.BAD_REQUEST)
 fun invalid(e:IllegalArgumentException)=mapOf("detail" to (e.message ?: "Invalid configuration request"))
}
