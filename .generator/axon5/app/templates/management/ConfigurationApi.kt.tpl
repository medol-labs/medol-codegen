// Generated MEDOL configuration contracts. Definitions are code-owned; values are operator-owned.
package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import java.math.BigDecimal

/** Null means no default; null is never a value. secretReference stores only a reference, never a secret. */
data class ConfigurationDefinition(val key:String,val type:String,val defaultValue:JsonNode?=null,
 val required:Boolean=true,val tenantOverride:Boolean=false,val minimum:BigDecimal?=null,val maximum:BigDecimal?=null,
 val choices:Set<String> = emptySet(),val effect:String="NEW_OPERATION",val description:String="")
interface ConfigurationDefinitionProvider {
 val groupKey:String
 val version:String
 val definitions:List<ConfigurationDefinition>
 /** Must be deterministic and side-effect free. Validate structured JSON and cross-field constraints here. */
 fun validate(values:Map<String,JsonNode>)
}
data class ConfigurationSnapshot(val groupKey:String,val definitionVersion:String,val applicationRevision:Long,
 val tenantRevision:Long,val values:Map<String,JsonNode>,val sources:Map<String,String>) {
 fun boolean(key:String)=requireNotNull(values[key]).also {require(it.isBoolean)}.booleanValue()
 fun integer(key:String)=requireNotNull(values[key]).also {require(it.isIntegralNumber && it.canConvertToLong())}.longValue()
 fun decimal(key:String)=requireNotNull(values[key]).also {require(it.isNumber)}.decimalValue()
 fun text(key:String)=requireNotNull(values[key]).also {require(it.isTextual)}.textValue()
 fun duration(key:String)=java.time.Duration.parse(text(key))
}
