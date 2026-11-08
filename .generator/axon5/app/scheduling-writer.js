const {pascal, stateTargetFor} = require('./model-helpers');
const {contextPackage} = require('../../common/util/value-types');
const {_commandTitle, _eventTitle} = require('../../common/util/naming');
const {tenantScoped} = require('./tenant-support');
const CONFIG = ['planName','providerKey','targetKey','argumentsJson','scheduleKind','scheduleExpression','timeZone','misfirePolicy'];
const ACTIONS = {DefineSchedule:'define',ReviseSchedule:'revise',ActivateSchedule:'activate',PauseSchedule:'pause',ResumeSchedule:'resume',RetireSchedule:'retire',AcceptScheduledOccurrence:'accept'};
const localScheduling = g => !!g.model.scheduling && g.model.slices.some(s=>s.context===g.model.scheduling.context);
function writeHandler(g, packageName, context, slicePackage, slice) {
 if (!g.model.scheduling || slice.context!==g.model.scheduling.context) return false;
 const c=slice.commands[0], action=ACTIONS[c.name];
 if (!action) throw new Error(`Unknown scheduling operation ${c.name}`);
 const e=slice.events[0];
 const config=['define','revise'].includes(action) ? `ScheduleConfiguration(${CONFIG.map(f=>`command.${f}`).join(', ')})` : 'null';
 const extra=action==='accept' ? ', command.providerKey, command.scheduledAt' : '';
 const state=stateTargetFor(g.model,slice);
 g.fs.write(g._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`),`package ${packageName}
import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.modelling.annotation.InjectEntity
import org.axonframework.messaging.eventhandling.gateway.EventAppender
import ${state.packageName}.${state.name}
import ${g.model.rootPackage}.scheduling.infrastructure.*
import ${g.model.rootPackage}.scheduling.events.${_eventTitle(e.title)}
@org.springframework.stereotype.Component
class ${pascal(slice.name)}CommandHandler(private val logic: SchedulingLogic) {
 @CommandHandler
 fun handle(command: ${_commandTitle(c.title)}, @InjectEntity(idProperty = "scheduleId") state: ${state.name}, appender: EventAppender) {
  val s = logic.decide("${action}", command.scheduleId, ${action==='define' ? 'null' : 'command.expectedVersion'}, state, ${config}${extra}) ?: return
  appender.append(listOf(${_eventTitle(e.title)}(${e.fields.map(f=>`${f.name} = ${CONFIG.includes(f.name)?'s.configuration':'s'}.${f.name}${['occurrenceId','scheduledAt','dispatch'].includes(f.name)?'!!':''}`).join(', ')})))
 }
}
`);
 return true;
}
function writeRuntime(g) {
 const enabled=!!g.model.scheduling,local=localScheduling(g);
 if (!enabled) {
  const marker=g._rootKotlinPath('scheduling/infrastructure/SchedulingApi.kt');
  if(g.fs.exists?.(marker) && g.fs.read(marker).startsWith('// Generated MEDOL scheduling contract.')) {
   g.fs.delete(g._rootKotlinPath('scheduling/infrastructure'));
   const handler=g._kotlinPath('scheduling/defineschedule/DefineScheduleCommandHandler.kt');
   if(g.fs.exists?.(handler) && g.fs.read(handler).includes('SchedulingLogic')) {g.fs.delete(g._kotlinPath('scheduling'));g.fs.delete(g._testKotlinPath('scheduling'));}
  }
  return;
 }
 const targets=(g.model.scheduling?.targets??[]).map(t=>{
  const full=g.fullModel??g.model;
  const s=full.slices.find(s=>s.context===t.context&&s.commands.some(c=>c.name===t.command));
  if(!s) throw new Error(`Scheduling target missing: ${t.key}`);
  if(tenantScoped(full,t.context)) throw new Error(`Scheduling target ${t.key} is tenant-scoped; configure a control-plane command that explicitly authorizes its tenant before scheduling.`);
  const c=s.commands.find(c=>c.name===t.command);
  const local=g.model.slices.some(x=>x.id===s.id);
  return {...t,local,qualified:`${g.model.rootPackage}.${contextPackage(t.context)}.${s.name.toLowerCase()}.${_commandTitle(c.title)}`,fields:c.fields.filter(f=>!f.generated).map(f=>f.name),required:c.fields.filter(f=>!f.generated&&!f.optional).map(f=>f.name),reserved:c.fields.filter(f=>f.generated).map(f=>f.name)};
 });
 const handlers=local?g.model.slices.filter(s=>s.context===g.model.scheduling.context).flatMap(s=>(s.events??[]).map(e=>` @EventHandler\n fun on(event: ${g.model.rootPackage}.scheduling.events.${_eventTitle(e.title)}) = store.record(mapper.convertValue(event, ScheduleSnapshot::class.java))`)).join('\n'):'';
 if (!local) for (const file of ['SchedulingLogic','SchedulingStore','SchedulingEndpoints','SnailJobProvider']) g.fs.delete(g._rootKotlinPath(`scheduling/infrastructure/${file}.kt`));
 for(const file of ['SchedulingApi','SchedulingTargets',...(local?['SchedulingLogic','SchedulingStore','SchedulingEndpoints','SnailJobProvider']:[])]) {
  g.fs.copyTpl(g.templatePath(`scheduling/${file}.kt.tpl`),g._rootKotlinPath(`scheduling/infrastructure/${file}.kt`),{rootPackage:g.model.rootPackage,tenancy:!!g.model.tenancy,targets,handlers,local});
 }
 if(local) {
  for (const migration of ['V2026110701__scheduling.sql','V2026110801__schedule_delivery_time.sql']) g.fs.copyTpl(g.templatePath(`scheduling/${migration}`),g._destPath(`src/main/resources/db/migration/${migration}`),{});
  for(const file of ['application-scheduling.yml','README.md','worker/pom.xml','worker/Dockerfile','worker/src/main/java/medol/scheduling/Worker.java','worker/src/main/resources/application.yml']) g.fs.copy(g.templatePath(`scheduling/${file}`),g._destPath(`scheduling/${file}`));
 }
}
// Old events predate lastScheduledAt. Preserve consumption across pause/resume when replaying them.
function stateAssignment(g, slice, event, field) {
 if (g.model.scheduling?.context !== slice.context || field.name !== 'lastScheduledAt') return undefined;
 const fallback = event.name === 'ScheduledOccurrenceAccepted' ? ' ?: event.scheduledAt'
  : ['ScheduleDefined','ScheduleRevised'].includes(event.name) ? '' : ' ?: lastScheduledAt';
 return `        lastScheduledAt = event.lastScheduledAt${fallback}`;
}
module.exports={writeRuntime,writeHandler,localScheduling,stateAssignment};
