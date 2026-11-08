package <%= rootPackage %>.scheduling.infrastructure

import java.time.*
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.net.http.HttpClient
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.JsonNode
import org.springframework.stereotype.Component
import org.springframework.http.HttpMethod
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient
import <%= rootPackage %>.shared.security.MedolSecurityProperties

/** SnailJob 2.0.2 OpenAPI. Uses its Java worker's built-in snailJobHttpExecutor. */
@Component
class SnailJobProvider(private val mapper: ObjectMapper, private val properties: SchedulingProperties,
 private val security: MedolSecurityProperties): SchedulingProvider {
 override val kind="snail-job"
 private val http=RestClient.builder().requestFactory(JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()).apply {setReadTimeout(Duration.ofSeconds(10))}).build()
 override fun validate(settings: SchedulingProviderSettings) {
  require(settings.baseUrl.startsWith("http://") || settings.baseUrl.startsWith("https://")) { "SnailJob base URL is required." }
  require(settings.namespace.isNotBlank() && settings.group.isNotBlank() && settings.token.isNotBlank()) { "SnailJob namespace, group and token are required." }
  require(properties.callbackBaseUrl.startsWith("http://") || properties.callbackBaseUrl.startsWith("https://")) { "Scheduling callback URL is required." }
  require(security.internalToken.isNotBlank()) { "Scheduling callback internal token is required." }
  // Point-in-time OpenAPI accepts local server time without an offset. A fixed zone avoids DST ambiguity.
  require(ZoneId.of(settings.serverTimeZone).rules.isFixedOffset) { "SnailJob server timezone must have a fixed offset (prefer UTC)." }
 }
 private fun request(s: SchedulingProviderSettings, method: HttpMethod, path: String, body: Any? = null): JsonNode {
  val req=http.method(method).uri(s.baseUrl.trimEnd('/')+path).header("namespace",s.namespace).header("group-name",s.group).header("token",s.token)
  val response=(if(body==null) req else req.body(body)).retrieve().body(JsonNode::class.java) ?: error("Empty SnailJob response")
  check(response.path("status").asInt()==1) { "SnailJob rejected scheduling operation." }
  return response.path("data")
 }
 override fun ensure(settings: SchedulingProviderSettings, occurrenceId: UUID, dueAt: Instant, delivery: ScheduledDelivery) {
  validate(settings)
  val key="medol_$occurrenceId"
  val callback=mapOf("url" to properties.callbackBaseUrl.trimEnd('/')+"/api/scheduling/occurrences", "method" to "POST", "mediaType" to "application/json", "timeout" to 20,
   "headers" to mapOf("X-MEDOL-INTERNAL-TOKEN" to security.internalToken),"body" to mapper.writeValueAsString(delivery))
  // Recover a successful create whose HTTP response was lost, without resetting an executed job.
  val existing=request(settings,HttpMethod.GET,"/api/job/bizId/exists?bizId=$key")
  if(!existing.isMissingNode && !existing.isNull && existing.hasNonNull("id")) {
   check(existing.path("groupName").asText()==settings.group) { "SnailJob business ID belongs to another worker group." }
   if(existing.path("jobStatus").asInt()==0)
    check(request(settings,HttpMethod.PUT,"/api/job/bizId/updateStatus",mapOf("bizId" to key,"status" to 1)).asBoolean()) { "SnailJob reactivation failed." }
   // A still-current overdue occurrence may have exhausted worker retries. Re-trigger the same identity.
   if(dueAt.plusSeconds(60).isBefore(Instant.now()))
    check(request(settings,HttpMethod.POST,"/api/job/bizId/trigger",mapOf("bizId" to key,"tmpArgsStr" to mapper.writeValueAsString(callback))).asBoolean()) { "SnailJob overdue occurrence retry failed." }
   return
  }
  val at=maxOf(dueAt,Instant.now().plusSeconds(15))

  val payload=mapOf("bizId" to key,"groupName" to settings.group,"jobName" to key,"jobStatus" to 1,
   "argsStr" to mapper.writeValueAsString(callback),"argsType" to 2,"routeKey" to 4,"executorType" to 1,
   "executorInfo" to "snailJobHttpExecutor","triggerType" to 5,
   "triggerInterval" to mapper.writeValueAsString(listOf(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").format(at.atZone(ZoneId.of(settings.serverTimeZone))))),
   "blockStrategy" to 1,"executorTimeout" to 30,"maxRetryTimes" to 10,"retryInterval" to 10,"taskType" to 1,"parallelNum" to 1)
  request(settings,HttpMethod.POST,"/api/job/bizId/add",payload)
 }
 override fun cancel(settings: SchedulingProviderSettings, occurrenceId: UUID) {
  val key="medol_$occurrenceId"
  val exists=request(settings,HttpMethod.GET,"/api/job/bizId/exists?bizId=$key")
  if(exists.isNull || exists.isMissingNode || !exists.hasNonNull("id")) return
  check(exists.path("groupName").asText()==settings.group) { "SnailJob business ID belongs to another worker group." }
  check(request(settings,HttpMethod.PUT,"/api/job/bizId/updateStatus",mapOf("bizId" to key,"status" to 0)).asBoolean()) { "SnailJob cancellation failed." }
  // Keep execution history on the server; apply retention there independently.
 }
}
