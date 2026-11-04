const {_commandTitle, _eventTitle} = require('../../common/util/naming');
const {pascal, escapeKotlin} = require('./model-helpers');
const CONFIG = ['ruleCode','numberNamespace','prefix','suffix','dateFormat','timeZone','resetPeriod','allocationScope','sequenceWidth','startAt'];
const ACTIONS = {DefineNumberingRule:'define', ReviseNumberingRule:'revise', ActivateNumberingRule:'activate', SuspendNumberingRule:'suspend', ResumeNumberingRule:'resume', RetireNumberingRule:'retire'};
function localNumbering(g) { return !!g.model.numbering && g.model.slices.some(s => s.context === g.model.numbering.context); }
function writeNumberingApi(g) {
    const target = g._sharedKernelKotlinPath('shared/application/numbering/NumberingApi.kt');
    if (!g.model.numbering) { g.fs.delete(target); return; }
    g.fs.copyTpl(g.templatePath('numbering/NumberingApi.kt.tpl'), target, {rootPackage:g.model.rootPackage});
}
function writeNumberingRuntime(g) {
    const client = g._rootKotlinPath('shared/application/numbering/NumberingClient.kt');
    if (!g.model.numbering) g.fs.delete(client);
    else g.fs.copyTpl(g.templatePath('numbering/NumberingClient.kt.tpl'), client, {rootPackage:g.model.rootPackage});
    // Older versions emitted unused decision extension stubs for the builtin service.
    // Remove only byte-equivalent empty generated stubs, never handwritten overrides.
    for (const command of Object.keys(ACTIONS)) {
        const slicePackage = command.toLowerCase();
        const target = g._rootKotlinPath(`domain/numbering/${slicePackage}/${command}DecisionComponent.kt`);
        const expected = `package ${g.model.rootPackage}.domain.numbering.${slicePackage}
import org.springframework.stereotype.Component
import ${g.model.rootPackage}.numbering.${slicePackage}.${command}Decision
@Component
class ${command}DecisionComponent : ${command}Decision`;
        if (g.fs.exists?.(target) && g.fs.read(target).replace(/\s+/g, '') === expected.replace(/\s+/g, '')) g.fs.delete(target);
    }
    const local = localNumbering(g);
    const slices = g.model.slices.filter(s => s.context === g.model.numbering?.context);
    const ruleEvents = slices.flatMap(s => (s.commands ?? []).filter(c => ACTIONS[c.name]).map(c => {
        const event = s.events[0];
        return `            "${ACTIONS[c.name]}" -> ${g.model.rootPackage}.numbering.events.${_eventTitle(event.title ?? event.name)}(snapshot.ruleId, ${CONFIG.map(f => `c.${f}`).join(', ')}, snapshot.ruleVersion, snapshot.state)`;
    })).join('\n');
    const eventTypes = slices.flatMap(s => s.events ?? []).map(e => `                        "${_eventTitle(e.title ?? e.name)}" -> ${g.model.rootPackage}.numbering.events.${_eventTitle(e.title ?? e.name)}::class.java`).join('\n');
    for (const file of ['NumberingEntities','NumberingService','NumberingEndpoints','NumberingOutboxPublisher']) {
        const target = g._rootKotlinPath(`numbering/infrastructure/${file}.kt`);
        if (!local) { g.fs.delete(target); continue; }
        g.fs.copyTpl(g.templatePath(`numbering/${file}.kt.tpl`), target, {rootPackage:g.model.rootPackage,tenancy:!!g.model.tenancy,ruleEvents,eventTypes});
    }
    if (local) writeMigration(g);
    else if (!g.model.slices.some(s => s.context === 'Numbering')) {
        // Only the overwriteable builtin context is removed; preserve migrations and authoritative data.
        const marker = g._kotlinPath?.('numbering/definenumberingrule/DefineNumberingRuleCommandHandler.kt');
        if (marker && g.fs.exists?.(marker) && g.fs.read(marker).includes(`${g.model.rootPackage}.numbering.infrastructure.NumberingService`)) {
            g.fs.delete(g._kotlinPath('numbering'));
            if (g._testKotlinPath) g.fs.delete(g._testKotlinPath('numbering'));
        }
    }
}
function writeManagementHandler(g, packageName, context, slicePackage, slice) {
    if (!g.model.numbering || slice.context !== g.model.numbering.context) return false;
    const handlers = slice.commands.map(c => {
        const action = ACTIONS[c.name];
        if (!action) throw new Error(`Unknown builtin numbering operation ${c.name}`);
        const configuration = `${g.model.rootPackage}.numbering.infrastructure.NumberingConfiguration(${CONFIG.map(f => `command.${f}${['prefix','suffix','dateFormat'].includes(f) ? '.orEmpty()' : ''}`).join(', ')})`;
        const call = action === 'define' ? `service.define(command.ruleId, ${configuration})`
            : `service.change(command.ruleId, command.expectedVersion, "${action}"${action === 'revise' ? `, ${configuration}` : ''})`;
        return `    @org.axonframework.messaging.commandhandling.annotation.CommandHandler\n    fun handle(command: ${_commandTitle(c.title)}) { ${call} }`;
    }).join('\n');
    g.fs.write(g._kotlinPath(`${context}/${slicePackage}/${pascal(slice.name)}CommandHandler.kt`), `package ${packageName}\n\n@org.springframework.stereotype.Component\nclass ${pascal(slice.name)}CommandHandler(private val service: ${g.model.rootPackage}.numbering.infrastructure.NumberingService) {\n${handlers}\n}\n`);
    return true;
}
function numberAssignments(g, slice, command) {
    const fields = (command.fields ?? []).filter(f => f.numbering);
    if (!fields.length) return '';
    if (!g.model.numbering) throw new Error('Numbered command requires the numbering capability contract');
    const ids = command.fields.filter(f => f.idAttribute);
    if (!ids.length) throw new Error('Numbered command requires object identifiers');
    const owner = `listOf(${ids.map(f => `command.${f.name}.toString()`).join(', ')}).joinToString("") { value -> "\${value.length}:$value" }`;
    const tenant = g.model.tenancy ? `${g.model.rootPackage}.shared.application.tenancy.TenantScope.current()?.tenantId` : 'null';
    const assignments = fields.map(f => `${f.name} = numbering.allocate(${g.model.rootPackage}.shared.application.numbering.NumberAllocationRequest("${escapeKotlin(f.numbering.rule)}", numbering.requestKey("${escapeKotlin(slice.context + '.' + command.name + '.' + f.name)}", ${owner}), ${owner}, tenantId = ${tenant})).codes.single()`);
    return `        val command = command.copy(\n            ${assignments.join(',\n            ')}\n        )\n`;
}
function writeMigration(g) {
    // Unqualified tables are created in the application's configured control/default schema.
    g.fs.copyTpl(g.templatePath('numbering/V2026110401__numbering.sql'), g._destPath('src/main/resources/db/migration/V2026110401__numbering.sql'), {});
}
module.exports = {writeNumberingApi,writeNumberingRuntime,writeManagementHandler,numberAssignments,localNumbering};
