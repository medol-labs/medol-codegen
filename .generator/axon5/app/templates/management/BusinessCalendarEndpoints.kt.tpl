package <%= rootPackage %>.management.infrastructure
import java.util.UUID
import java.time.*
import org.springframework.web.bind.annotation.*
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.format.annotation.DateTimeFormat

@RestController
@RequestMapping("/api/business-calendars")
@PreAuthorize("hasAuthority('*:*') or hasAuthority('business_calendar_catalog:read')")
class BusinessCalendarEndpoints(private val calendars:BusinessCalendarService) {
 @GetMapping("/{id}/day")
 fun day(@PathVariable id:UUID,@RequestParam @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) date:LocalDate,@RequestParam(required=false) revision:Long?)=calendars.snapshot(id,revision).day(date)
 @GetMapping("/{id}/shift")
 fun shift(@PathVariable id:UUID,@RequestParam @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) date:LocalDate,@RequestParam days:Int,@RequestParam(required=false) revision:Long?)=calendars.snapshot(id,revision).shift(date,days)
 @GetMapping("/{id}/next-working-time")
 fun next(@PathVariable id:UUID,@RequestParam from:Instant,@RequestParam(required=false) revision:Long?)=calendars.snapshot(id,revision).nextWorkingTime(from)
 @GetMapping("/{id}/working-duration")
 fun duration(@PathVariable id:UUID,@RequestParam from:Instant,@RequestParam until:Instant,@RequestParam(required=false) revision:Long?)=calendars.snapshot(id,revision).workingDuration(from,until)
 @GetMapping("/{id}/add-working-time")
 fun add(@PathVariable id:UUID,@RequestParam from:Instant,@RequestParam seconds:Long,@RequestParam(required=false) revision:Long?)=calendars.snapshot(id,revision).addWorkingTime(from,seconds)
 @GetMapping("/{id}/history")
 fun history(@PathVariable id:UUID,@RequestParam(defaultValue="0") after:Long,@RequestParam(defaultValue="100") limit:Int)=calendars.history(id,after,limit)
 @ExceptionHandler(IllegalArgumentException::class,DateTimeException::class)
 @ResponseStatus(org.springframework.http.HttpStatus.BAD_REQUEST)
 fun invalid(e:Exception)=mapOf("detail" to (e.message ?: "Invalid calendar request"))
}
