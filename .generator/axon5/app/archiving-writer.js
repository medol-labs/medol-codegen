const {pascal, stateTargetFor} = require('./model-helpers');
const {_commandTitle, _eventTitle} = require('../../common/util/naming');
const localArchiving = g => !!g.model.archiving && g.model.slices.some(s => s.context === g.model.archiving.context);

function writeHandler(g, packageName, context, slicePackage, slice) {
    if (!g.model.archiving || slice.context !== g.model.archiving.context) return false;
    const command = slice.commands[0], event = slice.events[0];
    const batch = command.name === 'RequestArchiveBatch';
    if (!batch && command.name !== 'RequestArchiveRestore') throw new Error(`Unsupported archiving command: ${command.name}`);
    const state = stateTargetFor(g.model, slice);
    const id = batch ? 'batchId' : 'restoreId';
    const comparable = command.fields.filter(f => f.name !== id).map(f => `state.${f.name} == command.${f.name}`).join(' && ');
    const validate = batch ? 'service.validateBatch(command.targetKey, command.cutoffAt.toInstant(java.time.ZoneOffset.UTC), command.batchSize)' : 'service.validateRestore(command.archiveId)';
    const eventArgs = event.fields.map(f => `${f.name} = ${f.name === 'state' ? '"Requested"' : `command.${f.name}`}`).join(', ');
    g.fs.write(g._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `// Generated MEDOL archiving command handler.
package ${packageName}
import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.modelling.annotation.InjectEntity
import org.axonframework.messaging.eventhandling.gateway.EventAppender
import ${state.packageName}.${state.name}
import ${g.model.rootPackage}.archiving.infrastructure.ArchivingService
import ${g.model.rootPackage}.archiving.events.${_eventTitle(event.title)}
import ${g.model.rootPackage}.shared.domain.CommandRejectedException
@org.springframework.stereotype.Component
class ${pascal(slice.name)}CommandHandler(private val service: ArchivingService) {
 @CommandHandler
 fun handle(command: ${_commandTitle(command.title)}, @InjectEntity(idProperty="${id}") state: ${state.name}, appender: EventAppender) {
  if (state.${id} != null) {
   if (${comparable}) return
   throw CommandRejectedException("ARCHIVE_REQUEST_CONFLICT", "errors.archiving.conflict", message="Request identifier has already been used with different arguments.")
  }
  try { ${validate} } catch (error: IllegalArgumentException) {
   throw CommandRejectedException("ARCHIVE_REQUEST_REJECTED", "errors.archiving.rejected", message=error.message ?: "Archive request rejected.")
  }
  appender.append(listOf(${_eventTitle(event.title)}(${eventArgs})))
 }
}
`);
    return true;
}

function writeRuntime(g) {
    const local = localArchiving(g);
    const marker = g._rootKotlinPath('archiving/infrastructure/ArchivingApi.kt');
    if (!local) {
        if (g.fs.exists?.(marker) && g.fs.read(marker).startsWith('// Generated MEDOL archiving')) {
            for (const file of ['ArchivingApi','ArchivingRuntime','ArchivingIntegration','ArchivingEndpoints','ArchivingOutboxPublisher']) g.fs.delete(g._rootKotlinPath(`archiving/infrastructure/${file}.kt`));
            const handler = g._kotlinPath('archiving/requestarchivebatch/RequestArchiveBatchCommandHandler.kt');
            if(g.fs.exists?.(handler) && g.fs.read(handler).startsWith('// Generated MEDOL archiving')) {
                g.fs.delete(g._kotlinPath('archiving'));
                g.fs.delete(g._testKotlinPath('archiving'));
            }
        }
        return;
    }
    if(g.model.tenancy) throw new Error('Archiving currently requires a non-tenant deployment. Tenant-aware object identity and archive access must be implemented before enabling it in a tenant model.');
    const projectionBindings = g.model.slices.filter(s => s.context !== g.model.archiving.context).flatMap(s =>
        (s.readmodels ?? []).filter(r => !r.sync && !r.syncSource && r.name !== 'SystemNotificationSummary'
            && !(g.model.operationAudit?.context === s.context && g.model.operationAudit.readModel === r.name)
            && (r.dependencies ?? []).some(d => d.direction === 'INBOUND' && d.elementType === 'EVENT'))
            .map(r => [s.context,r.name]));
    for (const file of ['ArchivingApi','ArchivingRuntime','ArchivingIntegration','ArchivingEndpoints','ArchivingOutboxPublisher']) {
        g.fs.copyTpl(g.templatePath(`archiving/${file}.kt.tpl`), g._rootKotlinPath(`archiving/infrastructure/${file}.kt`), {rootPackage:g.model.rootPackage,tenancy:false,projectionBindings});
    }
    g.fs.copyTpl(g.templatePath('archiving/V2026110802__archiving.sql'), g._destPath('src/main/resources/db/migration/V2026110802__archiving.sql'), {});
    for(const file of ['README.md','application-archiving.yml','archive-store.sql']) g.fs.copy(g.templatePath(`archiving/${file}`),g._destPath(`archiving/${file}`));
}
module.exports = {writeRuntime, writeHandler, localArchiving};
