package <%= rootPackage %>.scheduling.infrastructure

import java.time.*
import java.util.UUID
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Component
import org.springframework.scheduling.support.CronExpression
import <%= rootPackage %>.scheduling.scheduleplan.SchedulePlanState
import <%= rootPackage %>.shared.domain.CommandRejectedException

@Component
class SchedulingLogic(private val properties: SchedulingProperties, private val targets: SchedulingTargets,
 private val providers: List<SchedulingProvider>, private val mapper: ObjectMapper) {
 var clock: Clock = Clock.systemUTC()
 fun reject(message: String): Nothing = throw CommandRejectedException("SCHEDULE_REJECTED", "errors.scheduling.rejected", message = message)
 fun validate(c: ScheduleConfiguration) {
  if(c.planName.isBlank() || c.planName.length>200 || c.argumentsJson.length>65536) reject("Invalid plan name or argument size.")
  if(c.providerKey.length>255 || c.targetKey.length>255 || c.scheduleExpression.length>255 || c.timeZone.length>255) reject("Schedule configuration exceeds storage limits.")
  val settings = properties.providers[c.providerKey] ?: reject("Unknown scheduling provider instance: ${c.providerKey}")
  val provider = providers.singleOrNull { it.kind == settings.kind } ?: reject("Scheduling provider kind is not installed: ${settings.kind}")
  try {
   provider.validate(settings)
   if(properties.misfireGraceSeconds<0) reject("Misfire grace must not be negative.")
   ZoneId.of(c.timeZone)
   when(c.scheduleKind) { "Once" -> Instant.parse(c.scheduleExpression); "Cron" -> CronExpression.parse(c.scheduleExpression); else -> reject("scheduleKind must be Once or Cron.") }
   if(c.misfirePolicy !in setOf("Skip", "FireOnce")) reject("misfirePolicy must be Skip or FireOnce.")
   targets.validate(ScheduledTargetCall(c.targetKey,c.argumentsJson,UUID(0,1),clock.instant().toString()))
  } catch(e: CommandRejectedException) { throw e } catch(e: Exception) { reject("Invalid schedule or typed target arguments: ${e.javaClass.simpleName}") }
 }
 fun next(c: ScheduleConfiguration, after: Instant): String? = when(c.scheduleKind) {
  "Once" -> Instant.parse(c.scheduleExpression).toString()
  "Cron" -> CronExpression.parse(c.scheduleExpression).next(after.atZone(ZoneId.of(c.timeZone)))?.toInstant()?.toString()
  else -> reject("Unknown schedule kind.")
 }
 fun decide(action: String, id: UUID, expected: Long?, state: SchedulePlanState, config: ScheduleConfiguration?, providerKey: String? = null, scheduledAt: String? = null): ScheduleSnapshot? {
  val now=clock.instant()
  if(action=="accept") {
   // Obsolete deliveries are acknowledged without events, even when the projection lags.
   if(state.state!="Active" || state.planVersion!=expected || state.providerKey!=providerKey || state.nextAt!=scheduledAt) return null
   if(Instant.parse(scheduledAt).isAfter(now)) reject("Occurrence is not due yet.")
  } else if(action=="define") {
   if(state.planVersion!=null) reject("Schedule already exists.")
  } else {
   if(state.planVersion!=expected) reject("Schedule version changed; reload before editing.")
   val allowed=when(action) {"revise" -> setOf("Draft","Paused"); "activate" -> setOf("Draft"); "pause" -> setOf("Active"); "resume" -> setOf("Paused"); "retire" -> setOf("Draft","Paused","Active"); else -> emptySet()}
   if(state.state !in allowed) reject("$action is not allowed from ${state.state}.")
  }
  val c = config ?: ScheduleConfiguration(requireNotNull(state.planName),requireNotNull(state.providerKey),requireNotNull(state.targetKey),requireNotNull(state.argumentsJson),requireNotNull(state.scheduleKind),requireNotNull(state.scheduleExpression),requireNotNull(state.timeZone),requireNotNull(state.misfirePolicy))
  if(action in setOf("define","revise","activate","resume")) validate(c)
  val s=mapper.convertValue(c,ScheduleSnapshot::class.java)
  s.scheduleId=id; s.planVersion=Math.addExact(state.planVersion?:0,1)
  s.state=when(action) {"define","revise" -> "Draft"; "pause" -> "Paused"; "retire" -> "Retired"; else -> "Active"}
  s.lastScheduledAt=if(action in setOf("define","revise")) null else state.lastScheduledAt
  // Resume must preserve exhaustion; only an explicit revision starts a new Once plan.
  s.nextAt=if(action in setOf("activate","resume") && !(c.scheduleKind=="Once" && s.lastScheduledAt!=null)) next(c,now) else null
  if(action=="accept") {
   val due=Instant.parse(scheduledAt)
   s.occurrenceId=scheduleOccurrence(id,requireNotNull(expected),requireNotNull(scheduledAt)); s.scheduledAt=scheduledAt
   s.lastScheduledAt=scheduledAt
   s.dispatch=c.misfirePolicy=="FireOnce" || !due.plusSeconds(properties.misfireGraceSeconds).isBefore(now)
   // FireOnce coalesces missed ticks; Skip records the skipped occurrence. Neither replays a backlog.
   s.nextAt=if(c.scheduleKind=="Cron") next(c,now) else null
  }
  return s
 }
}
