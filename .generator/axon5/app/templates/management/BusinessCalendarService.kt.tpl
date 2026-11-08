package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.stereotype.Service
import java.time.*
import java.time.temporal.ChronoUnit
import java.util.UUID

@Service
class BusinessCalendarService(private val store:ManagementStore,private val mapper:ObjectMapper) {
 private val fields=listOf("calendarId","calendarCode","calendarName","timeZone","validFrom","validThrough","weeklyScheduleJson","dateOverridesJson")
 private fun text(n:JsonNode,key:String)=n.path(key).takeIf {it.isTextual && it.asText().isNotBlank()}?.asText() ?: throw IllegalArgumentException("$key is required")
 private fun objectJson(value:String):ObjectNode {
  require(value.toByteArray().size<=262144) {"Calendar rules exceed 256 KiB"}
  val node=try {
   mapper.factory.createParser(value).use {parser->
    parser.enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
    val root=mapper.readTree<JsonNode>(parser)
    require(parser.nextToken()==null) {"Calendar rules must contain exactly one JSON object"}
    root
   }
  } catch(e:Exception) {throw IllegalArgumentException("Calendar rules must be valid JSON",e)}
  require(node is ObjectNode) {"Calendar rules must be a JSON object"};return node
 }
 private fun hours(node:JsonNode):List<BusinessHours> {
  require(node.isArray && node.size()<=16) {"Each day requires zero to sixteen working intervals"}
  val result=node.map {n->
   require(n.isObject && n.fieldNames().asSequence().toSet()==setOf("start","end")) {"A working interval has exactly start and end"}
   val start=text(n,"start");val end=text(n,"end")
   require(start.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) && (end=="24:00" || end.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")))) {"Use HH:mm; only end may be 24:00"}
   require(start<end) {"Intervals must end after they start; split overnight shifts across dates"}
   BusinessHours(start,end)
  }.sortedBy {it.start}
  require(result.zipWithNext().all {(a,b)->a.end<=b.start}) {"Working intervals overlap"}
  return result
 }
 private fun decode(row:JsonNode):BusinessCalendarSnapshot {
  try {
   val from=LocalDate.parse(text(row,"validFrom"));val through=LocalDate.parse(text(row,"validThrough"))
   require(from.year in 1..9998 && through.year in 1..9998 && through>=from && ChronoUnit.DAYS.between(from,through)<3660) {"Calendar coverage must be 1 to 3660 days"}
   val zone=text(row,"timeZone");require(zone.length<=100);ZoneId.of(zone)
   val weekly=objectJson(text(row,"weeklyScheduleJson"));val overrides=objectJson(text(row,"dateOverridesJson"))
   require(weekly.fieldNames().asSequence().toSet()==DayOfWeek.entries.map {it.name}.toSet()) {"Declare all seven weekdays explicitly"}
   val week=DayOfWeek.entries.associateWith {hours(weekly[it.name])}
   val dates=overrides.fields().asSequence().associate {(key,value)->
    val date=LocalDate.parse(key);require(date.toString()==key && date>=from && date<=through) {"Date override outside coverage or not canonical ISO date"};date to hours(value)
   }
   return BusinessCalendarSnapshot(UUID.fromString(text(row,"calendarId")),row.path("revision").asLong(),zone,from,through,week,dates)
  } catch(e:DateTimeException) {throw IllegalArgumentException("Invalid calendar date or timezone: ${e.message}",e)}
 }
 fun execute(operation:String,input:JsonNode,actor:String):Unit=store.locked("calendar") {
  require(actor.isNotBlank() && actor!="anonymous" && actor.length<=160) {"Authenticated calendar identity required"}
  val id=UUID.fromString(text(input,"calendarId"));val reason=text(input,"reason");require(reason.length<=1000)
  require(operation in setOf("DefineBusinessCalendar","ReviseBusinessCalendar","ActivateBusinessCalendar","SuspendBusinessCalendar"))
  val existing=store.record("calendar",id);val create=operation=="DefineBusinessCalendar"
  if(create && existing!=null) {require(fields.all {existing[it]==input[it]}) {"Calendar ID already exists with different inputs"};return@locked}
  val row=if(create) mapper.createObjectNode() else requireNotNull(existing) {"Calendar does not exist"}.also {
   require(input.path("expectedRevision").isIntegralNumber && it.path("revision").asLong()==input.path("expectedRevision").asLong()) {"Revision conflict"}
  }
  when(operation) {
   "DefineBusinessCalendar","ReviseBusinessCalendar" -> {
    require(create || row.path("state").asText() in setOf("Draft","Suspended")) {"Suspend an Active calendar before revising"}
    if(!create) require(text(input,"calendarCode")==text(row,"calendarCode")) {"Calendar code is immutable"}
    fields.forEach {key->row.set<JsonNode>(key,input.path(key))}
    require(text(row,"calendarCode").matches(Regex("[A-Za-z0-9_.-]{1,100}")) && text(row,"calendarName").length<=160)
    require(store.rows("calendar","CalendarDefinition").none {it.path("calendarId").asText()!=id.toString() && it.path("calendarCode")==row.path("calendarCode")}) {"Calendar code already exists"}
    decode(row);row.put("state","Draft")
   }
   "ActivateBusinessCalendar" -> {
    require(row.path("state").asText() in setOf("Draft","Suspended")) {"Calendar is already Active"}
    val snapshot=decode(row);var date=snapshot.validFrom
    while(date<=snapshot.validThrough) {snapshot.day(date);date=date.plusDays(1)}
    row.put("state","Active")
   }
   "SuspendBusinessCalendar" -> {require(row.path("state").asText()=="Active") {"Only Active calendars can be suspended"};row.put("state","Suspended")}
  }
  row.put("reason",reason)
  val event=when(operation) {"DefineBusinessCalendar"->"BusinessCalendarDefined";"ReviseBusinessCalendar"->"BusinessCalendarRevised";"ActivateBusinessCalendar"->"BusinessCalendarActivated";else->"BusinessCalendarSuspended"}
  store.save("calendar","CalendarDefinition",id,row,event,actor)
 }
 /** Omitting revision means a new use and requires current Active state; explicit Active revisions replay old decisions. */
 fun snapshot(id:UUID,revision:Long?=null):BusinessCalendarSnapshot=store.locked("calendar") {
  val row=if(revision==null) requireNotNull(store.record("calendar",id)) {"Calendar does not exist"} else {
   require(revision>0);store.historical("calendar",id,revision)
  }
  require(row.path("state").asText()=="Active") {"An Active calendar revision is required"};decode(row)
 }
 fun history(id:UUID,after:Long,limit:Int)=store.history("calendar",id,after,limit)
}
