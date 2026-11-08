package <%= rootPackage %>.management.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.UUID

/** Cross-object invariants are checked under one database lock, never against asynchronous catalogs. */
@Service
class OrganizationService(private val store:ManagementStore,private val mapper:ObjectMapper) {
 private val capability="organization"
 private val definitions=mapOf(
  "OrganizationUnit" to listOf("organizationId","organizationCode","organizationName","organizationType","parentOrganizationId"),
  "PositionDefinition" to listOf("positionId","positionCode","positionName"),
  "OrganizationPosition" to listOf("organizationPositionId","organizationId","positionId"),
  "OrganizationMember" to listOf("memberId","memberCode","memberName","userAccountId"),
  "PositionAssignment" to listOf("assignmentId","memberId","organizationPositionId","validFrom","validUntil","primaryAssignment")
 )
 private val operations=mapOf(
<%- organizationOperations %>
 )
 private fun required(node:JsonNode,key:String):String=node.path(key).takeUnless {it.isMissingNode || it.isNull}?.asText()?.takeIf {it.isNotBlank()} ?: throw IllegalArgumentException("$key is required")
 private fun uuid(node:JsonNode,key:String)=UUID.fromString(required(node,key))
 private fun at(node:JsonNode,key:String):Instant?=node[key]?.takeUnless {it.isNull}?.asText()?.let(Instant::parse)
 private fun record(kind:String,id:UUID):ObjectNode=store.record(capability,id)?.takeIf {it.path(definitions.getValue(kind).first()).asText()==id.toString()} ?: throw IllegalArgumentException("$kind does not exist")
 private fun active(kind:String,id:UUID)=record(kind,id).also {require(it.path("state").asText()=="Active") {"$kind must be Active"}}
 private fun revision(row:JsonNode,input:JsonNode) {require(input.path("expectedRevision").isIntegralNumber && row.path("revision").asLong()==input.path("expectedRevision").asLong()) {"Revision conflict"}}
 private fun stillAssigned(row:JsonNode)=row.path("state").asText()!="Cancelled" && (at(row,"validUntil") ?: Instant.MAX)>Instant.now()
 private fun eligiblePosition(id:UUID) {val p=active("OrganizationPosition",id);active("OrganizationUnit",uuid(p,"organizationId"));active("PositionDefinition",uuid(p,"positionId"))}
 private fun validate(kind:String,row:ObjectNode,id:UUID) {
  val others=store.rows(capability,kind).filter {uuid(it,definitions.getValue(kind).first())!=id}
  definitions.getValue(kind).filter {it.endsWith("Code") || it.endsWith("Name") || it=="organizationType"}.forEach {key->require(required(row,key).length<=160) {"$key is too long"}}
  val code=definitions.getValue(kind).firstOrNull {it.endsWith("Code")}
  if(code!=null) require(others.none {it.path(code).asText()==row.path(code).asText()}) {"Code already exists"}
  when(kind) {
   "OrganizationUnit" -> {
    val visited=mutableSetOf(id);var parent=row["parentOrganizationId"]?.takeUnless {it.isNull}?.asText()?.let(UUID::fromString)
    while(parent!=null) {require(visited.add(parent)) {"Organization tree cannot contain cycles"};val p=active("OrganizationUnit",parent);parent=p["parentOrganizationId"]?.takeUnless {it.isNull}?.asText()?.let(UUID::fromString)}
   }
   "OrganizationPosition" -> {
    active("OrganizationUnit",uuid(row,"organizationId"));active("PositionDefinition",uuid(row,"positionId"))
    require(others.none {it.path("organizationId")==row.path("organizationId") && it.path("positionId")==row.path("positionId")}) {"Organization position already exists; reactivate it instead"}
   }
   "OrganizationMember" -> row["userAccountId"]?.takeUnless {it.isNull}?.let {account->UUID.fromString(account.asText());require(others.none {it["userAccountId"]==account}) {"Account is already linked to another member"}}
   "PositionAssignment" -> {
    active("OrganizationMember",uuid(row,"memberId"));eligiblePosition(uuid(row,"organizationPositionId"))
    val start=requireNotNull(at(row,"validFrom"));val end=at(row,"validUntil") ?: Instant.MAX
    require(start<end) {"Assignment must have a positive half-open interval"}
    require(row.path("primaryAssignment").isBoolean)
    require(others.none {other -> other.path("state").asText()!="Cancelled" && other.path("memberId")==row.path("memberId") &&
     requireNotNull(at(other,"validFrom"))<end && start<(at(other,"validUntil") ?: Instant.MAX) &&
     (other.path("organizationPositionId")==row.path("organizationPositionId") || (other.path("primaryAssignment").asBoolean() && row.path("primaryAssignment").asBoolean()))
    }) {"Overlapping assignment or primary appointment"}
   }
  }
 }
 private fun canDeactivate(kind:String,id:UUID) {
  val assignments=store.rows(capability,"PositionAssignment").filter(::stillAssigned)
  val positions=store.rows(capability,"OrganizationPosition")
  when(kind) {
   "OrganizationUnit" -> {
    require(store.rows(capability,kind).none {it.path("parentOrganizationId").asText()==id.toString() && it.path("state").asText()=="Active"}) {"Active child organizations exist"}
    require(positions.none {it.path("organizationId").asText()==id.toString() && it.path("state").asText()=="Active"}) {"Active organization positions exist"}
   }
   "PositionDefinition" -> require(positions.none {it.path("positionId").asText()==id.toString() && it.path("state").asText()=="Active"}) {"Active organization positions exist"}
   "OrganizationPosition" -> require(assignments.none {it.path("organizationPositionId").asText()==id.toString()}) {"Current or future assignments exist"}
   "OrganizationMember" -> require(assignments.none {it.path("memberId").asText()==id.toString()}) {"Current or future assignments exist"}
  }
 }
 fun execute(operation:String,input:JsonNode,actor:String):Unit=store.locked(capability) {
  require(actor.isNotBlank() && actor!="anonymous") {"Authentication required"}
  require(required(input,"reason").length<=1000)
  if(operation=="TransferPositionAssignment") {transfer(input,actor);return@locked}
  val (kind,event)=requireNotNull(operations[operation]) {"Unsupported organization operation"}
  val fields=definitions.getValue(kind);val id=uuid(input,fields.first());val existing=store.record(capability,id)
  val create=operation.startsWith("Create") || operation.startsWith("Define") || operation.startsWith("Establish") || operation.startsWith("Register") || operation.startsWith("Confirm")
  if(create && existing!=null) {
   require(existing.has(fields.first()) && fields.all {existing[it]==input[it] || (existing[it]?.isNull==true && input[it]==null)}) {"Identifier already exists with different data"};return@locked
  }
  val row=if(create) mapper.createObjectNode() else record(kind,id).also {revision(it,input)}
  if(!create) {
   val state=row.path("state").asText()
   require(if(operation.startsWith("Activate")) state=="Inactive" else if(kind=="PositionAssignment") state=="Confirmed" else state=="Active") {"Operation is not allowed in current state"}
  }
  if(create || operation.startsWith("Revise")) for(field in fields) row.set<JsonNode>(field,input[field] ?: mapper.nullNode())
  when {
   operation.startsWith("Deactivate") -> {canDeactivate(kind,id);row.put("state","Inactive")}
   operation=="EndPositionAssignment" -> {
    val end=requireNotNull(at(input,"endedAt"));require(end>requireNotNull(at(row,"validFrom")) && end<=(at(row,"validUntil") ?: Instant.MAX)) {"End must shorten a valid assignment interval"}
    row.put("validUntil",end.toString());row.put("state","Ended")
   }
   operation=="CancelPositionAssignment" -> {require(requireNotNull(at(row,"validFrom"))>Instant.now()) {"Only future assignments may be cancelled; end an effective assignment"};row.put("state","Cancelled")}
   else -> {row.put("state",if(kind=="PositionAssignment") "Confirmed" else "Active");validate(kind,row,id)}
  }
  row.put("reason",required(input,"reason"));store.save(capability,kind,id,row,event,actor)
 }
 private fun transfer(input:JsonNode,actor:String) {
  val oldId=uuid(input,"assignmentId");val old=record("PositionAssignment",oldId);revision(old,input)
  require(old.path("state").asText()=="Confirmed") {"Only confirmed assignments can be transferred"}
  val nextId=uuid(input,"newAssignmentId");require(store.record(capability,nextId)==null) {"New assignment ID already exists"}
  val effective=requireNotNull(at(input,"effectiveAt"));require(effective>requireNotNull(at(old,"validFrom")) && effective<(at(old,"validUntil") ?: Instant.MAX)) {"Transfer must fall inside the existing interval"}
  val next=old.deepCopy();next.put("assignmentId",nextId.toString());next.put("organizationPositionId",uuid(input,"organizationPositionId").toString());next.put("validFrom",effective.toString());next.set<JsonNode>("primaryAssignment",input.path("primaryAssignment"));next.put("state","Confirmed")
  old.put("validUntil",effective.toString());old.put("state","Ended");old.put("reason",required(input,"reason"))
  store.save(capability,"PositionAssignment",oldId,old,"PositionAssignmentTransferredOut",actor)
  validate("PositionAssignment",next,nextId);next.put("reason",required(input,"reason"))
  store.save(capability,"PositionAssignment",nextId,next,"PositionAssignmentTransferredIn",actor)
 }
 fun currentAssignments(memberId:UUID,at:Instant=Instant.now()):List<ObjectNode> =store.locked(capability) {
  active("OrganizationMember",memberId)
  store.rows(capability,"PositionAssignment").filter {it.path("memberId").asText()==memberId.toString() && it.path("state").asText()!="Cancelled" && requireNotNull(at(it,"validFrom"))<=at && at<(at(it,"validUntil") ?: Instant.MAX)}
   .onEach {eligiblePosition(uuid(it,"organizationPositionId"))}
 }
 fun subtree(root:UUID):List<UUID> =store.locked(capability) {
  record("OrganizationUnit",root);val rows=store.rows(capability,"OrganizationUnit");val ids=linkedSetOf(root)
  do {val before=ids.size;rows.filter {it.path("parentOrganizationId").asText() in ids.map(UUID::toString)}.forEach {ids.add(uuid(it,"organizationId"))}} while(ids.size>before)
  ids.toList()
 }
}
