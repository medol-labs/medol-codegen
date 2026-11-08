// Generated MEDOL reporting contracts. Business SQL and data authorization belong to providers.
package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import java.time.*

enum class ReportValueType { STRING, INTEGER, DECIMAL, BOOLEAN, DATE, INSTANT }
enum class ReportAction { QUERY, EXPORT, DOWNLOAD }
data class ReportField(val name:String,val label:String,val type:ReportValueType,val required:Boolean=true)
data class ReportContract(val version:String,val parameters:List<ReportField>,val columns:List<ReportField>)
/** sourceVersion must describe actual data freshness, never merely the request time. */
data class ReportSource(val sourceVersion:String,val consistency:String) {
 init {require(sourceVersion.isNotBlank() && sourceVersion.length<=2000);require(consistency in setOf("EVENTUAL","SNAPSHOT"))}
}
data class ReportPage(val rows:List<Map<String,JsonNode>>,val hasMore:Boolean,val source:ReportSource)
interface ReportStream:AutoCloseable {
 val source:ReportSource
 /** Empty means end. Stable row ordering and a bounded, read-only query timeout are required. */
 fun nextBatch(limit:Int):List<Map<String,JsonNode>>
 override fun close()
}
interface ReportProvider {
 val key:String
 val contract:ReportContract
 /** Change when query semantics change. Pending jobs refuse changed implementations. */
 val fingerprint:String
 /** Recheck current identity, row scope and all exposed columns; background calls have no HTTP security context. */
 fun authorize(actor:String,parameters:ObjectNode,action:ReportAction)
 fun query(actor:String,parameters:ObjectNode,offset:Int,limit:Int):ReportPage
 /** Own the read-only connection/transaction until close; SNAPSHOT requires one consistent snapshot for all batches. */
 fun openExport(actor:String,parameters:ObjectNode):ReportStream
}
internal fun reportJson(mapper:ObjectMapper,value:String):ObjectNode {
 require(value.toByteArray(Charsets.UTF_8).size<=65536) {"Report parameters exceed 64 KiB"}
 val node=mapper.factory.createParser(value).use {p->
  p.enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
  val result=mapper.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).readTree<JsonNode>(p);require(p.nextToken()==null) {"Expected one JSON object"};result
 }
 require(node is ObjectNode) {"Expected a parameter object"};return node
}
internal fun validateReportContract(c:ReportContract) {
 require(c.version.matches(Regex("[A-Za-z0-9_.-]{1,100}")))
 require(c.parameters.size<=30 && c.columns.size in 1..100)
 for(fields in listOf(c.parameters,c.columns)) {
  require(fields.map {it.name}.distinct().size==fields.size)
  require(fields.all {it.name.matches(Regex("[A-Za-z][A-Za-z0-9_]{0,79}")) && it.label.isNotBlank() && it.label.length<=160})
 }
}
internal fun validateReportValues(values:Map<String,JsonNode>,fields:List<ReportField>) {
 require(values.values.sumOf {it.asText().length.toLong()}<=65536L) {"Report row exceeds 64 KiB of text"}
 require(values.keys.all {key->fields.any {it.name==key}}) {"Unknown report field"}
 for(f in fields) {
  val n=values[f.name]
  if(n==null || n.isNull) {require(!f.required) {"${f.name} is required"};continue}
  val valid=when(f.type) {
   ReportValueType.STRING->n.isTextual && n.asText().length<=16384
   ReportValueType.INTEGER->n.isIntegralNumber && n.canConvertToLong()
   ReportValueType.DECIMAL->n.isNumber && n.asText().length<=100 && n.asText() !in setOf("NaN","Infinity","-Infinity")
   ReportValueType.BOOLEAN->n.isBoolean
   ReportValueType.DATE->n.isTextual && runCatching {LocalDate.parse(n.asText()).toString()==n.asText()}.getOrDefault(false)
   ReportValueType.INSTANT->n.isTextual && runCatching {Instant.parse(n.asText())}.isSuccess
  };require(valid) {"Invalid report field ${f.name}"}
 }
}
internal fun ObjectNode.reportValues():Map<String,JsonNode> = fields().asSequence().associate {it.key to it.value}

class ReportParametersDeserializer:com.fasterxml.jackson.databind.JsonDeserializer<ObjectNode>() {
 override fun deserialize(p:com.fasterxml.jackson.core.JsonParser,context:com.fasterxml.jackson.databind.DeserializationContext):ObjectNode {
  p.enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
  val node=(p.codec as ObjectMapper).reader().with(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).readTree<JsonNode>(p)
  require(node is ObjectNode);return node
 }
}
