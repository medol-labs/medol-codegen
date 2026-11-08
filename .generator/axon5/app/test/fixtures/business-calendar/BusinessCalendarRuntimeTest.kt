package tech.medo.management.infrastructure

import java.util.UUID
import java.time.Instant
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.axonframework.messaging.commandhandling.GenericCommandMessage
import org.axonframework.messaging.core.MessageType
import tech.medo.businesscalendar.definebusinesscalendar.DefineBusinessCalendarCommand
import tech.medo.businesscalendar.activatebusinesscalendar.ActivateBusinessCalendarCommand
import java.time.LocalDate
import java.time.Duration

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:management;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;INIT=CREATE DOMAIN IF NOT EXISTS BLOB AS BYTEA","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=test","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.management.outbox-delay-ms=3600000"])
class BusinessCalendarRuntimeTest @Autowired constructor(private val calendars:BusinessCalendarService,private val store:ManagementStore,
 private val mapper:ObjectMapper,private val jdbc:JdbcTemplate,private val gateway:CommandGateway,private val publisher:ManagementOutboxPublisher) {
 companion object {
  @JvmStatic @org.springframework.test.context.DynamicPropertySource fun database(r:org.springframework.test.context.DynamicPropertyRegistry) {
   System.getenv("MANAGEMENT_TEST_PRIMARY_URL")?.let {url->r.add("spring.datasource.url"){url};r.add("spring.datasource.driver-class-name"){"org.postgresql.Driver"};r.add("spring.datasource.username"){"postgres"}}
  }
 }
 private val weekly="""{"MONDAY":[{"start":"09:00","end":"12:00"},{"start":"13:00","end":"17:00"}],"TUESDAY":[{"start":"09:00","end":"17:00"}],"WEDNESDAY":[{"start":"09:00","end":"17:00"}],"THURSDAY":[{"start":"09:00","end":"17:00"}],"FRIDAY":[{"start":"09:00","end":"17:00"}],"SATURDAY":[],"SUNDAY":[]}"""
 private fun setup() {
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_management_records'",Int::class.java)==0)
   javaClass.getResource("/db/migration/V2026110804__management.sql")!!.readText().split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
  javaClass.getResource("/db/migration/V2026110805__business_calendar.sql")!!.readText().split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
 }
 private fun input(vararg fields:Pair<String,Any?>):ObjectNode=mapper.valueToTree(mapOf("reason" to "Calendar maintenance")+fields)
 private fun definition(id:UUID,week:String=weekly,overrides:String="{}",zone:String="Asia/Shanghai",from:String="2026-01-01",through:String="2026-12-31")=input("calendarId" to id,"calendarCode" to id.toString(),"calendarName" to "Business","timeZone" to zone,"validFrom" to from,"validThrough" to through,"weeklyScheduleJson" to week,"dateOverridesJson" to overrides)
 private fun draft(overrides:String="{}",week:String=weekly,zone:String="Asia/Shanghai",from:String="2026-01-01",through:String="2026-12-31"):UUID=UUID.randomUUID().also {calendars.execute("DefineBusinessCalendar",definition(it,week,overrides,zone,from,through),"operator")}
 private fun change(operation:String,id:UUID,revision:Long)=calendars.execute(operation,input("calendarId" to id,"expectedRevision" to revision),"operator")
 private fun active(overrides:String="{}"):UUID=draft(overrides).also {change("ActivateBusinessCalendar",it,1)}
 @Test fun lifecyclePinsPublishedHistoryAndRejectsStaleChanges() {
  setup();val id=draft();assertThrows(IllegalArgumentException::class.java){calendars.snapshot(id)}
  change("ActivateBusinessCalendar",id,1);val original=calendars.snapshot(id)
  assertThrows(IllegalArgumentException::class.java){calendars.execute("ReviseBusinessCalendar",definition(id).put("expectedRevision",2),"operator")}
  change("SuspendBusinessCalendar",id,2)
  assertThrows(IllegalArgumentException::class.java){calendars.snapshot(id)}
  assertEquals(2L,calendars.snapshot(id,2).revision)
  assertThrows(IllegalArgumentException::class.java){calendars.snapshot(id,1)}
  assertThrows(IllegalArgumentException::class.java){change("ActivateBusinessCalendar",id,2)}
  calendars.execute("ReviseBusinessCalendar",definition(id,overrides="""{"2026-01-05":[]}""").put("expectedRevision",3),"operator")
  change("ActivateBusinessCalendar",id,4)
  assertFalse(calendars.snapshot(id).day(LocalDate.parse("2026-01-05")).working)
  assertTrue(original.day(LocalDate.parse("2026-01-05")).working)
  assertTrue(calendars.snapshot(id,2).day(LocalDate.parse("2026-01-05")).working)
  assertEquals(5,calendars.history(id,0,100).size)
 }
 @Test fun holidayAndMakeupDayReplaceWeeklyRules() {
  setup();val id=active("""{"2026-01-05":[],"2026-01-10":[{"start":"10:00","end":"16:00"}]}""");val c=calendars.snapshot(id)
  assertFalse(c.day(LocalDate.parse("2026-01-05")).working)
  assertEquals("DATE_OVERRIDE",c.day(LocalDate.parse("2026-01-10")).source)
  assertEquals(LocalDate.parse("2026-01-06"),c.shift(LocalDate.parse("2026-01-02"),1).date)
  assertEquals(LocalDate.parse("2026-01-10"),c.shift(LocalDate.parse("2026-01-09"),1).date)
  assertEquals(LocalDate.parse("2026-01-09"),c.shift(LocalDate.parse("2026-01-10"),-1).date)
  assertEquals(LocalDate.parse("2026-01-04"),c.shift(LocalDate.parse("2026-01-04"),0).date)
 }
 @Test fun workingTimeSkipsLunchWeekendsAndHonorsHalfOpenBoundaries() {
  setup();val c=calendars.snapshot(active())
  val beforeLunch=Instant.parse("2026-01-05T03:00:00Z")
  assertEquals(Instant.parse("2026-01-05T06:00:00Z"),c.addWorkingTime(beforeLunch,7200).instant)
  assertEquals(Instant.parse("2026-01-05T04:00:00Z"),c.addWorkingTime(beforeLunch,3600).instant)
  assertEquals(Instant.parse("2026-01-05T05:00:00Z"),c.nextWorkingTime(Instant.parse("2026-01-05T04:00:00Z")).instant)
  assertEquals(7*3600L,c.workingDuration(Instant.parse("2026-01-05T01:00:00Z"),Instant.parse("2026-01-05T09:00:00Z")).seconds)
  assertEquals(Instant.parse("2026-01-12T02:00:00Z"),c.addWorkingTime(Instant.parse("2026-01-09T08:00:00Z"),7200).instant)
  assertEquals(Instant.parse("2026-01-06T01:00:00Z"),c.nextWorkingTime(Instant.parse("2026-01-05T09:00:00Z")).instant)
 }
 @Test fun coverageAndClosedCalendarsNeverGuessAFutureDate() {
  setup();val week=mapper.readTree(weekly) as ObjectNode;week.fieldNames().asSequence().toList().forEach {week.putArray(it)}
  val id=draft(week=week.toString(),from="2026-12-30",through="2027-01-02");change("ActivateBusinessCalendar",id,1);val c=calendars.snapshot(id)
  assertThrows(IllegalArgumentException::class.java){c.nextWorkingTime(Instant.parse("2026-12-30T00:00:00Z"))}
  assertThrows(IllegalArgumentException::class.java){c.shift(LocalDate.parse("2026-12-30"),1)}
  assertThrows(IllegalArgumentException::class.java){c.day(LocalDate.parse("2027-01-03"))}
  assertThrows(IllegalArgumentException::class.java){c.shift(LocalDate.parse("2026-12-30"),Int.MIN_VALUE)}
  assertThrows(IllegalArgumentException::class.java){c.addWorkingTime(Instant.parse("2026-12-30T00:00:00Z"),-1)}
  val open=draft(from="2026-12-30",through="2027-01-02");change("ActivateBusinessCalendar",open,1)
  assertEquals(LocalDate.parse("2027-01-01"),calendars.snapshot(open).shift(LocalDate.parse("2026-12-31"),1).date)
 }
 @Test fun malformedOverlappingAndOvernightRulesAreRejected() {
  setup()
  for(week in listOf("{}",weekly+" {}",weekly+" trailing",weekly.dropLast(1)+",\"MONDAY\":[]}",weekly.replace("12:00","13:30"),weekly.replace("09:00","18:00"),weekly.replace("09:00","9:00")))
   assertThrows(IllegalArgumentException::class.java){draft(week=week)}
  assertThrows(IllegalArgumentException::class.java){draft(overrides="""{"2027-01-01":[]}""")}
  for(overrides in listOf("{} {}","{} garbage"))
   assertThrows(IllegalArgumentException::class.java){draft(overrides=overrides)}
  assertThrows(IllegalArgumentException::class.java){draft(zone="invalid/zone")}
  assertThrows(IllegalArgumentException::class.java){draft(through="2040-01-01")}
 }
 @Test fun dstAmbiguityIsRejectedButElapsedTimeAcrossTransitionIsCorrect() {
  setup();val week=mapper.readTree(weekly) as ObjectNode
  week.set<JsonNode>("SUNDAY",mapper.readTree("""[{"start":"02:30","end":"04:00"}]"""))
  val id=draft(week=week.toString(),zone="Europe/Berlin",from="2026-03-29",through="2026-03-29")
  assertThrows(IllegalArgumentException::class.java){change("ActivateBusinessCalendar",id,1)}
  calendars.execute("ReviseBusinessCalendar",definition(id,week.toString(),"""{"2026-03-29":[{"start":"00:00","end":"04:00"}]}""","Europe/Berlin","2026-03-29","2026-03-29").put("expectedRevision",1),"operator")
  change("ActivateBusinessCalendar",id,2)
  val c=calendars.snapshot(id);val w=c.day(LocalDate.parse("2026-03-29")).windows.single()
  assertEquals(3*3600L,c.workingDuration(w.from,w.until).seconds)
  val autumn=draft(week=week.toString(),zone="Europe/Berlin",from="2026-10-25",through="2026-10-25")
  assertThrows(IllegalArgumentException::class.java){change("ActivateBusinessCalendar",autumn,1)}
 }
 @Test fun leapDayMidnightAndFractionalSecondsPreserveHalfOpenIntervals() {
  setup();val week=java.time.DayOfWeek.entries.associate {it.name to listOf(mapOf("start" to "00:00","end" to "24:00"))}
  val id=draft(week=mapper.writeValueAsString(week),zone="UTC",from="2028-02-28",through="2028-03-01")
  change("ActivateBusinessCalendar",id,1);val c=calendars.snapshot(id)
  assertEquals(LocalDate.parse("2028-02-29"),c.shift(LocalDate.parse("2028-02-28"),1).date)
  val from=Instant.parse("2028-02-29T23:59:59.500000000Z")
  val until=Instant.parse("2028-03-01T00:00:00.500000000Z")
  assertEquals(until,c.addWorkingTime(from,1).instant)
  val half=c.workingDuration(from,Instant.parse("2028-03-01T00:00:00Z"))
  assertEquals(0L,half.seconds);assertEquals(500000000,half.nanos)
  val end=Instant.parse("2028-03-02T00:00:00Z")
  assertEquals(end,c.addWorkingTime(Instant.parse("2028-03-01T23:59:59Z"),1).instant)
  assertEquals(86400L,c.workingDuration(Instant.parse("2028-03-01T00:00:00Z"),end).seconds)
  assertThrows(IllegalArgumentException::class.java){c.nextWorkingTime(end)}
  assertThrows(IllegalArgumentException::class.java){c.workingDuration(from,end.plusNanos(1))}
 }
 @Test fun autumnClockRollbackCountsElapsedHoursAndWorkOffsetsConsistently() {
  setup();val id=draft(overrides="""{"2026-10-25":[{"start":"00:00","end":"04:00"}]}""",
   zone="Europe/Berlin",from="2026-10-25",through="2026-10-25")
  change("ActivateBusinessCalendar",id,1);val c=calendars.snapshot(id)
  val window=c.day(LocalDate.parse("2026-10-25")).windows.single()
  assertEquals(5*3600L,c.workingDuration(window.from,window.until).seconds)
  assertEquals(window.until,c.addWorkingTime(window.from,5*3600L).instant)
  assertEquals(window.from.plusSeconds(3*3600L),c.nextWorkingTime(window.from.plusSeconds(3*3600L)).instant)
 }
 @Test fun commandEventsReachCatalogAndAudit() {
  setup();val id=UUID.randomUUID();val command=DefineBusinessCalendarCommand(id,id.toString(),"Calendar","Asia/Shanghai",LocalDate.parse("2026-01-01"),LocalDate.parse("2026-12-31"),weekly,"{}","Initial setup")
  fun send(c:Any)=gateway.send(GenericCommandMessage(MessageType(c.javaClass),c,mapOf("userId" to "operator"))).resultMessage.join()
  send(command);send(ActivateBusinessCalendarCommand(id,1,"Enable"))
  val end=System.nanoTime()+20_000_000_000
  while(true) {
   publisher.publishPending()
   val catalog=jdbc.queryForObject("select count(*) from business_calendar_catalog where calendar_id=? and state='Active' and revision=2",Int::class.java,id)==1
   val audit=jdbc.queryForObject("select count(*) from operation_audit_catalog where category='EVENT' and operation like '%BusinessCalendarActivated%'",Int::class.java)!!>0
   if(catalog && audit) break
   if(System.nanoTime()>end) fail<Unit>("Calendar catalog/audit timeout");Thread.sleep(25)
  }
 }
}
