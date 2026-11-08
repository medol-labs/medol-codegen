package <%= rootPackage %>.documentgeneration.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import org.springframework.stereotype.Component

@Component
class DocumentValidation {
 private val pathPattern=Regex("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*")
 fun contract(contract:DocumentContract) {
  require(contract.version.isNotBlank() && contract.version.length<=100)
  require(contract.root.type=="object") { "Document root must be an object" }
  fun visit(f:DocumentField,depth:Int) {
   require(depth<=12 && f.type in setOf("object","array","string","number","boolean")) { "Invalid document contract" }
   if(f.type=="object") {
    require(f.properties.size<=200 && f.items==null)
    f.properties.forEach { (name,child)->require(Regex("[A-Za-z_][A-Za-z0-9_]*").matches(name));visit(child,depth+1) }
   } else {require(f.properties.isEmpty());if(f.type=="array") visit(requireNotNull(f.items),depth+1) else require(f.items==null)}
  }
  visit(contract.root,0)
 }
 fun field(root:DocumentField,path:String):DocumentField {
  require(pathPattern.matches(path)) { "Invalid field path: $path" }
  var current=root
  for(part in path.split('.')) {require(current.type=="object");current=requireNotNull(current.properties[part]) { "Unknown template field: $path" }}
  return current
 }
 fun value(data:JsonNode,path:String):JsonNode? {
  var current:JsonNode?=data
  for(part in path.split('.')) current=current?.get(part)
  return current?.takeUnless {it.isNull}
 }
 fun data(contract:DocumentContract,data:JsonNode) {
  contract(contract)
  require(data.isObject) { "Document data root must be an object" }
  fun visit(f:DocumentField,n:JsonNode?,path:String,depth:Int) {
   require(depth<=12)
   if(n==null || n.isNull) {require(!f.required) { "Required document field missing: $path" };return}
   when(f.type) {
    "object" -> {require(n.isObject);require(n.fieldNames().asSequence().all {it in f.properties}) { "Unknown document data field at $path" };f.properties.forEach {(k,v)->visit(v,n.get(k),"$path.$k",depth+1)}}
    "array" -> {require(n.isArray && n.size()<=10000);n.forEachIndexed {i,v->visit(requireNotNull(f.items),v,"$path[$i]",depth+1)}}
    "string" -> require(n.isTextual && n.textValue().length<=100000) { "Expected string at $path" }
    "number" -> require(n.isNumber && n.asText().length<=100) { "Expected number at $path" }
    "boolean" -> require(n.isBoolean) { "Expected boolean at $path" }
    else -> error("Unknown type")
   }
  }
  visit(contract.root,data,"root",0)
 }
}
