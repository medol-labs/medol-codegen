// Generated MEDOL scheduling contract. Provider instances are selected per plan.
package <%= rootPackage %>.scheduling.infrastructure

import java.time.Instant
import java.util.UUID
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonUnwrapped
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling

@ConfigurationProperties("medol.scheduling")
class SchedulingProperties {
 var providers: Map<String, SchedulingProviderSettings> = emptyMap()
 var targets: Map<String, SchedulingRemoteTarget> = emptyMap()
 var callbackBaseUrl: String = ""
 var misfireGraceSeconds: Long = 60
 var enabled: Boolean = false
}
class SchedulingProviderSettings {
 var kind: String = "snail-job"
 var baseUrl: String = ""
 var namespace: String = ""
 var group: String = ""
 var token: String = ""
 // Must equal the SnailJob server JVM timezone; UTC is recommended.
 var serverTimeZone: String = "UTC"
 // Adapter-specific instance settings (for example a future PowerJob app name).
 var options: Map<String, String> = emptyMap()
}
class SchedulingRemoteTarget { var baseUrl: String = ""; var token: String = "" }
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SchedulingProperties::class)
@EnableScheduling
class SchedulingConfiguration

data class ScheduleConfiguration(val planName: String, val providerKey: String, val targetKey: String,
 val argumentsJson: String, val scheduleKind: String, val scheduleExpression: String, val timeZone: String, val misfirePolicy: String)
@JsonIgnoreProperties(ignoreUnknown = true)
class ScheduleSnapshot {
 var scheduleId: UUID = UUID(0,0)
 var planName: String = ""
 var providerKey: String = ""
 var targetKey: String = ""
 var argumentsJson: String = "{}"
 var scheduleKind: String = ""
 var scheduleExpression: String = ""
 var timeZone: String = "UTC"
 var misfirePolicy: String = "FireOnce"
 var planVersion: Long = 0
 var state: String = "Draft"
 var nextAt: String? = null
 var lastScheduledAt: String? = null
 var occurrenceId: UUID? = null
 var scheduledAt: String? = null
 var dispatch: Boolean? = null
 @get:com.fasterxml.jackson.annotation.JsonIgnore
 val configuration get() = ScheduleConfiguration(planName,providerKey,targetKey,argumentsJson,scheduleKind,scheduleExpression,timeZone,misfirePolicy)
}
data class ScheduledDelivery(val scheduleId: UUID, val expectedVersion: Long, val providerKey: String, val scheduledAt: String)
data class ScheduledTargetCall(val targetKey: String, val argumentsJson: String, val occurrenceId: UUID, val scheduledAt: String)
/** ensure/cancel MUST be idempotent by occurrence ID, including after an uncertain HTTP response. */
interface SchedulingProvider {
 val kind: String
 fun validate(settings: SchedulingProviderSettings)
 fun ensure(settings: SchedulingProviderSettings, occurrenceId: UUID, dueAt: Instant, delivery: ScheduledDelivery)
 fun cancel(settings: SchedulingProviderSettings, occurrenceId: UUID)
}
fun scheduleOccurrence(id: UUID, version: Long, at: String): UUID =
 UUID.nameUUIDFromBytes("$id:$version:$at".toByteArray(Charsets.UTF_8))
