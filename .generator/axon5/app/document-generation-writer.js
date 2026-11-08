const {pascal}=require('./model-helpers');
const {_commandTitle,_eventTitle}=require('../../common/util/naming');
const localDocuments=g=>!!g.model.documentGeneration && g.model.slices.some(s=>s.context===g.model.documentGeneration.context);
function writeHandler(g,packageName,context,slicePackage,slice) {
 if(g.model.documentGeneration?.context!==slice.context) return false;
 const c=slice.commands[0];
 const calls={
  CreateDocumentTemplateVersion:'service.create(TemplateDefinition(command.templateVersionId,command.templateKey,command.versionLabel,command.providerKey,command.contractVersion,command.rendererKey,command.templateContent),actor)',
  ReviseDocumentTemplateVersion:'service.revise(command.templateVersionId,command.expectedRevision,command.templateContent,actor)',
  PublishDocumentTemplateVersion:'service.transition(command.templateVersionId,command.expectedRevision,true,actor)',
  RetireDocumentTemplateVersion:'service.transition(command.templateVersionId,command.expectedRevision,false,actor)',
  RequestDocumentGeneration:'service.request(command.documentId,command.templateVersionId,DocumentInput(command.objectRef,command.locale,command.timeZone),actor)',
  RetryDocumentGeneration:'service.retry(command.documentId,command.expectedRevision,actor)'
 };
 if(!calls[c.name]) throw new Error(`Unsupported document operation ${c.name}`);
 g.fs.write(g._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`),`// Generated MEDOL document-generation handler.
package ${packageName}
import org.axonframework.messaging.commandhandling.annotation.CommandHandler
import org.axonframework.messaging.commandhandling.CommandMessage
import ${g.model.rootPackage}.documentgeneration.infrastructure.*
import ${g.model.rootPackage}.shared.domain.CommandRejectedException
@org.springframework.stereotype.Component
class ${pascal(slice.name)}CommandHandler(private val service:DocumentService) {
 @CommandHandler
 fun handle(command:${_commandTitle(c.title)},message:CommandMessage) {
  val actor=message.metadata()["userId"].orEmpty()
  try {${calls[c.name]}}
  catch(error:IllegalArgumentException) {throw CommandRejectedException("DOCUMENT_REJECTED","errors.documents.rejected",message=error.message ?: "Document operation rejected")}
 }
}
`);
 return true;
}
function writeRuntime(g) {
 const owned=g._rootKotlinPath('documentgeneration/infrastructure/DocumentsApi.kt');
 if(!localDocuments(g)) {
  if(g.fs.exists?.(owned) && g.fs.read(owned).startsWith('// Generated MEDOL document-generation')) {
   for(const f of ['DocumentsApi','DocumentValidation','DocumentService','DocumentArtifacts','PdfDocumentRenderer','DocumentEndpoints','DocumentOutboxPublisher']) g.fs.delete(g._rootKotlinPath(`documentgeneration/infrastructure/${f}.kt`));
   const handler=g._kotlinPath('documentgeneration/requestdocumentgeneration/RequestDocumentGenerationCommandHandler.kt');
   if(g.fs.exists?.(handler) && g.fs.read(handler).startsWith('// Generated MEDOL document-generation')) {g.fs.delete(g._kotlinPath('documentgeneration'));g.fs.delete(g._testKotlinPath('documentgeneration'));}
  }
  return;
 }
 if(g.model.tenancy) throw new Error('Document generation requires a non-tenant deployment until tenant-scoped snapshots and download authorization are supported.');
 const eventTypes=g.model.slices.filter(s=>s.context===g.model.documentGeneration.context).flatMap(s=>s.events??[]).map(e=>`     "${e.name}" -> ${g.model.rootPackage}.documentgeneration.events.${_eventTitle(e.title)}::class.java`).join('\n');
 for(const f of ['DocumentsApi','DocumentValidation','DocumentService','DocumentArtifacts','PdfDocumentRenderer','DocumentEndpoints','DocumentOutboxPublisher']) g.fs.copyTpl(g.templatePath(`document-generation/${f}.kt.tpl`),g._rootKotlinPath(`documentgeneration/infrastructure/${f}.kt`),{rootPackage:g.model.rootPackage,eventTypes});
 g.fs.copy(g.templatePath('document-generation/V2026110803__document_generation.sql'),g._destPath('src/main/resources/db/migration/V2026110803__document_generation.sql'));
 for(const f of ['README.md','application-documents.yml','example-template.json']) g.fs.copy(g.templatePath(`document-generation/${f}`),g._destPath(`document-generation/${f}`));
}
module.exports={localDocuments,writeRuntime,writeHandler};
