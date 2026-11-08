// Generated MEDOL document-generation contracts.
package <%= rootPackage %>.documentgeneration.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import java.util.UUID
import java.time.Instant
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Bean
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean

@ConfigurationProperties("medol.documents")
class DocumentProperties {
 var enabled: Boolean = false
 var storagePath: String = "build/documents"
 var fontPath: String = ""
 var maxPages: Int = 200
}
@Configuration(proxyBeanMethods=false)
@EnableConfigurationProperties(DocumentProperties::class)
class DocumentConfiguration {
 @Bean @ConditionalOnMissingBean(DocumentArtifactStore::class)
 fun documentArtifactStore(properties:DocumentProperties):DocumentArtifactStore = LocalDocumentArtifactStore(properties)
}

data class DocumentField(val type:String, val required:Boolean=true,
 val properties:Map<String,DocumentField> = emptyMap(), val items:DocumentField?=null)
data class DocumentContract(val version:String, val root:DocumentField)
data class DocumentSnapshot(val sourceVersion:String, val data:JsonNode)
data class DocumentInput(val objectRef:String, val locale:String, val timeZone:String)
data class DocumentIdentity(val userId:String)
enum class DocumentAction { GENERATE, READ }
/** Own eligibility, row-level authorization and atomic data reads. No renderer can query business tables.
 * snapshot executes once inside the primary transaction; return an immutable versioned view.
 * authorize MUST throw on denial (including missing identity), and is checked again on every download.
 */
interface DocumentDataProvider {
 val key:String
 val contract:DocumentContract
 fun authorize(identity:DocumentIdentity, objectRef:String, action:DocumentAction)
 fun snapshot(identity:DocumentIdentity, input:DocumentInput):DocumentSnapshot
}
interface DocumentRenderer {
 val key:String
 /** Pin library/font/rendering configuration. Changing it makes pending jobs fail instead of silently changing output. */
 fun version():String
 fun validate(template:JsonNode, contract:DocumentContract)
 fun render(template:JsonNode, data:JsonNode):ByteArray
}
data class DocumentArtifact(val reference:String, val sha256:String, val size:Long)
/** Artifacts are owned by a documentId + immutable input fingerprint; no arbitrary paths or public URLs.
 * putIfAbsent must publish a complete artifact atomically and return the existing result on retries.
 */
interface DocumentArtifactStore {
 fun find(documentId:UUID, inputHash:String):DocumentArtifact?
 fun putIfAbsent(documentId:UUID, inputHash:String, bytes:ByteArray):DocumentArtifact
 fun read(documentId:UUID, inputHash:String, expectedHash:String):ByteArray
}
data class TemplateDefinition(val templateVersionId:UUID, val templateKey:String, val versionLabel:String,
 val providerKey:String, val contractVersion:String, val rendererKey:String, val templateContent:String)
fun documentHash(bytes:ByteArray):String = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
fun documentHash(text:String):String = documentHash(text.toByteArray(Charsets.UTF_8))
