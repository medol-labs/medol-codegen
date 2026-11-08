const {pascal}=require('./model-helpers');
const {_commandTitle,_eventTitle}=require('../../common/util/naming');
const kinds=['organizationManagement','systemConfiguration','businessCalendar','reporting'];
const owns=(g,key)=>!!g.model[key] && g.model.slices.some(s=>s.context===g.model[key].context);
const isManagement=(model,context)=>kinds.some(key=>model[key]?.context===context);
function writeHandler(g,packageName,context,slicePackage,slice) {
 if(!isManagement(g.model,slice.context)) return false;
 const service=g.model.reporting?.context===slice.context?'ReportingService':g.model.organizationManagement?.context===slice.context?'OrganizationService':g.model.businessCalendar?.context===slice.context?'BusinessCalendarService':'SystemConfigurationService';
 const handlers=(slice.commands??[]).map(c=>` @CommandHandler
 fun handle(command:${_commandTitle(c.title)},message:CommandMessage) {
  try {service.execute("${c.name}",mapper.valueToTree(command),message.metadata()["userId"].orEmpty())}
  catch(error:IllegalArgumentException) {throw CommandRejectedException("MANAGEMENT_REJECTED","errors.management.rejected",message=error.message ?: "Management operation rejected")}
 }`).join('\n');
 g.fs.write(g._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`),`// Generated MEDOL management handler.
package ${packageName}
import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.commandhandling.CommandMessage
import com.fasterxml.jackson.databind.ObjectMapper
import ${g.model.rootPackage}.management.infrastructure.${service}
import ${g.model.rootPackage}.shared.domain.CommandRejectedException
@org.springframework.stereotype.Component
class ${pascal(slice.name)}CommandHandler(private val service:${service},private val mapper:ObjectMapper) {
${handlers}
}
`);return true;
}
function writeRuntime(g) {
 const organization=owns(g,'organizationManagement'),configuration=owns(g,'systemConfiguration'),calendar=owns(g,'businessCalendar'),reporting=owns(g,'reporting');
 if(reporting && g.model.tenancy) throw new Error('Reporting does not support tenancy yet.');
 if(calendar && g.model.tenancy) throw new Error('Business calendar does not support tenancy yet.');
 if(organization && g.model.tenancy) throw new Error('Organization management does not support tenancy yet.');
 const files=['ManagementStore','ManagementOutboxPublisher',...(reporting?['ReportingApi','ReportingService','ReportingWorker','ReportingEndpoints']:[]),...(organization?['OrganizationService','OrganizationEndpoints']:[]),...(calendar?['BusinessCalendarApi','BusinessCalendarService','BusinessCalendarEndpoints']:[]),...(configuration?['ConfigurationApi','SystemConfigurationService','ConfigurationEndpoints']:[])];
 const all=['ReportingApi','ReportingService','ReportingWorker','ReportingEndpoints','BusinessCalendarApi','BusinessCalendarService','BusinessCalendarEndpoints','ManagementStore','ManagementOutboxPublisher','OrganizationService','OrganizationEndpoints','ConfigurationApi','SystemConfigurationService','ConfigurationEndpoints'];
 const marker=g._rootKotlinPath('management/infrastructure/ManagementStore.kt');
 if(g.fs.exists?.(marker) && g.fs.read(marker).startsWith('// Generated MEDOL management runtime.')) {
  for(const file of all) if(!(organization||configuration||calendar||reporting) || !files.includes(file)) g.fs.delete(g._rootKotlinPath(`management/infrastructure/${file}.kt`));
 }
 for (const [enabled,context,command] of [[organization,'organizationmanagement','CreateOrganizationUnit'],[configuration,'systemconfiguration','CreateConfigurationSet'],[calendar,'businesscalendar','DefineBusinessCalendar'],[reporting,'reporting','CreateReportDefinition']]) {
  const handler=g._kotlinPath(`${context}/${command.toLowerCase()}/${command}CommandHandler.kt`);
  if(!enabled && !g.model.slices.some(s=>s.context.toLowerCase()===context) && g.fs.exists?.(handler) && g.fs.read(handler).startsWith('// Generated MEDOL management handler.')) {
   g.fs.delete(g._kotlinPath(context));g.fs.delete(g._testKotlinPath(context));
  }
 }
 if(!organization&&!configuration&&!calendar&&!reporting) return;
 const slices=g.model.slices.filter(s=>isManagement(g.model,s.context));
 const eventTypes=slices.flatMap(s=>(s.events??[]).map(e=>`     "${e.name}" -> ${g.model.rootPackage}.${s.context.toLowerCase()}.events.${_eventTitle(e.title)}::class.java`)).join('\n');
 const organizationOperations=slices.filter(s=>s.context===g.model.organizationManagement?.context && s.events?.length && s.commands?.length).map(s=> {
  const id=s.events[0].fields.find(f=>f.idAttribute)?.name;
  const kind={organizationId:'OrganizationUnit',positionId:'PositionDefinition',organizationPositionId:'OrganizationPosition',memberId:'OrganizationMember',assignmentId:'PositionAssignment'}[id];
  if(!kind) throw new Error(`Unknown organization entity ${id}`);
  return `  "${s.commands[0].name}" to ("${kind}" to "${s.events[0].name}")`;
 }).join(',\n');
 for(const file of files) g.fs.copyTpl(g.templatePath(`management/${file}.kt.tpl`),g._rootKotlinPath(`management/infrastructure/${file}.kt`),{rootPackage:g.model.rootPackage,tenancy:!!g.model.tenancy,eventTypes,organizationOperations,capabilities:[...(organization?['organization']:[]),...(configuration?['configuration']:[]),...(calendar?['calendar']:[]),...(reporting?['reporting']:[])]});
 g.fs.copy(g.templatePath('management/V2026110804__management.sql'),g._destPath('src/main/resources/db/migration/V2026110804__management.sql'));
 if(reporting) {
  g.fs.copy(g.templatePath('management/V2026110806__reporting.sql'),g._destPath('src/main/resources/db/migration/V2026110806__reporting.sql'));
  g.fs.copy(g.templatePath('management/reporting.md'),g._destPath('reporting/README.md'));
 }
 if(calendar) {
  g.fs.copy(g.templatePath('management/V2026110805__business_calendar.sql'),g._destPath('src/main/resources/db/migration/V2026110805__business_calendar.sql'));
  g.fs.copy(g.templatePath('management/business-calendar.md'),g._destPath('business-calendar/README.md'));
 }
 g.fs.copy(g.templatePath('management/README.md'),g._destPath('management/README.md'));
}
module.exports={writeHandler,writeRuntime,isManagement,owns};
