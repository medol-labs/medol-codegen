package <%= rootPackage %>.scheduling.infrastructure

import java.util.UUID
import org.axonframework.messaging.commandhandling.annotation.Command
import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.modelling.annotation.InjectEntity
import org.axonframework.modelling.annotation.TargetEntityId
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.*
import <%= rootPackage %>.shared.security.MedolSecurityProperties
import <%= rootPackage %>.scheduling.scheduleplan.SchedulePlanState
import <%= rootPackage %>.scheduling.acceptscheduledoccurrence.AcceptScheduledOccurrenceCommand

@Command
data class CheckScheduledOccurrence(@get:TargetEntityId val scheduleId: UUID, val expectedVersion: Long, val scheduledAt: String?, val providerKey: String, val expectedState: String = "Active")
@Component
class SchedulingGate {
 @CommandHandler
 fun check(command: CheckScheduledOccurrence, @InjectEntity(idProperty="scheduleId") state: SchedulePlanState): Boolean =
  state.state==command.expectedState && state.planVersion==command.expectedVersion && state.nextAt==command.scheduledAt && state.providerKey==command.providerKey
}
@RestController
@RequestMapping("/api/scheduling")
class SchedulingEndpoints(private val gateway: CommandGateway, private val security: MedolSecurityProperties,
 private val store: SchedulingStore) {
 private fun authorize(token: String?) {
  if(security.internalToken.isBlank() || token==null || !java.security.MessageDigest.isEqual(token.toByteArray(),security.internalToken.toByteArray()))
   throw org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED)
 }
 @PostMapping("/occurrences")
 fun accept(@RequestHeader("X-MEDOL-INTERNAL-TOKEN",required=false) token: String?, @RequestBody delivery: ScheduledDelivery) {
  authorize(token)
  gateway.send(AcceptScheduledOccurrenceCommand(delivery.scheduleId,delivery.expectedVersion,delivery.providerKey,delivery.scheduledAt)).resultMessage.join()
 }
 @GetMapping("/status/{scheduleId}")
 @org.springframework.security.access.prepost.PreAuthorize("hasAuthority('*:*') or hasAuthority('schedule_catalog:read')")
 fun status(@PathVariable scheduleId: UUID) = store.status(scheduleId)
}
