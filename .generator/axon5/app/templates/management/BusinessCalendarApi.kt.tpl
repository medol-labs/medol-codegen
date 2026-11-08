// Generated MEDOL business-calendar API. No locale or national holiday assumptions.
package <%= rootPackage %>.management.infrastructure

import java.time.*
import java.time.zone.ZoneRulesProvider
import java.util.UUID

data class BusinessHours(val start:String,val end:String)
data class BusinessTimeWindow(val from:Instant,val until:Instant)
data class BusinessDayResult(val calendarId:UUID,val revision:Long,val timeZone:String,val zoneRulesVersion:String,
 val date:LocalDate,val working:Boolean,val source:String,val windows:List<BusinessTimeWindow>)
data class BusinessDateResult(val calendarId:UUID,val revision:Long,val timeZone:String,val zoneRulesVersion:String,val date:LocalDate)
data class BusinessInstantResult(val calendarId:UUID,val revision:Long,val timeZone:String,val zoneRulesVersion:String,val instant:Instant)
data class BusinessDurationResult(val calendarId:UUID,val revision:Long,val timeZone:String,val zoneRulesVersion:String,val seconds:Long,val nanos:Int)

/** Constructed from one immutable stored revision. Intervals are half-open; date overrides replace the entire day. */
class BusinessCalendarSnapshot(val calendarId:UUID,val revision:Long,val timeZone:String,
 val validFrom:LocalDate,val validThrough:LocalDate,
 private val weekly:Map<DayOfWeek,List<BusinessHours>>,private val overrides:Map<LocalDate,List<BusinessHours>>) {
 private val zone=ZoneId.of(timeZone)
 val zoneRulesVersion:String=if(zone.rules.isFixedOffset) "fixed:${zone.rules.getOffset(Instant.EPOCH)}" else ZoneRulesProvider.getVersions(zone.id).lastKey()
 private fun checked(date:LocalDate):LocalDate {require(date>=validFrom && date<=validThrough) {"Date outside maintained calendar coverage"};return date}
 private fun endpoint(date:LocalDate,time:String):Instant {
  val local=if(time=="24:00") date.plusDays(1).atStartOfDay() else date.atTime(LocalTime.parse(time))
  val offsets=zone.rules.getValidOffsets(local)
  require(offsets.size==1) {"Ambiguous or nonexistent local time $local in $timeZone; define an explicit date override"}
  return local.toInstant(offsets.single())
 }
 fun day(date:LocalDate):BusinessDayResult {
  checked(date);val hours=overrides[date] ?: weekly.getValue(date.dayOfWeek)
  val windows=hours.map {BusinessTimeWindow(endpoint(date,it.start),endpoint(date,it.end)).also {w->require(w.from<w.until) {"Working interval has no positive elapsed duration"}}}
  return BusinessDayResult(calendarId,revision,timeZone,zoneRulesVersion,date,windows.isNotEmpty(),if(overrides.containsKey(date)) "DATE_OVERRIDE" else "WEEKLY",windows)
 }
 /** Offset excludes the starting date. Zero preserves it, even on a holiday. */
 fun shift(date:LocalDate,days:Int):BusinessDateResult {
  var cursor=checked(date);require(days in -3660..3660)
  var remaining=kotlin.math.abs(days);val direction=if(days<0) -1L else 1L
  while(remaining>0) {cursor=checked(cursor.plusDays(direction));if(day(cursor).working) remaining--}
  return BusinessDateResult(calendarId,revision,timeZone,zoneRulesVersion,cursor)
 }
 fun nextWorkingTime(from:Instant):BusinessInstantResult {
  var date=checked(from.atZone(zone).toLocalDate())
  while(true) {
   for(window in day(date).windows) if(from<window.until) return instantResult(maxOf(from,window.from))
   date=checked(date.plusDays(1))
  }
 }
 fun workingDuration(from:Instant,until:Instant):BusinessDurationResult {
  require(from<=until) {"End precedes start"}
  var date=checked(from.atZone(zone).toLocalDate())
  require(until<=validThrough.plusDays(1).atStartOfDay(zone).toInstant()) {"End outside maintained calendar coverage"}
  var duration=Duration.ZERO
  while(date<=validThrough && date.atStartOfDay(zone).toInstant()<until) {
   for(window in day(date).windows) {
    val start=maxOf(from,window.from);val end=minOf(until,window.until)
    if(start<end) duration=duration.plus(Duration.between(start,end))
   }
   date=date.plusDays(1)
  }
  return BusinessDurationResult(calendarId,revision,timeZone,zoneRulesVersion,duration.seconds,duration.nano)
 }
 fun addWorkingTime(from:Instant,seconds:Long):BusinessInstantResult {
  require(seconds in 0..316224000L) {"Working offset must be between zero and 3660 days"}
  var date=checked(from.atZone(zone).toLocalDate());var remaining=Duration.ofSeconds(seconds)
  if(remaining.isZero) return instantResult(from)
  while(true) {
   for(window in day(date).windows) {
    val start=maxOf(from,window.from)
    if(start>=window.until) continue
    val available=Duration.between(start,window.until)
    if(remaining<=available) return instantResult(start.plus(remaining))
    remaining=remaining.minus(available)
   }
   date=checked(date.plusDays(1))
  }
 }
 private fun instantResult(value:Instant)=BusinessInstantResult(calendarId,revision,timeZone,zoneRulesVersion,value)
}
