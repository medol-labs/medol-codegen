/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {
    commandFieldsWithSelection,
    fallbackValue,
    kotlinFieldImports,
    outboundEvents,
    pascal,
    kebab,
    safeIdentifier,
    uniqueBy,
    constant,
    valueTypeForField,
    stateTargetFor,
    relatedStateForCommand,
    commandStartsLifecycle,
    selectionFor,
    eventFieldsWithTags,
    eventTagFieldsFor,
    primaryConcept,
    relatedEventsForSlice
} = require('./model-helpers');
const {infrastructurePortForCommand, resultFieldsForEvent} = require('./infrastructure-port-writer');
const {_commandTitle, _eventTitle} = require('../../common/util/naming');

function testMethodName(value) {
    return safeIdentifier(String(value ?? 'command').replace(/[^A-Za-z0-9]+/g, ' '));
}

function importLines(values) {
    return uniqueBy(values.flatMap((value) => String(value ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(normalizeImportLine)), normalizeImportKey);
}

function normalizeImportLine(line) {
    const importLine = line.startsWith('import ') ? line : `import ${line}`;
    return importLine.replace(/;$/, '');
}

function normalizeImportKey(line) {
    return normalizeImportLine(String(line ?? '').trim());
}

function allCommands(model) {
    return (model.slices ?? []).flatMap((slice) => slice.commands ?? []);
}

function allEvents(model) {
    return (model.slices ?? []).flatMap((slice) => (slice.events ?? []).map((event) => ({...event, slice})));
}

function elementById(values, id, title) {
    return values.find((value) => value.id === id)
        ?? values.find((value) => value.title === title || value.name === title);
}

function specFields(specElement) {
    return new Map((specElement?.fields ?? []).map((field) => [field.name, field]));
}

function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function enrichFields(fields, specElement) {
    const examples = specFields(specElement);
    return (fields ?? []).map((field) => ({...field, example: examples.get(field.name)?.example}));
}

function commandForSpec(model, specElement) {
    const command = elementById(allCommands(model), specElement?.id, specElement?.title);
    return command ? {...command, specElement} : undefined;
}

function eventForSpec(model, specElement) {
    const event = elementById(allEvents(model), specElement?.id, specElement?.title);
    return event ? {...event, specElement} : undefined;
}

function literalFromExample(field, example) {
    if (example === undefined || example === null || example === '') return undefined;
    const value = String(example);
    switch (String(field.type ?? '').toLowerCase()) {
        case 'uuid':
            return value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
                ? `UUID.fromString("${value}")`
                : `UUID.nameUUIDFromBytes("${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}".toByteArray())`;
        case 'string':
            return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        case 'boolean':
            return value.toLowerCase() === 'true' ? 'true' : 'false';
        case 'int':
        case 'integer':
            return `${Number.parseInt(value, 10) || 0}`;
        case 'long':
            return `${Number.parseInt(value, 10) || 0}L`;
        case 'double':
        case 'float':
            return `${Number.parseFloat(value) || 0.0}`;
        case 'decimal':
        case 'bigdecimal':
            return `BigDecimal("${value}")`;
        case 'date':
            return `java.time.LocalDate.parse("${value}")`;
        case 'datetime':
            return `java.time.LocalDateTime.parse("${value}")`;
        default:
            return undefined;
    }
}

function testValue(field) {
    if (field.cardinality === 'Multiple') return 'emptyList()';
    if (field.example !== undefined && field.example !== '') {
        const literal = literalFromExample(field, field.example);
        if (literal) return literal;
    }
    const stateMatch = String(field.type ?? '').match(/^(.+)\.State$/);
    if (stateMatch && field.example !== undefined && field.example !== '') {
        return `${pascal(stateMatch[1])}StateEnum.${constant(field.example)}`;
    }
    if (field.optional) return 'null';
    const valueType = valueTypeForField(field);
    if (valueType?.kind === 'enum' && (valueType.values ?? []).length > 0) {
        return `${valueType.name}.${constant(valueType.values[0])}`;
    }
    if (valueType?.kind === 'scalar') {
        return `${valueType.name}(${fallbackValue({...field, type: valueType.baseType, valueType: undefined})})`;
    }
    if (valueType?.kind === 'object') {
        const args = (valueType.fields ?? [])
            .map((nested) => `${nested.name} = ${testValue(nested)}`)
            .join(', ');
        return `${valueType.name}(${args})`;
    }
    return fallbackValue(field);
}

function commandArguments(command, selection) {
    const fields = enrichFields(commandFieldsWithSelection(command, selection), command.specElement);
    return fields
        .map((field) => `            ${field.name} = ${testValue(field)}`)
        .join(',\n');
}

function eventFieldsForGeneratedClass(event, model) {
    if (!event?.slice || !model) return event.fields ?? [];
    const selection = selectionFor(event.slice, model);
    return eventFieldsWithTags(event.fields ?? [], eventTagFieldsFor(event.slice, event, selection, true));
}

function eventArguments(event, model) {
    return enrichFields(eventFieldsForGeneratedClass(event, model), event.specElement)
        .map((field) => `            ${field.name} = ${testValue(field)}`)
        .join(',\n');
}

function normalizedValue(field, commandFields) {
    const source = commandFields.find((candidate) => candidate.name === field.tagName)
        ?? commandFields.find((candidate) => candidate.name === field.name.replace(/^normalized/, '').replace(/^./, (value) => value.toLowerCase()));
    if (!source) return testValue(field);
    const raw = testValue(source);
    const valueType = valueTypeForField(source);
    if (valueType?.kind === 'scalar') {
        const scalarValue = `${raw}.value`;
        return String(valueType.baseType ?? '').toLowerCase() === 'string'
            ? `${scalarValue}.trim().lowercase()`
            : `${scalarValue}.toString().trim().lowercase()`;
    }
    return String(source.type ?? '').toLowerCase() === 'string'
        ? `${raw}.trim().lowercase()`
        : `${raw}.toString().trim().lowercase()`;
}

function reservationEventArguments(reservation, command) {
    const commandFields = enrichFields(command.fields ?? [], command.specElement);
    return [
        ...reservation.idFields.map((field) => ({...field, example: commandFields.find((candidate) => candidate.name === field.name)?.example})),
        ...reservation.originalFields.map((field) => ({...field, example: commandFields.find((candidate) => candidate.name === field.name)?.example})),
        ...reservation.normalizedFields.map((field) => ({...field, value: normalizedValue(field, commandFields)}))
    ]
        .map((field) => `                ${field.name} = ${field.value ?? testValue(field)}`)
        .join(',\n');
}

function expectedFieldValue(field, event, command) {
    const eventField = specFields(event.specElement).get(field.name);
    if (eventField?.example !== undefined && eventField.example !== '') {
        return testValue({...field, example: eventField.example});
    }
    const commandField = enrichFields(command.fields ?? [], command.specElement).find((candidate) => candidate.name === field.name);
    return commandField ? `command.${field.name}` : undefined;
}

function assertionsForEvent(event, command) {
    return (event.fields ?? [])
        .map((field) => {
            const expected = expectedFieldValue(field, event, command);
            return expected ? `        assertEquals(${expected}, event.${field.name})` : undefined;
        })
        .filter(Boolean)
        .join('\n');
}

function specHasUniqueReservation(specification) {
    return [...(specification.validates ?? []), ...(specification.expressions ?? [])]
        .some((expression) => String(expression ?? '').trim().toLowerCase().startsWith('unique '));
}

function renderPortResult(port, expectedEvent, command, stateFields = []) {
    if (!port) return undefined;
    const outcome = expectedEvent.id === port.failureEvent?.id ? 'Rejected' : 'Succeeded';
    const sourceEvent = outcome === 'Rejected' ? port.failureEvent : port.successEvent;
    const args = uniqueBy([
        ...resultFieldsForEvent(sourceEvent, command, stateFields),
        ...(command?.resultFields ?? [])
    ], (field) => field.name)
        .map((field) => {
            const expected = expectedFieldValue(field, expectedEvent, command) ?? testValue(field);
            return `                ${field.name} = ${expected}`;
        })
        .join(',\n');
    return `${port.capability.resultName}.${outcome}(\n${args}\n            )`;
}

function renderDecideCall(decisionName, commandName, command, selection, args) {
    return `(object : ${decisionName} {}).decide(
            ${commandName}(
${commandArguments(command, selection)}
            )${args}
        )`;
}

function stateEventsForSlice(model, slice, events) {
    const concept = primaryConcept(slice);
    if (!concept) return events;
    return uniqueBy((model.slices ?? [])
        .filter((candidate) => candidate.context === slice.context && primaryConcept(candidate) === concept)
        .flatMap((candidate) => relatedEventsForSlice(model, candidate)), (event) => event.id ?? event.name);
}

const testWriterMethods = {
    _writeDecisionTest(packageName, context, slicePackage, slice, selection, events, reservations = []) {
        const stateTarget = stateTargetFor(this.model, slice);
        const stateName = stateTarget.name;
        const decisionName = `${pascal(slice.name)}Decision`;
        const testName = `${decisionName}Test`;
        const specificationTests = (slice.specifications ?? [])
            .map((specification) => this._decisionSpecificationTest(specification, packageName, slice, selection, events, reservations, decisionName, stateName))
            .filter(Boolean);
        const fallbackTests = specificationTests.length === 0
            ? this._fallbackDecisionTests(slice, selection, events, reservations, decisionName)
            : [];
        const tests = [...specificationTests, ...fallbackTests];
        if (tests.length === 0) return;

        const commandImports = uniqueBy(tests.map((test) => test.command).filter(Boolean)
            .map((command) => `import ${packageName}.${_commandTitle(command.title)}`), (value) => value);
        const eventImports = uniqueBy(tests.flatMap((test) => test.events ?? [])
            .map((event) => `import ${this._eventPackage(event, slice)}.${_eventTitle(event.title)}`), (value) => value);
        const reservationImports = uniqueBy(tests.flatMap((test) => test.reservations ?? [])
            .flatMap((reservation) => [
                `import ${reservation.packageName}.${reservation.stateName}`,
                `import ${this.model.rootPackage}.${context}.events.${reservation.eventName}`
            ]), (value) => value);
        const fieldImports = importLines([
            kotlinFieldImports(tests.flatMap((test) => test.fields ?? []), this.model.rootPackage)
        ]);
        const stateImport = uniqueBy(tests
            .map((test) => test.stateTarget)
            .filter((target) => target && target.packageName !== packageName)
            .map((target) => `import ${target.packageName}.${target.name}`), (value) => value);
        const portImports = uniqueBy(tests.map((test) => test.port)
            .filter(Boolean)
            .map((port) => `import ${port.packageName}.${port.capability.resultName}`), (value) => value);
        const assertionImports = uniqueBy([
            'import org.junit.jupiter.api.Assertions.assertEquals',
            'import org.junit.jupiter.api.Assertions.assertTrue',
            tests.some((test) => test.throws) ? 'import org.junit.jupiter.api.assertThrows' : undefined
        ].filter(Boolean), (value) => value);
        const timeImport = tests.some((test) => test.usesNow) ? ['import java.time.LocalDateTime'] : [];
        const imports = uniqueBy([
            ...assertionImports,
            'import org.junit.jupiter.api.Test',
            ...commandImports,
            ...eventImports,
            ...reservationImports,
            ...stateImport,
            ...portImports,
            ...fieldImports,
            ...timeImport
        ].filter(Boolean).map(normalizeImportLine), normalizeImportKey);

        this.fs.write(this._testKotlinPath(`${context}/${slicePackage}/${testName}.kt`), `package ${packageName}

${imports.join('\n')}

class ${testName} {
${tests.map((test) => test.body).join('\n\n')}
}
`);
    },

    _writeSliceIntegrationTest(packageName, context, slicePackage, slice, selection, events) {
        const tests = this._sliceIntegrationTests(slice, selection, events);
        if (tests.length === 0) return;

        const testName = `${pascal(slice.name)}IntegrationTest`;
        const commandImports = uniqueBy(tests.map((test) => test.command)
            .map((command) => `import ${packageName}.${_commandTitle(command.title)}`), (value) => value);
        const fieldImports = importLines([
            kotlinFieldImports(tests.flatMap((test) => test.fields ?? []), this.model.rootPackage)
        ]);

        this.fs.write(this._testKotlinPath(`${context}/${slicePackage}/${testName}.kt`), `package ${packageName}

import org.axonframework.messaging.commandhandling.gateway.CommandGateway
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
${commandImports.join('\n')}
${fieldImports.join('\n')}

@SpringBootTest(properties = [
    "spring.docker.compose.enabled=false",
    "spring.flyway.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:${kebab(testName)};DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "axon.axonserver.enabled=false",
    "axon.axonserver.event-store.enabled=false",
    "medol.axon.event-storage=inmemory"
])
class ${testName}(
    @Autowired private val commandGateway: CommandGateway
) {
${tests.map((test) => test.body).join('\n\n')}
}
`);
    },

    _sliceIntegrationTests(slice, selection, events) {
        const specificationTests = (slice.specifications ?? [])
            .map((specification) => this._sliceIntegrationSpecificationTest(specification, slice, selection, events))
            .filter(Boolean);
        if (specificationTests.length > 0) return specificationTests;
        return this._fallbackSliceIntegrationTests(slice, selection, events);
    },

    _sliceIntegrationSpecificationTest(specification, slice, selection, events) {
        const specCommand = commandForSpec(this.model, asArray(specification.when)[0]);
        if (!specCommand) return undefined;
        if (!commandStartsLifecycle(specCommand)) return undefined;
        const port = infrastructurePortForCommand(specCommand, events, slice, this.model);
        if (port) return undefined;

        const expectedEvents = asArray(specification.then)
            .map((element) => eventForSpec(this.model, element))
            .filter(Boolean);
        if (expectedEvents.length === 0) return undefined;

        return this._renderSliceIntegrationTest(
            specification.title ?? `${specCommand.name} integration`,
            specCommand,
            selection
        );
    },

    _fallbackSliceIntegrationTests(slice, selection, events) {
        return (slice.commands ?? [])
            .filter((command) => commandStartsLifecycle(command))
            .filter((command) => !infrastructurePortForCommand(command, events, slice, this.model))
            .map((command) => ({
                command,
                outputs: outboundEvents(command, events)
            }))
            .filter((item) => item.outputs.length > 0)
            .slice(0, 1)
            .map(({command, outputs}) => this._renderSliceIntegrationTest(
                `${command.name} integration`,
                command,
                selection
            ));
    },

    _renderSliceIntegrationTest(title, command, selection) {
        const commandName = _commandTitle(command.title);
        return {
            command,
            fields: commandFieldsWithSelection(command, selection),
            body: `    @Test
    fun ${testMethodName(title)}() {
        val command = ${commandName}(
${commandArguments(command, selection)}
        )

        commandGateway.send(command).getResultMessage().join()
    }`
        };
    },

    _decisionSpecificationTest(specification, packageName, slice, selection, events, reservations, decisionName, stateName) {
        const specCommand = commandForSpec(this.model, asArray(specification.when)[0]);
        if (!specCommand) return undefined;
        const expectedEvents = asArray(specification.then)
            .map((element) => eventForSpec(this.model, element))
            .filter(Boolean);
        const givenEvents = asArray(specification.given)
            .map((element) => eventForSpec(this.model, element))
            .filter(Boolean);
        const port = infrastructurePortForCommand(specCommand, events, slice, this.model);
        const commandName = _commandTitle(specCommand.title);
        const relatedState = relatedStateForCommand(this.model, slice, specCommand, events);
        const includeState = !commandStartsLifecycle(specCommand) || Boolean(relatedState);
        const commandStateTarget = relatedState?.stateTarget ?? stateTargetFor(this.model, slice);
        stateName = commandStateTarget.name;
        const fields = [
            ...commandFieldsWithSelection(specCommand, selection),
            ...givenEvents.flatMap((event) => event.fields ?? []),
            ...expectedEvents.flatMap((event) => event.fields ?? []),
            ...(port ? [...(port.successEvent.fields ?? []), ...(port.failureEvent?.fields ?? [])] : []),
            ...reservations.flatMap((reservation) => [...reservation.idFields, ...reservation.originalFields, ...reservation.normalizedFields])
        ];
        const usesUuid = JSON.stringify(fields).includes('"UUID"');

        if (expectedEvents.length === 0) {
            if (!commandStartsLifecycle(specCommand) || !specHasUniqueReservation(specification) || reservations.length === 0) return undefined;
            const reservationSetup = reservations.map((reservation) => `        val ${reservation.stateParam} = ${reservation.stateName}()
        ${reservation.stateParam}.evolve(
            ${reservation.eventName}(
${reservationEventArguments(reservation, specCommand)}
            )
        )`).join('\n');
            const reservationArgs = reservations.map((reservation) => `,\n                ${reservation.stateParam} = ${reservation.stateParam}`).join('');
            const portResult = port ? renderPortResult(port, port.successEvent, specCommand) : undefined;
            const portArgs = port ? `,\n                portResult = ${portResult}${port.failureEvent ? ',\n                now = LocalDateTime.parse("2026-01-01T00:00:00")' : ''}` : '';
            return {
                command: specCommand,
                reservations,
                fields,
                port,
                usesUuid,
                throws: true,
                body: `    @Test
    fun ${testMethodName(specification.title)}() {
${reservationSetup}

        assertThrows<IllegalArgumentException> {
            ${renderDecideCall(decisionName, commandName, specCommand, selection, `${reservationArgs}${portArgs}`).replaceAll('\n', '\n            ')}
        }
    }`
            };
        }

        const stateSetup = includeState ? `        val state = ${stateName}()
${givenEvents.map((event) => `        state.evolve(
            ${_eventTitle(event.title)}(
${eventArguments(event, this.model)}
            )
        )`).join('\n')}` : '';
        const reservationSetup = commandStartsLifecycle(specCommand) ? reservations.map((reservation) => `        val ${reservation.stateParam} = ${reservation.stateName}()`).join('\n') : '';
        const stateArg = includeState ? ',\n            state = state' : '';
        const reservationArgs = commandStartsLifecycle(specCommand)
            ? reservations.map((reservation) => `,\n            ${reservation.stateParam} = ${reservation.stateParam}`).join('')
            : '';
        const outputIds = new Set(outboundEvents(specCommand, events).map((event) => event.id));
        const stateFields = includeState ? uniqueBy(stateEventsForSlice(this.model, relatedState?.slice ?? slice, events)
            .filter((event) => !outputIds.has(event.id))
            .flatMap((event) => event.fields ?? []), (field) => field.name) : [];
        const portResult = port ? renderPortResult(port, expectedEvents[0], specCommand, stateFields) : undefined;
        const portArgs = port ? `,\n            portResult = ${portResult}${port.failureEvent ? ',\n            now = LocalDateTime.parse("2026-01-01T00:00:00")' : ''}` : '';
        const eventAssertions = expectedEvents.map((event) => {
            const eventName = _eventTitle(event.title);
            const fieldAssertions = assertionsForEvent(event, specCommand);
            return `        val event = events.filterIsInstance<${eventName}>().single()
${fieldAssertions || `        assertTrue(event is ${eventName})`}`;
        }).join('\n');
        return {
            command: specCommand,
            events: [...givenEvents, ...expectedEvents],
            reservations: commandStartsLifecycle(specCommand) ? reservations : [],
            fields,
            port,
            usesState: includeState,
            stateTarget: includeState ? commandStateTarget : undefined,
            usesNow: Boolean(port?.failureEvent),
            usesUuid,
            body: `    @Test
    fun ${testMethodName(specification.title)}() {
${stateSetup}${stateSetup && reservationSetup ? '\n' : ''}${reservationSetup}

        val command = ${commandName}(
${commandArguments(specCommand, selection)}
        )

        val events = (object : ${decisionName} {}).decide(
            command${stateArg}${reservationArgs}${portArgs}
        )

${eventAssertions}
    }`
        };
    },

    _fallbackDecisionTests(slice, selection, events, reservations, decisionName) {
        return (slice.commands ?? [])
            .filter((command) => commandStartsLifecycle(command))
            .map((command) => ({
                command,
                outputs: outboundEvents(command, events)
            }))
            .filter((item) => item.outputs.length > 0)
            .map(({command, outputs}) => {
                const commandName = _commandTitle(command.title);
                const expectedEventName = _eventTitle(outputs[0].title);
                const port = infrastructurePortForCommand(command, events, slice, this.model);
                const relatedState = relatedStateForCommand(this.model, slice, command, events);
                const portResult = port ? renderPortResult(port, outputs[0], command) : undefined;
                const portArgs = port ? `,\n            portResult = ${portResult}${port.failureEvent ? ',\n            now = LocalDateTime.parse("2026-01-01T00:00:00")' : ''}` : '';
                const reservationArgs = reservations.map((reservation) =>
                    `,\n            ${reservation.stateParam} = ${reservation.stateName}()`
                ).join('');
                return {
                    command,
                    events: outputs,
                    reservations,
                    fields: [
                        ...commandFieldsWithSelection(command, selection),
                        ...outputs.flatMap((event) => event.fields ?? []),
                        ...(port ? [...(port.successEvent.fields ?? []), ...(port.failureEvent?.fields ?? [])] : []),
                        ...reservations.flatMap((reservation) => [...reservation.idFields, ...reservation.originalFields, ...reservation.normalizedFields])
                    ],
                    port,
                    usesNow: Boolean(port?.failureEvent),
                    usesState: Boolean(relatedState),
                    stateTarget: relatedState?.stateTarget,
                    usesUuid: JSON.stringify(command.fields ?? []).includes('"UUID"'),
                    body: `    @Test
    fun ${testMethodName(command.name)}Emits${expectedEventName}() {
        val events = ${renderDecideCall(decisionName, commandName, command, selection, `${relatedState ? `,\n            state = ${relatedState.stateTarget.name}()` : ''}${reservationArgs}${portArgs}`)}

        assertTrue(events.any { it is ${expectedEventName} })
    }`
                };
            });
    },
};

module.exports = {testWriterMethods};
