package <%= rootPackage %>.scheduling.infrastructure

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.node.ObjectNode
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.*
import org.springframework.web.client.RestClient
import org.springframework.http.client.JdkClientHttpRequestFactory
import java.net.http.HttpClient
import java.time.*
import java.security.MessageDigest
import <%= rootPackage %>.shared.security.MedolSecurityProperties

@Component
class SchedulingTargets(private val mapper: ObjectMapper, private val gateway: CommandGateway,
 private val settings: SchedulingProperties) {
 private val http = RestClient.builder().requestFactory(JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()).apply {setReadTimeout(Duration.ofSeconds(20))}).build()
 val localKeys: Set<String> = setOf(<%- targets.filter(t=>t.local).map(t=>JSON.stringify(t.key)).join(',') %>)
 private fun command(call: ScheduledTargetCall): Any {
  require(call.argumentsJson.length<=65536) { "Schedule arguments exceed 64 KiB." }
  val tree=mapper.readTree(call.argumentsJson)
  require(tree is ObjectNode) { "Schedule arguments must be an object." }
  when(call.targetKey) {
<% for(const t of targets.filter(t=>t.local)) { %>   "<%= t.key %>" -> {
    val allowed=setOf<String>(<%- t.fields.filter(f=>f!==t.occurrenceField&&f!==t.scheduledAtField).map(f=>JSON.stringify(f)).join(',') %>)
    val required=setOf<String>(<%- t.required.filter(f=>f!==t.occurrenceField&&f!==t.scheduledAtField).map(f=>JSON.stringify(f)).join(',') %>)
    require(required.all {tree.hasNonNull(it)}) { "Required scheduled command arguments are missing." }
    require(tree.fieldNames().asSequence().all { it in allowed }) { "Arguments contain unknown, generated or occurrence-owned fields." }
    tree.put("<%= t.occurrenceField %>",call.occurrenceId.toString())
<% if(t.scheduledAtField) { %>    tree.put("<%= t.scheduledAtField %>",LocalDateTime.ofInstant(Instant.parse(call.scheduledAt),ZoneOffset.UTC).toString())
<% } %>    return mapper.readerFor(<%= t.qualified %>::class.java).with(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES).readValue<Any>(tree)
   }
<% } %>   else -> error("Scheduling target is not bound in this deployment: ${call.targetKey}")
  }
 }
 fun validate(call: ScheduledTargetCall) { if(call.targetKey in localKeys) command(call) else remote(call,"validate") }
 fun dispatch(call: ScheduledTargetCall) { if(call.targetKey in localKeys) gateway.send(command(call)).resultMessage.join() else remote(call,"dispatch") }
 private fun remote(call: ScheduledTargetCall, action: String) {
  require(call.targetKey in setOf(<%- targets.map(t=>JSON.stringify(t.key)).join(',') %>)) { "Unmodeled scheduling target." }
  val target=settings.targets[call.targetKey] ?: error("Configure medol.scheduling.targets[${call.targetKey}].base-url and token.")
  require(target.token.isNotBlank() && target.baseUrl.startsWith("http")) { "Remote scheduling target is not configured." }
  http.post().uri(target.baseUrl.trimEnd('/')+"/api/scheduling/targets/$action")
   .header("X-MEDOL-INTERNAL-TOKEN",target.token).body(call).retrieve().toBodilessEntity()
 }
}
@RestController
@RequestMapping("/api/scheduling/targets")
class SchedulingTargetEndpoints(private val targets: SchedulingTargets, private val security: MedolSecurityProperties) {
 private fun authorize(token: String?) {
  if(security.internalToken.isBlank() || token==null || !MessageDigest.isEqual(token.toByteArray(),security.internalToken.toByteArray()))
   throw org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED)
 }
 @PostMapping("/validate")
 fun validate(@RequestHeader("X-MEDOL-INTERNAL-TOKEN",required=false) token: String?, @RequestBody call: ScheduledTargetCall) {
  authorize(token); require(call.targetKey in targets.localKeys); targets.validate(call)
 }
 @PostMapping("/dispatch")
 fun dispatch(@RequestHeader("X-MEDOL-INTERNAL-TOKEN",required=false) token: String?, @RequestBody call: ScheduledTargetCall) {
  authorize(token); require(call.targetKey in targets.localKeys); targets.dispatch(call)
 }
}
