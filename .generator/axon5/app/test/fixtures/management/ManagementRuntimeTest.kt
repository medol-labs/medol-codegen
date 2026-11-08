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
import tech.medo.organizationmanagement.createorganizationunit.CreateOrganizationUnitCommand

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@org.springframework.context.annotation.Import(ManagementRuntimeTest.Config::class)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:management;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;INIT=CREATE DOMAIN IF NOT EXISTS BLOB AS BYTEA","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=test","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.management.outbox-delay-ms=3600000"])
class ManagementRuntimeTest @Autowired constructor(private val organizations:OrganizationService,private val settings:SystemConfigurationService,
 private val store:ManagementStore,private val mapper:ObjectMapper,private val jdbc:JdbcTemplate,private val gateway:CommandGateway,private val publisher:ManagementOutboxPublisher) {
 companion object {
  @JvmStatic @org.springframework.test.context.DynamicPropertySource fun database(r:org.springframework.test.context.DynamicPropertyRegistry) {
   System.getenv("MANAGEMENT_TEST_PRIMARY_URL")?.let {url->r.add("spring.datasource.url"){url};r.add("spring.datasource.driver-class-name"){"org.postgresql.Driver"};r.add("spring.datasource.username"){"postgres"}}
  }
 }
 class Definitions(private val mapper:ObjectMapper):ConfigurationDefinitionProvider {
  override val groupKey="exports";override val version="v1"
  override val definitions=listOf(ConfigurationDefinition("enabled","boolean",mapper.valueToTree(false)),ConfigurationDefinition("limit","integer",mapper.valueToTree(100),tenantOverride=true,minimum=java.math.BigDecimal.ONE,maximum=java.math.BigDecimal(10000)),ConfigurationDefinition("batch","integer",mapper.valueToTree(10)))
  override fun validate(values:Map<String,JsonNode>) {require(values.getValue("batch").asInt()<=values.getValue("limit").asInt()) {"Batch must not exceed limit"}}
 }
 @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
 class Config { @org.springframework.context.annotation.Bean fun definitions(mapper:ObjectMapper)=Definitions(mapper) }
 private fun setup() {
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_management_records'",Int::class.java)==0)
   javaClass.getResource("/db/migration/V2026110804__management.sql")!!.readText().split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
 }
 private fun input(vararg fields:Pair<String,Any?>):ObjectNode=mapper.valueToTree(mapOf("reason" to "Test")+fields)
 private fun execute(operation:String,vararg fields:Pair<String,Any?>)=organizations.execute(operation,input(*fields),"operator")
 private fun unit(parent:UUID?=null):UUID=UUID.randomUUID().also {execute("CreateOrganizationUnit","organizationId" to it,"organizationCode" to it.toString(),"organizationName" to "Warehouse","organizationType" to "Department","parentOrganizationId" to parent)}
 private fun position():UUID=UUID.randomUUID().also {execute("DefinePosition","positionId" to it,"positionCode" to it.toString(),"positionName" to "Manager")}
 private fun organizationPosition(org:UUID=unit(),position:UUID=position()):UUID=UUID.randomUUID().also {execute("EstablishOrganizationPosition","organizationPositionId" to it,"organizationId" to org,"positionId" to position)}
 private fun member():UUID=UUID.randomUUID().also {execute("RegisterOrganizationMember","memberId" to it,"memberCode" to it.toString(),"memberName" to "Member","userAccountId" to null)}
 private fun assignment(member:UUID,position:UUID,start:Instant=Instant.now().minusSeconds(60),end:Instant?=null,primary:Boolean=true):UUID=UUID.randomUUID().also {execute("ConfirmPositionAssignment","assignmentId" to it,"memberId" to member,"organizationPositionId" to position,"validFrom" to start,"validUntil" to end,"primaryAssignment" to primary)}
 @Test fun organizationCyclesDependenciesAndStaleUpdatesAreRejected() {
  setup();val parent=unit();val child=unit(parent)
  assertThrows(IllegalArgumentException::class.java){execute("ReviseOrganizationUnit","organizationId" to parent,"expectedRevision" to 1,"organizationCode" to parent.toString(),"organizationName" to "Root","organizationType" to "Company","parentOrganizationId" to child)}
  assertThrows(IllegalArgumentException::class.java){execute("DeactivateOrganizationUnit","organizationId" to parent,"expectedRevision" to 1)}
  execute("DeactivateOrganizationUnit","organizationId" to child,"expectedRevision" to 1)
  assertThrows(IllegalArgumentException::class.java){organizationPosition(child)}
  assertThrows(IllegalArgumentException::class.java){execute("ActivateOrganizationUnit","organizationId" to child,"expectedRevision" to 1)}
  execute("ActivateOrganizationUnit","organizationId" to child,"expectedRevision" to 2)
  assertEquals(setOf(parent,child),organizations.subtree(parent).toSet())
  val otherKind=organizationPosition(parent)
  assertThrows(IllegalArgumentException::class.java){execute("DeactivateOrganizationUnit","organizationId" to otherKind,"expectedRevision" to 1)}
 }
 @Test fun assignmentsRespectIntervalsPrimaryAndDeactivation() {
  setup();val m=member();val pos=organizationPosition();val start=Instant.now().plusSeconds(3600);val end=start.plusSeconds(3600)
  val a=assignment(m,pos,start,end)
  assertTrue(organizations.currentAssignments(m).isEmpty())
  assertThrows(IllegalArgumentException::class.java){assignment(m,organizationPosition(),start,end)}
  assertThrows(IllegalArgumentException::class.java){assignment(m,pos,start,end,false)}
  assertThrows(IllegalArgumentException::class.java){execute("DeactivateOrganizationMember","memberId" to m,"expectedRevision" to 1)}
  assignment(m,pos,end,end.plusSeconds(3600))
  execute("CancelPositionAssignment","assignmentId" to a,"expectedRevision" to 1)
  assertEquals(1,organizations.currentAssignments(m,end).size)
 }
 @Test fun transferIsAtomicAndKeepsOldHistory() {
  setup();val m=member();val pos=organizationPosition();val a=assignment(m,pos);val next=UUID.randomUUID();val whenAt=Instant.now().plusSeconds(60)
  assertThrows(IllegalArgumentException::class.java){execute("TransferPositionAssignment","assignmentId" to a,"expectedRevision" to 1,"newAssignmentId" to next,"organizationPositionId" to UUID.randomUUID(),"effectiveAt" to whenAt,"primaryAssignment" to true)}
  assertEquals(1,store.record("organization",a)!!.path("revision").asInt())
  execute("TransferPositionAssignment","assignmentId" to a,"expectedRevision" to 1,"newAssignmentId" to next,"organizationPositionId" to organizationPosition(),"effectiveAt" to whenAt,"primaryAssignment" to true)
  assertEquals(a.toString(),organizations.currentAssignments(m).single().path("assignmentId").asText())
  assertEquals(next.toString(),organizations.currentAssignments(m,whenAt).single().path("assignmentId").asText())
  assertEquals("Confirmed",store.historical("organization",a,1).path("state").asText())
 }
 @Test fun concurrentPrimaryAppointmentsHaveOneWinner() {
  setup();val m=member();val p1=organizationPosition();val p2=organizationPosition();val start=Instant.now();val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
  try {val tasks=listOf(p1,p2).map {p->pool.submit<Boolean> {runCatching {assignment(m,p,start)}.isSuccess}};assertEquals(1,tasks.count {it.get()})} finally {pool.shutdownNow()}
 }
 @Test fun configurationAtomicPatchInheritanceRollbackAndValidation() {
  setup();val id=UUID.randomUUID()
  settings.execute("CreateConfigurationSet",input("configurationSetId" to id,"groupKey" to "exports","scopeType" to "APPLICATION","scopeId" to "application","valuesJson" to "{}"),"operator")
  val initial=settings.resolve("exports",null,"operator");assertFalse(initial.boolean("enabled"));assertEquals(100L,initial.integer("limit"))
  assertThrows(IllegalArgumentException::class.java){settings.execute("ChangeConfigurationSet",input("configurationSetId" to id,"expectedRevision" to 1,"changesJson" to """{"limit":5}"""),"operator")}
  settings.execute("ChangeConfigurationSet",input("configurationSetId" to id,"expectedRevision" to 1,"changesJson" to """{"limit":5,"batch":2,"enabled":true}"""),"operator")
  assertEquals(5,settings.resolve("exports",null,"operator").integer("limit"));assertFalse(initial.boolean("enabled"))
  assertThrows(IllegalArgumentException::class.java){settings.execute("ChangeConfigurationSet",input("configurationSetId" to id,"expectedRevision" to 1,"changesJson" to "{}"),"operator")}
  assertThrows(IllegalArgumentException::class.java){settings.execute("ChangeConfigurationSet",input("configurationSetId" to id,"expectedRevision" to 2,"changesJson" to """{"invented":true}"""),"operator")}
  settings.execute("ChangeConfigurationSet",input("configurationSetId" to id,"expectedRevision" to 2,"changesJson" to """{"limit":null}"""),"operator")
  assertEquals("DEFAULT",settings.resolve("exports",null,"operator").sources["limit"])
  settings.execute("RollbackConfigurationSet",input("configurationSetId" to id,"expectedRevision" to 3,"targetRevision" to 1),"operator")
  assertEquals(4,settings.resolve("exports",null,"operator").applicationRevision)
  val history=settings.history(id,"operator",0,100)
  assertEquals(4,history.size)
  val changed=history[1]["snapshot"] as JsonNode
  assertEquals("Test",changed.path("reason").asText())
  assertEquals(5,mapper.readTree(changed.path("valuesJson").asText()).path("limit").asInt())
  assertThrows(IllegalArgumentException::class.java){settings.resolve("exports","unauthorized-tenant","operator")}
 }
 @Test fun commandPublishesCatalogAndAuditEvents() {
  setup();val id=UUID.randomUUID();val command=CreateOrganizationUnitCommand(id,id.toString(),"Warehouse","Department",null,"Test")
  gateway.send(GenericCommandMessage(MessageType(command.javaClass),command,mapOf("userId" to "operator"))).resultMessage.join()
  repeat(10){publisher.publishPending()}
  val end=System.nanoTime()+20_000_000_000
  while(jdbc.queryForObject("select count(*) from organization_unit_catalog where organization_id=?",Int::class.java,id)!=1) {if(System.nanoTime()>end) fail<Unit>("Projection timeout");Thread.sleep(25)}
  while(jdbc.queryForObject("select count(*) from operation_audit_catalog where category='EVENT' and operation like '%OrganizationUnitCreated%'",Int::class.java)==0) {if(System.nanoTime()>end) fail<Unit>("Audit timeout");Thread.sleep(25)}
 }
 @Test fun concurrentOrganizationMovesCannotCreateCycle() {
  setup();val a=unit();val b=unit();val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
  try {
   val tasks=listOf(a to b,b to a).map {(id,parent)->pool.submit<Boolean> {runCatching {execute("ReviseOrganizationUnit","organizationId" to id,"expectedRevision" to 1,"organizationCode" to id.toString(),"organizationName" to "Unit","organizationType" to "Department","parentOrganizationId" to parent)}.isSuccess}}
   assertEquals(1,tasks.count {it.get()})
  } finally {pool.shutdownNow()}
 }
 @Test fun deactivationAndNewAssignmentCannotBothSucceed() {
  setup();val m=member();val pos=organizationPosition();val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
  try {
   val assign=pool.submit<Boolean> {runCatching {assignment(m,pos)}.isSuccess}
   val deactivate=pool.submit<Boolean> {runCatching {execute("DeactivateOrganizationPosition","organizationPositionId" to pos,"expectedRevision" to 1)}.isSuccess}
   assertEquals(1,listOf(assign,deactivate).count {it.get()})
  } finally {pool.shutdownNow()}
 }

}
