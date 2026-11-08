package <%= rootPackage %>.scheduling.infrastructure

import jakarta.persistence.*
import java.time.*
import java.util.UUID
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.axonframework.messaging.eventhandling.annotation.EventHandler
import org.axonframework.messaging.core.annotation.Namespace
import org.axonframework.messaging.commandhandling.gateway.CommandGateway
<% if(tenancy) { %>import <%= rootPackage %>.shared.application.tenancy.TenantScope
<% } %>

@Entity
@Table(name="medol_schedule_sync"<% if(tenancy) { %>, schema="__medol_control__"<% } %>)
class ScheduleSyncRow {
 @Id var id: UUID = UUID.randomUUID()
 var planVersion: Long = 0
 @Column(columnDefinition="TEXT",nullable=false) var snapshotJson: String = ""
 var pending: Boolean = true
 var syncState: String = "Pending"
 var registeredId: UUID? = null
 var registeredProvider: String? = null
 var attempts: Int = 0
 var retryAt: Instant = Instant.EPOCH
 var errorType: String? = null
}
@Entity
@Table(name="medol_schedule_delivery"<% if(tenancy) { %>, schema="__medol_control__"<% } %>)
class ScheduleDeliveryRow {
 @Id var id: UUID = UUID.randomUUID()
 var scheduleId: UUID = UUID.randomUUID()
 @Column(columnDefinition="TEXT",nullable=false) var payloadJson: String = ""
 @Column(nullable=false) var scheduledAt: Instant = Instant.EPOCH
 var deliveryState: String = "Pending"
 var attempts: Int = 0
 var retryAt: Instant = Instant.EPOCH
 var errorType: String? = null
}

@Entity
@Table(name="medol_schedule_registration"<% if(tenancy) { %>, schema="__medol_control__"<% } %>)
class ScheduleRegistrationRow {
 @Id var id: UUID = UUID.randomUUID()
 var scheduleId: UUID = UUID.randomUUID()
 var providerKey: String = ""
 var cancelled: Boolean = false
}

@org.axonframework.messaging.eventhandling.replay.annotation.DisallowReplay
@Namespace("scheduling-integration")
@Component
class SchedulingProjection(private val store: SchedulingStore, private val mapper: ObjectMapper) {
<%- handlers %>
}

@Component
class SchedulingStore(private val transactions: PlatformTransactionManager, private val mapper: ObjectMapper,
 private val gateway: CommandGateway, private val targets: SchedulingTargets, private val properties: SchedulingProperties,
 private val providers: List<SchedulingProvider>) {
 @PersistenceContext private lateinit var em: EntityManager
 private val log=org.slf4j.LoggerFactory.getLogger(javaClass)
 private fun <T> tx(block: () -> T): T? = <% if(tenancy) { %>TenantScope.control { <% } %>TransactionTemplate(transactions).apply {propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW}.execute {block()}<% if(tenancy) { %> }<% } %>
 fun record(s: ScheduleSnapshot) { tx {
  val row=em.find(ScheduleSyncRow::class.java,s.scheduleId,LockModeType.PESSIMISTIC_WRITE) ?: ScheduleSyncRow().apply {id=s.scheduleId;em.persist(this)}
  // Journal every possible registration before any external API call. This survives a lost create response or process crash.
  if(s.state=="Active" && s.nextAt!=null) {
   val registrationId=scheduleOccurrence(s.scheduleId,s.planVersion,s.nextAt!!)
   if(em.find(ScheduleRegistrationRow::class.java,registrationId)==null) em.persist(ScheduleRegistrationRow().apply {id=registrationId;scheduleId=s.scheduleId;providerKey=s.providerKey})
  }
  if(s.planVersion>row.planVersion) {row.planVersion=s.planVersion;row.snapshotJson=mapper.writeValueAsString(s);row.pending=true;row.syncState="Pending";row.retryAt=Instant.EPOCH;row.attempts=0}
  if(s.planVersion<=row.planVersion && s.state=="Active" && s.nextAt!=null) row.retryAt=Instant.EPOCH
  if(s.occurrenceId!=null && em.find(ScheduleDeliveryRow::class.java,s.occurrenceId)==null) {
   em.persist(ScheduleDeliveryRow().apply {id=s.occurrenceId!!;scheduleId=s.scheduleId;scheduledAt=Instant.parse(s.scheduledAt);payloadJson=mapper.writeValueAsString(ScheduledTargetCall(s.targetKey,s.argumentsJson,id,s.scheduledAt!!));deliveryState=if(s.dispatch==true) "Pending" else "Skipped"})
  }
 } }
 fun status(id: UUID): Map<String,Any?> = tx {
  val row=em.find(ScheduleSyncRow::class.java,id) ?: return@tx mapOf("synchronizationState" to "AwaitingProjection")
  mapOf("planVersion" to row.planVersion,"synchronizationState" to row.syncState,"errorType" to row.errorType,
   "deliveries" to em.createQuery("select d from ScheduleDeliveryRow d where d.scheduleId=:id order by d.scheduledAt desc, d.id desc",ScheduleDeliveryRow::class.java).setParameter("id",id).setMaxResults(100).resultList.map {mapOf("occurrenceId" to it.id,"state" to it.deliveryState,"scheduledAt" to it.scheduledAt,"attempts" to it.attempts,"errorType" to it.errorType)})
 }!!
 private fun provider(key: String): Pair<SchedulingProvider,SchedulingProviderSettings> {
  val settings=properties.providers[key] ?: error("Scheduling provider instance missing: $key")
  return providers.single {it.kind==settings.kind} to settings
 }
 @Scheduled(fixedDelayString="\${medol.scheduling.reconcile-delay-ms:1000}")
 fun reconcile() {
  if(!properties.enabled) return
  try { repeat(20) {
   val found=tx {
    val row=em.createQuery("select s from ScheduleSyncRow s where s.retryAt<=:now order by s.retryAt",ScheduleSyncRow::class.java).setParameter("now",Instant.now()).setMaxResults(1).setLockMode(LockModeType.PESSIMISTIC_WRITE).resultList.firstOrNull() ?: return@tx false
    try {
     val s=mapper.readValue(row.snapshotJson,ScheduleSnapshot::class.java)
     val desired=if(s.state=="Active" && s.nextAt!=null) scheduleOccurrence(s.scheduleId,s.planVersion,s.nextAt!!) else null
     val current=gateway.send(CheckScheduledOccurrence(s.scheduleId,s.planVersion,s.nextAt,s.providerKey,s.state)).resultMessage.join().payload() as Boolean
     val obsolete=em.createQuery("select r from ScheduleRegistrationRow r where r.scheduleId=:id and r.cancelled=false",ScheduleRegistrationRow::class.java).setParameter("id",s.scheduleId).resultList.filter {!current || it.id!=desired}
     for(registration in obsolete) {
      val (adapter,config)=provider(registration.providerKey);adapter.cancel(config,registration.id)
      registration.cancelled=true
     }
     if(!current) {
      row.registeredId=null;row.registeredProvider=null;row.pending=true;row.syncState="AwaitingProjection";row.errorType=null;row.retryAt=Instant.now().plusSeconds(5)
      return@tx true
     }
     if(row.registeredId!=desired) {row.registeredId=null;row.registeredProvider=null}
     if(desired!=null) {
       val (adapter,config)=provider(s.providerKey)
       row.registeredId=desired;row.registeredProvider=s.providerKey
       adapter.ensure(config,desired,Instant.parse(s.nextAt),ScheduledDelivery(s.scheduleId,s.planVersion,s.providerKey,s.nextAt!!))
     }
     row.pending=false;row.syncState="Synchronized";row.errorType=null;row.attempts=0;row.retryAt=Instant.now().plusSeconds(if(desired==null) 3600 else 30)
    } catch(e: Exception) {row.attempts++;row.syncState="Failed";row.errorType=e.javaClass.simpleName;row.retryAt=Instant.now().plusSeconds(minOf(300,5L*row.attempts));log.warn("Schedule synchronization failed: schedule={} errorType={}",row.id,row.errorType)}
    true
   }
   if(found!=true) return
  } } catch(e: Exception) {log.error("Scheduling reconciliation transaction failed: {}",e.javaClass.simpleName)}
 }
 @Scheduled(fixedDelayString="\${medol.scheduling.delivery-delay-ms:1000}")
 fun deliver() {
  if(!properties.enabled) return
  try {repeat(20) {
   val found=tx {
    val row=em.createQuery("select d from ScheduleDeliveryRow d where d.deliveryState='Pending' and d.retryAt<=:now order by d.retryAt",ScheduleDeliveryRow::class.java).setParameter("now",Instant.now()).setMaxResults(1).setLockMode(LockModeType.PESSIMISTIC_WRITE).resultList.firstOrNull() ?: return@tx false
    try {targets.dispatch(mapper.readValue(row.payloadJson,ScheduledTargetCall::class.java));row.deliveryState="Dispatched";row.errorType=null}
    catch(e: Exception) {row.attempts++;row.errorType=e.javaClass.simpleName;row.retryAt=Instant.now().plusSeconds(minOf(300,5L*row.attempts));log.warn("Scheduled delivery failed: occurrence={} errorType={}",row.id,row.errorType)}
    true
   }
   if(found!=true) return
  }} catch(e: Exception) {log.error("Scheduling delivery transaction failed: {}",e.javaClass.simpleName)}
 }
}
