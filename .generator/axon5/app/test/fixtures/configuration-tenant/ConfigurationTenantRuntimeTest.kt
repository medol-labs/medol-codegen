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
import tech.medo.shared.application.tenancy.*

@org.springframework.test.context.TestExecutionListeners(listeners=[org.springframework.test.context.support.DependencyInjectionTestExecutionListener::class],mergeMode=org.springframework.test.context.TestExecutionListeners.MergeMode.REPLACE_DEFAULTS)
@org.springframework.context.annotation.Import(ConfigurationTenantRuntimeTest.Config::class)
@SpringBootTest(properties=["spring.docker.compose.enabled=false","spring.flyway.enabled=false","spring.datasource.url=jdbc:h2:mem:management;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;INIT=CREATE DOMAIN IF NOT EXISTS BLOB AS BYTEA","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=test","spring.jpa.hibernate.ddl-auto=create-drop","axon.axonserver.enabled=false","axon.axonserver.event-store.enabled=false","axon.update-check.disabled=true","medol.axon.event-storage=inmemory","medol.axon.flow-logging.enabled=false","medol.security.admin-bootstrap.enabled=false","medol.management.outbox-delay-ms=3600000"])
class ConfigurationTenantRuntimeTest @Autowired constructor(private val settings:SystemConfigurationService,
 private val store:ManagementStore,private val mapper:ObjectMapper,private val jdbc:JdbcTemplate,private val gateway:CommandGateway,private val publisher:ManagementOutboxPublisher,private val definitions:Definitions) {
 companion object {
  @JvmStatic fun tenantAccessFixture():TenantAccess=object:TenantAccess {
   override fun initialize(contract:TenantCapabilityContract) {}
   override fun verify(tenantId:String,userId:String):TenantIdentity {
    if(userId!="operator" || tenantId !in setOf("tenant-a","tenant-b")) throw org.springframework.security.access.AccessDeniedException("Denied")
    return TenantIdentity(tenantId,userId)
   }
   override fun forEachTenant(userId:String,block:()->Unit) {}
  }

  @JvmStatic @org.springframework.test.context.DynamicPropertySource fun database(r:org.springframework.test.context.DynamicPropertyRegistry) {
   if(System.getenv("MANAGEMENT_TEST_ISOLATED")=="true") r.add("spring.jpa.hibernate.ddl-auto"){"none"}
   System.getenv("MANAGEMENT_TEST_PRIMARY_URL")?.let {url->r.add("spring.datasource.url"){url};r.add("spring.datasource.driver-class-name"){"org.postgresql.Driver"};r.add("spring.datasource.username"){"postgres"}}
  }
 }
 class Definitions(private val mapper:ObjectMapper):ConfigurationDefinitionProvider {
  override val groupKey="exports";override var version="v1"
  override val definitions get()=listOf(ConfigurationDefinition("enabled","boolean",mapper.valueToTree(false)),ConfigurationDefinition("limit","integer",mapper.valueToTree(100),tenantOverride=true,minimum=java.math.BigDecimal.ONE,maximum=java.math.BigDecimal(10000)),ConfigurationDefinition("batch","integer",mapper.valueToTree(10))) + if(version=="v1") listOf(ConfigurationDefinition("legacy","string",required=false)) else emptyList()
  override fun validate(values:Map<String,JsonNode>) {require(values.getValue("batch").asInt()<=values.getValue("limit").asInt()) {"Batch must not exceed limit"}}
 }
 @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
 class Config {
  @org.springframework.context.annotation.Bean fun definitions(mapper:ObjectMapper)=Definitions(mapper)

 }
 @org.springframework.test.context.bean.override.convention.TestBean(name="sameSchemaTenantAccess",methodName="tenantAccessFixture") private lateinit var tenantAccess:TenantAccess
 private fun setup() {
  if(jdbc.queryForObject("select count(*) from information_schema.tables where table_name='medol_management_records'",Int::class.java)==0)
   javaClass.getResource("/db/migration/V2026110804__management.sql")!!.readText().split(';').filter {it.isNotBlank()}.forEach {jdbc.execute(it)}
 }
 private fun input(vararg fields:Pair<String,Any?>):ObjectNode=mapper.valueToTree(mapOf("reason" to "Test")+fields)

 @Test fun tenantOverridesAreIsolatedAuthorizedAndRevalidated() {
  setup()
  fun create(scope:String,scopeId:String,json:String):UUID=UUID.randomUUID().also {id->settings.execute("CreateConfigurationSet",input("configurationSetId" to id,"groupKey" to "exports","scopeType" to scope,"scopeId" to scopeId,"valuesJson" to json),"operator")}
  val app=create("APPLICATION","application","""{"legacy":"old"}""")
  val a=create("TENANT","tenant-a","""{"limit":20}""")
  val b=create("TENANT","tenant-b","""{"limit":50}""")
  TenantScope.withIdentity(TenantIdentity("tenant-a","operator")) {assertEquals(20L,settings.resolve("exports","tenant-a","operator").integer("limit"))}
  assertEquals(50L,settings.resolve("exports","tenant-b","operator").integer("limit"))
  assertEquals(100L,settings.resolve("exports",null,"operator").integer("limit"))
  assertThrows(org.springframework.security.access.AccessDeniedException::class.java){settings.resolve("exports","tenant-a","other-user")}
  assertThrows(org.springframework.security.access.AccessDeniedException::class.java){settings.resolve("exports","missing","operator")}
  assertThrows(IllegalArgumentException::class.java){settings.execute("ChangeConfigurationSet",input("configurationSetId" to a,"expectedRevision" to 1,"changesJson" to """{"enabled":true}"""),"operator")}
  assertThrows(IllegalArgumentException::class.java){settings.execute("ChangeConfigurationSet",input("configurationSetId" to app,"expectedRevision" to 1,"changesJson" to """{"batch":30}"""),"operator")}
  assertEquals(1L,settings.resolve("exports",null,"operator").applicationRevision)
  settings.execute("ChangeConfigurationSet",input("configurationSetId" to a,"expectedRevision" to 1,"changesJson" to """{"limit":null}"""),"operator")
  assertEquals(100L,settings.resolve("exports","tenant-a","operator").integer("limit"))
  val retiredEvent=UUID.randomUUID()
  jdbc.update("insert into medol_management_outbox(event_id,capability,event_kind,payload_json,actor_id,correlation_id,created_at) values (?,'organization','OldOrganizationEvent','{}','operator','old',?)",retiredEvent,java.sql.Timestamp.from(Instant.EPOCH))
  repeat(10){publisher.publishPending()}
  assertEquals(0,jdbc.queryForObject("select count(*) from medol_management_outbox where delivered=false and capability='configuration'",Int::class.java))
  val deadline=System.nanoTime()+20_000_000_000
  while(jdbc.queryForObject("select count(*) from system_configuration_configuration_set_catalog where configuration_set_id=? and revision=2",Int::class.java,a)!=1) {
   if(System.nanoTime()>deadline) fail<Unit>("Configuration catalog timeout");Thread.sleep(25)
  }
  assertEquals(false,jdbc.queryForObject("select delivered from medol_management_outbox where event_id=?",Boolean::class.java,retiredEvent))
  definitions.version="v2"
  assertThrows(IllegalArgumentException::class.java){settings.resolve("exports",null,"operator")}
  settings.execute("ChangeConfigurationSet",input("configurationSetId" to app,"expectedRevision" to 1,"changesJson" to """{"legacy":null}"""),"operator")
  assertEquals("v2",settings.resolve("exports",null,"operator").definitionVersion)
  assertThrows(IllegalArgumentException::class.java){settings.resolve("exports","tenant-a","operator")}
  settings.execute("ChangeConfigurationSet",input("configurationSetId" to a,"expectedRevision" to 2,"changesJson" to "{}"),"operator")
  settings.execute("ChangeConfigurationSet",input("configurationSetId" to b,"expectedRevision" to 1,"changesJson" to "{}"),"operator")
  assertEquals("v2",settings.resolve("exports","tenant-a","operator").definitionVersion)
  assertEquals(50L,settings.resolve("exports","tenant-b","operator").integer("limit"))
  assertThrows(IllegalArgumentException::class.java){settings.execute("ChangeConfigurationSet",input("configurationSetId" to app,"expectedRevision" to 2,"changesJson" to """{"unknown":null}"""),"operator")}

 }
}
