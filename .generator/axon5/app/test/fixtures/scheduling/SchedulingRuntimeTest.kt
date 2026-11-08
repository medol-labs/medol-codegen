package tech.medo.scheduling.infrastructure

import java.time.*
import java.util.UUID
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import tech.medo.scheduling.defineschedule.DefineScheduleCommand
import tech.medo.scheduling.activateschedule.ActivateScheduleCommand
import tech.medo.scheduling.pauseschedule.PauseScheduleCommand
import tech.medo.scheduling.resumeschedule.ResumeScheduleCommand
import tech.medo.scheduling.reviseschedule.ReviseScheduleCommand
import tech.medo.scheduling.retireschedule.RetireScheduleCommand
import tech.medo.scheduling.acceptscheduledoccurrence.AcceptScheduledOccurrenceCommand
import tech.medo.scheduling.schedulecatalog.ScheduleCatalogReadModelRepository
import org.springframework.jdbc.core.JdbcTemplate
import com.fasterxml.jackson.databind.ObjectMapper

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@org.springframework.context.annotation.Import(SchedulingRuntimeTest.ProviderTestConfiguration::class)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:scheduling;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;LOCK_TIMEOUT=15000","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.scheduling.enabled=false","medol.scheduling.reconcile-delay-ms=3600000","medol.scheduling.delivery-delay-ms=3600000"])
class SchedulingRuntimeTest @Autowired constructor(private val gateway: CommandGateway,private val logic: SchedulingLogic,
 private val properties: SchedulingProperties,private val jdbc: JdbcTemplate,private val store: SchedulingStore,
 private val mapper: ObjectMapper,private val targets: SchedulingTargets,private val snail: SnailJobProvider,private val probe: ProbeProvider) {
 class ProbeProvider: SchedulingProvider {
  override val kind="probe"
  var fail=false
  val registrations=java.util.concurrent.ConcurrentHashMap<UUID,ScheduledDelivery>()
  val cancelled=java.util.concurrent.ConcurrentHashMap.newKeySet<UUID>()
  override fun validate(settings: SchedulingProviderSettings) {}
  override fun ensure(settings: SchedulingProviderSettings,occurrenceId: UUID,dueAt: Instant,delivery: ScheduledDelivery) {registrations[occurrenceId]=delivery;if(fail) error("Lost successful registration response")}
  override fun cancel(settings: SchedulingProviderSettings,occurrenceId: UUID) {cancelled.add(occurrenceId)}
 }
 @org.springframework.boot.test.context.TestConfiguration
 class ProviderTestConfiguration { @org.springframework.context.annotation.Bean fun probeProvider()=ProbeProvider() }
 @Test fun durableSynchronizationRecoversAndDeliveryDispatchesTypedCommand() {
  setup();properties.providers.values.forEach {it.kind="probe"};probe.fail=true
  val id=define();send(ActivateScheduleCommand(id,1));val due="2026-11-07T10:00:30Z";val occurrence=scheduleOccurrence(id,2,due)
  waitFor{jdbc.queryForObject("select count(*) from medol_schedule_sync where id=? and plan_version=2",Long::class.java,id)==1L}
  properties.enabled=true
  try {
   store.reconcile();assertEquals("Failed",store.status(id)["synchronizationState"]);assertTrue(probe.registrations.containsKey(occurrence))
   probe.fail=false;jdbc.update("update medol_schedule_sync set retry_at=? where id=?",java.sql.Timestamp.from(Instant.EPOCH),id)
   store.reconcile();assertEquals("Synchronized",store.status(id)["synchronizationState"])
   logic.clock=Clock.fixed(Instant.parse(due),ZoneOffset.UTC)
   send(AcceptScheduledOccurrenceCommand(id,2,"snail",due));waitFor{deliveries(id)==1L};store.deliver()
   assertEquals("Dispatched",jdbc.queryForObject("select delivery_state from medol_schedule_delivery where schedule_id=?",String::class.java,id))
   waitFor{store.status(id)["planVersion"]==3L};store.reconcile();assertTrue(probe.cancelled.contains(occurrence))
   val stale=mapper.readValue(jdbc.queryForObject("select snapshot_json from medol_schedule_sync where id=?",String::class.java,id),ScheduleSnapshot::class.java)
   stale.planVersion=1;stale.state="Draft";store.record(stale)
   assertEquals(3L,store.status(id)["planVersion"]);assertEquals(1,deliveries(id))
  } finally {properties.enabled=false;probe.fail=false}
 }
 private fun setup() {
  properties.enabled=false
  properties.callbackBaseUrl="http://localhost:9999"
  properties.providers=mapOf("snail" to SchedulingProviderSettings().apply {baseUrl="http://localhost:9998";namespace="test";group="workers";token="test"},"second" to SchedulingProviderSettings().apply {baseUrl="http://localhost:9997";namespace="test";group="workers";token="test"})
  logic.clock=Clock.fixed(Instant.parse("2026-11-07T10:00:00Z"),ZoneOffset.UTC)
 }
 private fun send(command: Any) = gateway.send(command).resultMessage.join()
 private fun define(id: UUID=UUID.randomUUID(),kind: String="Once",expression: String="2026-11-07T10:00:30Z",policy: String="FireOnce"): UUID {
  send(DefineScheduleCommand(id,"Report","snail","Reports.RunReport","{\"reportCode\":\"daily\"}",kind,expression,"UTC",policy));return id
 }
 private fun waitFor(test: ()->Boolean) {val end=System.nanoTime()+Duration.ofSeconds(15).toNanos();while(!test()){if(System.nanoTime()>end) fail<Unit>("Projection did not catch up");Thread.sleep(25)}}
 private fun deliveries(id: UUID)=jdbc.queryForObject("select count(*) from medol_schedule_delivery where schedule_id=?",Long::class.java,id)!!
 @Test fun lifecycleGuardsAndStableOccurrence() {
  setup();val id=define();val due="2026-11-07T10:00:30Z"
  send(AcceptScheduledOccurrenceCommand(id,1,"snail",due));assertEquals(0,deliveries(id))
  send(ActivateScheduleCommand(id,1));assertThrows(Exception::class.java){send(DefineScheduleCommand(id,"Again","snail","Reports.RunReport","{}","Once",due,"UTC","FireOnce"))}
  assertThrows(Exception::class.java){send(AcceptScheduledOccurrenceCommand(id,2,"snail",due))}
  logic.clock=Clock.fixed(Instant.parse(due),ZoneOffset.UTC)
  send(AcceptScheduledOccurrenceCommand(id,2,"second",due));assertEquals(0,deliveries(id))
  send(AcceptScheduledOccurrenceCommand(id,2,"snail",due));send(AcceptScheduledOccurrenceCommand(id,2,"snail",due))
  waitFor{deliveries(id)==1L}
  assertEquals(scheduleOccurrence(id,2,due),jdbc.queryForObject("select id from medol_schedule_delivery where schedule_id=?",UUID::class.java,id))
  assertThrows(Exception::class.java){send(PauseScheduleCommand(id,2))}
  send(PauseScheduleCommand(id,3));send(AcceptScheduledOccurrenceCommand(id,4,"snail",due));assertEquals(1,deliveries(id))
 }
 @Test fun migrationAndRetirementRejectOldCallbacks() {
  setup();val id=define();val due="2026-11-07T10:00:30Z";send(ActivateScheduleCommand(id,1));send(PauseScheduleCommand(id,2))
  send(ReviseScheduleCommand(id,3,"Report","second","Reports.RunReport","{\"reportCode\":\"daily\"}","Once",due,"UTC","FireOnce"))
  send(ActivateScheduleCommand(id,4));logic.clock=Clock.fixed(Instant.parse(due),ZoneOffset.UTC)
  send(AcceptScheduledOccurrenceCommand(id,2,"snail",due));assertEquals(0,deliveries(id))
  assertEquals(true,send(CheckScheduledOccurrence(id,5,due,"second")).payload())
  send(RetireScheduleCommand(id,5));send(AcceptScheduledOccurrenceCommand(id,5,"second",due));assertEquals(0,deliveries(id))
  assertThrows(Exception::class.java){send(ResumeScheduleCommand(id,6))}
 }
 @Test fun cronTimezoneMisfireAndValidation() {
  setup();val c=ScheduleConfiguration("n","snail","Reports.RunReport","{\"reportCode\":\"a\"}","Cron","0 0 9 * * *","Asia/Shanghai","Skip")
  assertEquals("2026-11-08T01:00:00Z",logic.next(c,Instant.parse("2026-11-07T10:00:00Z")))
  assertThrows(Exception::class.java){logic.validate(c.copy(argumentsJson="{\"runId\":\"bad\",\"reportCode\":\"a\"}"))}
  assertThrows(Exception::class.java){logic.validate(c.copy(argumentsJson="{}"))}
  assertThrows(Exception::class.java){logic.validate(c.copy(providerKey="unknown"))}
  assertThrows(Exception::class.java){logic.validate(c.copy(scheduleExpression="bad"))}
  val id=define(policy="Skip");send(ActivateScheduleCommand(id,1));logic.clock=Clock.fixed(Instant.parse("2026-11-07T11:00:00Z"),ZoneOffset.UTC)
  send(AcceptScheduledOccurrenceCommand(id,2,"snail","2026-11-07T10:00:30Z"));waitFor{deliveries(id)==1L}
  assertEquals("Skipped",jdbc.queryForObject("select delivery_state from medol_schedule_delivery where schedule_id=?",String::class.java,id))
 }
 @Test fun oldEventsWithoutConsumptionMarkerReplaySafely() {
  setup();val id=UUID.randomUUID();val due="2026-11-07T10:00:30Z"
  val s=mapper.convertValue(ScheduleConfiguration("Report","snail","Reports.RunReport","{\"reportCode\":\"daily\"}","Once",due,"UTC","FireOnce"),ScheduleSnapshot::class.java)
  s.scheduleId=id;s.planVersion=3;s.state="Active";s.occurrenceId=UUID.randomUUID();s.scheduledAt=due;s.dispatch=true
  val historical=mapper.valueToTree<com.fasterxml.jackson.databind.node.ObjectNode>(s).apply {remove("lastScheduledAt")}
  val state=tech.medo.scheduling.scheduleplan.SchedulePlanState()
  state.evolve(mapper.treeToValue(historical,tech.medo.scheduling.events.ScheduledOccurrenceAcceptedEvent::class.java))
  historical.put("state","Paused");historical.put("planVersion",4)
  state.evolve(mapper.treeToValue(historical,tech.medo.scheduling.events.SchedulePausedEvent::class.java))
  assertEquals(due,state.lastScheduledAt);assertNull(logic.decide("resume",id,4,state,null)!!.nextAt)
  historical.put("state","Draft");historical.put("planVersion",5)
  state.evolve(mapper.treeToValue(historical,tech.medo.scheduling.events.ScheduleRevisedEvent::class.java))
  assertNull(state.lastScheduledAt);assertEquals(due,logic.decide("activate",id,5,state,null)!!.nextAt)
 }
 @Test fun onceResumePreservesExhaustionAndExplicitRevisionRearms() {
  setup();val id=define();val due="2026-11-07T10:00:30Z"
  send(ActivateScheduleCommand(id,1));logic.clock=Clock.fixed(Instant.parse(due),ZoneOffset.UTC)
  send(AcceptScheduledOccurrenceCommand(id,2,"snail",due));send(PauseScheduleCommand(id,3));send(ResumeScheduleCommand(id,4))
  assertEquals(false,send(CheckScheduledOccurrence(id,5,due,"snail")).payload())
  send(AcceptScheduledOccurrenceCommand(id,5,"snail",due));waitFor{store.status(id)["planVersion"]==5L};assertEquals(1,deliveries(id))
  send(PauseScheduleCommand(id,5))
  send(ReviseScheduleCommand(id,6,"Report","snail","Reports.RunReport","{\"reportCode\":\"daily\"}","Once",due,"UTC","FireOnce"))
  send(ActivateScheduleCommand(id,7));assertEquals(true,send(CheckScheduledOccurrence(id,8,due,"snail")).payload())
  send(AcceptScheduledOccurrenceCommand(id,8,"snail",due));waitFor{deliveries(id)==2L}
  val paused=define();send(ActivateScheduleCommand(paused,1));send(PauseScheduleCommand(paused,2));send(ResumeScheduleCommand(paused,3))
  assertEquals(true,send(CheckScheduledOccurrence(paused,4,due,"snail")).payload())
 }
 @Test fun staleOperationalSnapshotIsNotReportedAsSynchronized() {
  setup();properties.providers.values.forEach {it.kind="probe"}
  val id=define();send(ActivateScheduleCommand(id,1));waitFor{store.status(id)["planVersion"]==2L}
  val stale=jdbc.queryForObject("select snapshot_json from medol_schedule_sync where id=?",String::class.java,id)!!
  send(PauseScheduleCommand(id,2));waitFor{store.status(id)["planVersion"]==3L}
  jdbc.update("update medol_schedule_sync set snapshot_json=?,plan_version=2,retry_at=? where id=?",stale,java.sql.Timestamp.from(Instant.EPOCH),id)
  properties.enabled=true
  try {store.reconcile();assertEquals("AwaitingProjection",store.status(id)["synchronizationState"])} finally {properties.enabled=false}
 }
 @Test fun longArgumentsReachTheCatalogAndConcurrentCallbacksCreateOneOccurrence() {
  setup();val id=UUID.randomUUID();val due="2026-11-07T10:00:30Z";val args=mapper.writeValueAsString(mapOf("reportCode" to "R".repeat(1200)))
  send(DefineScheduleCommand(id,"Report","snail","Reports.RunReport",args,"Once",due,"UTC","FireOnce"))
  send(ActivateScheduleCommand(id,1));logic.clock=Clock.fixed(Instant.parse(due),ZoneOffset.UTC)
  val pool=java.util.concurrent.Executors.newFixedThreadPool(8)
  try {val results=pool.invokeAll((1..16).map {java.util.concurrent.Callable {runCatching{send(AcceptScheduledOccurrenceCommand(id,2,"snail",due))}.isSuccess}});assertTrue(results.any {it.get()})} finally {pool.shutdownNow()}
  waitFor{store.status(id)["planVersion"]==3L};assertEquals(1,deliveries(id))
  waitFor{jdbc.queryForObject("select count(*) from schedule_catalog where schedule_id=? and plan_version=3",Long::class.java,id)==1L}
  assertEquals(args,jdbc.queryForObject("select arguments_json from schedule_catalog where schedule_id=?",String::class.java,id))
 }
 @Test fun recentDeliveriesAreOrderedByScheduledTimeNotRetries() {
  setup();val id=UUID.randomUUID();val base=Instant.parse("2026-11-07T00:00:00Z")
  for(i in 0..109) store.record(ScheduleSnapshot().apply {scheduleId=id;planVersion=i+1L;occurrenceId=UUID.randomUUID();scheduledAt=base.plusSeconds(i.toLong()).toString();targetKey="Reports.RunReport";dispatch=false})
  jdbc.update("update medol_schedule_delivery set retry_at=? where schedule_id=? and scheduled_at=?",java.sql.Timestamp.from(base.plusSeconds(100000)),id,java.sql.Timestamp.from(base))
  val rows=store.status(id)["deliveries"] as List<*>
  assertEquals(100,rows.size);assertEquals(base.plusSeconds(109),(rows.first() as Map<*,*>)["scheduledAt"]);assertEquals(base.plusSeconds(10),(rows.last() as Map<*,*>)["scheduledAt"])
 }
 @Test fun snailOpenApiContractAndUncertainResponseRecovery() {
  setup()
  val server=com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1",0),0)
  var existing=false;var creates=0;var disabled=false;var refreshedCallback=false
  server.createContext("/api/job/bizId/") { exchange ->
   assertEquals("test",exchange.requestHeaders.getFirst("namespace"));assertEquals("workers",exchange.requestHeaders.getFirst("group-name"));assertEquals("test",exchange.requestHeaders.getFirst("token"))
   val data=when(exchange.requestURI.path.substringAfterLast('/')) {
    "exists" -> if(existing) "{\"id\":1,\"groupName\":\"workers\",\"jobStatus\":${if(disabled) 0 else 1}}" else "null"
    "add" -> {val body=mapper.readTree(exchange.requestBody);assertEquals(5,body["triggerType"].asInt());assertEquals("snailJobHttpExecutor",body["executorInfo"].asText());assertEquals(1,mapper.readTree(body["triggerInterval"].asText()).size());existing=true;creates++;"1"}
    "updateStatus" -> {disabled=mapper.readTree(exchange.requestBody)["status"].asInt()==0;"true"}
    "trigger" -> {val body=mapper.readTree(exchange.requestBody);refreshedCallback=mapper.readTree(body["tmpArgsStr"].asText())["url"].asText()=="http://localhost:9996/api/scheduling/occurrences";"true"}
    else -> error("Unexpected path")
   }
   val bytes="{\"status\":1,\"data\":$data}".toByteArray();exchange.responseHeaders.add("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.size.toLong());exchange.responseBody.use {it.write(bytes)}
  }
  server.start()
  try {
   val config=properties.providers.getValue("snail");config.baseUrl="http://127.0.0.1:${server.address.port}"
   val id=UUID.randomUUID();val at=Instant.now().plusSeconds(60);val d=ScheduledDelivery(UUID.randomUUID(),2,"snail",at.toString())
   snail.ensure(config,id,at,d);snail.ensure(config,id,at,d);assertEquals(1,creates);snail.cancel(config,id);assertTrue(disabled)
   properties.callbackBaseUrl="http://localhost:9996";snail.ensure(config,id,Instant.now().minusSeconds(120),d);assertTrue(refreshedCallback);assertFalse(disabled)
  } finally {server.stop(0)}
 }
}
