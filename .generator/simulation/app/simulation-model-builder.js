/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { contextPackage } = require('../../common/util/value-types');
const {
    _commandTitle,
    _eventTitle,
    _sliceTitle
} = require('../../common/util/naming');
const {
    kebab,
    pascal
} = require('../../axon5/app/model-helpers');
const { previewValue } = require('./deterministic-data');

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_SCENARIOS = 80;
const DEFAULT_SEED = 1001;

function buildSimulationModel(source = {}, config = {}) {
    const simulationConfig = config.simulation ?? config ?? {};
    const graph = buildSimulationGraph(source);
    const maxDepth = positiveNumber(simulationConfig.maxDepth, DEFAULT_MAX_DEPTH);
    const maxScenarios = positiveNumber(simulationConfig.maxScenarios, DEFAULT_MAX_SCENARIOS);
    const defaultSeed = positiveNumber(simulationConfig.seed ?? simulationConfig.defaultSeed, DEFAULT_SEED);
    const flowScenarios = discoverFlowScenarios(source, graph, {
        maxDepth,
        maxScenarios,
        defaultSeed
    });
    const specificationScenarios = buildSpecificationScenarios(source, graph, defaultSeed);
    const scenarios = withUniqueScenarioClasses([...flowScenarios, ...specificationScenarios])
        .slice(0, maxScenarios);

    return {
        version: 'medol.simulation/v1',
        name: kebab(source.domain ?? source.name ?? 'medol-simulation') || 'medol-simulation',
        title: source.domain ?? source.title ?? 'Medol Simulation',
        rootPackage: source.rootPackage ?? 'tech.medo',
        defaultSeed,
        maxDepth,
        scenarios,
        graph: {
            commands: graph.commands.map((node) => graphCommandSummary(node)),
            events: graph.events.map((node) => graphEventSummary(node)),
            reactions: graph.reactions.map((edge) => graphReactionSummary(edge))
        },
        unsupported: unsupportedScenarios(scenarios)
    };
}

function buildSimulationGraph(source = {}) {
    const commands = [];
    const events = [];
    const reactions = [];
    const refs = new Map();

    (source.slices ?? []).forEach((slice, sliceIndex) => {
        const sliceNode = {
            id: slice.id ?? stableId('slice', slice.title ?? slice.name ?? sliceIndex),
            name: slice.name ?? pascal(slice.title ?? `Slice${sliceIndex + 1}`),
            title: cleanTitle(slice.title ?? slice.name ?? `Slice ${sliceIndex + 1}`),
            context: slice.context ?? slice.chapter ?? 'EventModel',
            packageName: contextPackage(slice.context ?? slice.chapter ?? 'EventModel'),
            packagePath: _sliceTitle(slice.title ?? slice.name ?? `slice-${sliceIndex + 1}`),
            startsLifecycle: Boolean(slice.startsLifecycle)
        };

        (slice.commands ?? []).forEach((command, commandIndex) => {
            const node = {
                id: command.id ?? stableId('command', `${sliceNode.title}/${command.title ?? command.name ?? commandIndex}`),
                name: command.name ?? pascal(command.title ?? `Command${commandIndex + 1}`),
                title: cleanTitle(command.title ?? command.name ?? `Command ${commandIndex + 1}`),
                className: _commandTitle(command.title ?? command.name ?? `Command ${commandIndex + 1}`),
                context: sliceNode.context,
                contextPackage: sliceNode.packageName,
                slicePackage: sliceNode.packagePath,
                sliceId: sliceNode.id,
                sliceName: sliceNode.name,
                sliceTitle: sliceNode.title,
                startsLifecycle: sliceNode.startsLifecycle || Boolean(command.startsLifecycle ?? command.createsAggregate),
                command,
                slice
            };
            commands.push(node);
            addRefs(refs, node, 'COMMAND');
        });

        (slice.events ?? []).forEach((event, eventIndex) => {
            const node = {
                id: event.id ?? stableId('event', `${sliceNode.title}/${event.title ?? event.name ?? eventIndex}`),
                name: event.name ?? pascal(event.title ?? `Event${eventIndex + 1}`),
                title: cleanTitle(event.title ?? event.name ?? `Event ${eventIndex + 1}`),
                className: _eventTitle(event.title ?? event.name ?? `Event ${eventIndex + 1}`),
                context: sliceNode.context,
                contextPackage: sliceNode.packageName,
                sliceId: sliceNode.id,
                sliceName: sliceNode.name,
                sliceTitle: sliceNode.title,
                event,
                slice
            };
            events.push(node);
            addRefs(refs, node, 'EVENT');
        });
    });

    const commandsBySlice = groupBy(commands, (node) => node.sliceId);
    const eventsBySlice = groupBy(events, (node) => node.sliceId);
    commands.forEach((commandNode) => {
        commandNode.expectedEvents = expectedEventsForCommand(commandNode, eventsBySlice.get(commandNode.sliceId) ?? [], refs);
    });

    (source.slices ?? []).forEach((slice) => {
        reactionElements(slice).forEach((reaction) => {
            const sourceEvents = reactionSourceEvents(reaction, refs);
            const targetCommands = reactionTargetCommands(reaction, refs, commandsBySlice.get(slice.id) ?? []);
            sourceEvents.forEach((eventNode) => {
                targetCommands.forEach((commandNode) => {
                    reactions.push({
                        id: reaction.id ?? stableId('reaction', `${eventNode.id}/${commandNode.id}`),
                        name: reaction.name ?? pascal(reaction.title ?? 'Reaction'),
                        title: cleanTitle(reaction.title ?? reaction.name ?? 'Reaction'),
                        type: reaction.type ?? 'PROCESSOR',
                        sourceEvent: eventNode,
                        targetCommand: commandNode,
                        execution: 'AUTOMATIC',
                        metadata: reaction.metadata ?? {}
                    });
                });
            });
        });
    });

    events.forEach((eventNode) => {
        outboundCommandRefs(eventNode.event).forEach((ref) => {
            const commandNode = findRef(refs, ref, 'COMMAND');
            if (commandNode && !hasReaction(reactions, eventNode, commandNode)) {
                reactions.push({
                    id: stableId('reaction', `${eventNode.id}/${commandNode.id}/manual`),
                    name: `${eventNode.name}To${commandNode.name}`,
                    title: `${eventNode.title} To ${commandNode.title}`,
                    type: 'FLOW',
                    sourceEvent: eventNode,
                    targetCommand: commandNode,
                    execution: 'COMMAND',
                    metadata: {}
                });
            }
        });
    });

    commands.forEach((commandNode) => {
        inboundEventRefs(commandNode.command).forEach((ref) => {
            const eventNode = findRef(refs, ref, 'EVENT');
            if (eventNode && !hasReaction(reactions, eventNode, commandNode)) {
                reactions.push({
                    id: stableId('reaction', `${eventNode.id}/${commandNode.id}/manual`),
                    name: `${eventNode.name}To${commandNode.name}`,
                    title: `${eventNode.title} To ${commandNode.title}`,
                    type: 'FLOW',
                    sourceEvent: eventNode,
                    targetCommand: commandNode,
                    execution: 'COMMAND',
                    metadata: {}
                });
            }
        });
    });

    const eventEdges = groupBy(reactions, (edge) => edge.sourceEvent.id);
    return {
        commands,
        events,
        reactions,
        eventEdges,
        refs
    };
}

function discoverFlowScenarios(source, graph, options) {
    const startCommands = graph.commands.filter((command) => command.startsLifecycle);
    const starts = startCommands.length > 0 ? startCommands : graph.commands.slice(0, 1);
    const scenarios = [];

    starts.forEach((start) => {
        const paths = walkScenarioPath(graph, source, {
            commandNode: start,
            trigger: undefined,
            path: [],
            availableEvents: [],
            visitedCommands: new Set(),
            notes: [],
            depth: 0,
            maxDepth: options.maxDepth,
            seed: options.defaultSeed
        });
        paths.forEach((result) => {
            if (result.path.length === 0) return;
            scenarios.push(flowScenarioFromPath(result.path, result.notes));
        });
    });

    return scenarios.slice(0, options.maxScenarios);
}

function walkScenarioPath(graph, source, state) {
    if (state.depth >= state.maxDepth) {
        return [{
            path: state.path,
            notes: [...state.notes, `Traversal stopped at maxDepth=${state.maxDepth}.`]
        }];
    }
    if (state.visitedCommands.has(state.commandNode.id)) {
        return [{
            path: state.path,
            notes: [...state.notes, `Cycle detected at ${state.commandNode.title}; command was not repeated.`]
        }];
    }

    const step = buildFlowStep(source, state.commandNode, {
        index: state.path.length + 1,
        trigger: state.trigger,
        availableEvents: state.availableEvents,
        seed: state.seed
    });
    const path = [...state.path, step];
    const availableEvents = uniqueBy([...state.availableEvents, ...step.expectedEventNodes], (event) => event.id);
    const visitedCommands = new Set(state.visitedCommands).add(state.commandNode.id);
    const nextEdges = step.expectedEventNodes.flatMap((eventNode) => graph.eventEdges.get(eventNode.id) ?? []);

    if (nextEdges.length === 0) {
        return [{ path, notes: state.notes }];
    }

    const paths = [];
    nextEdges.forEach((edge) => {
        if (visitedCommands.has(edge.targetCommand.id)) {
            paths.push({
                path,
                notes: [...state.notes, `Cycle detected at ${edge.targetCommand.title}; command was not repeated.`]
            });
            return;
        }
        paths.push(...walkScenarioPath(graph, source, {
            commandNode: edge.targetCommand,
            trigger: edge,
            path,
            availableEvents,
            visitedCommands,
            notes: state.notes,
            depth: state.depth + 1,
            maxDepth: state.maxDepth,
            seed: state.seed
        }));
    });
    return paths;
}

function buildFlowStep(source, commandNode, options) {
    const id = uniqueStepId(commandNode.name, options.index);
    const expectedEventNodes = commandNode.expectedEvents ?? [];
    return {
        id,
        title: commandNode.title,
        slice: commandNode.sliceTitle,
        context: commandNode.context,
        command: commandNode.name,
        commandTitle: commandNode.title,
        commandClassName: commandNode.className,
        commandFqcn: `${source.rootPackage ?? 'tech.medo'}.${commandNode.contextPackage}.${commandNode.slicePackage}.${commandNode.className}`,
        execution: options.trigger?.execution ?? 'COMMAND',
        triggeredBy: options.trigger
            ? {
                event: options.trigger.sourceEvent.name,
                eventTitle: options.trigger.sourceEvent.title,
                reaction: options.trigger.title,
                reactionType: options.trigger.type
            }
            : undefined,
        inputs: buildStepInputs(source, commandNode, {
            stepId: id,
            availableEvents: options.availableEvents,
            seed: options.seed
        }),
        expectedEvents: expectedEventNodes.map((eventNode) => eventReference(source, eventNode)),
        expectedEventNodes,
        expectedRejection: undefined
    };
}

function buildStepInputs(source, commandNode, options = {}) {
    const explicitValues = options.explicitValues ?? new Map();
    return (commandNode.command?.fields ?? []).map((field) => {
        const sourceInfo = inputSourceForField(field, source, {
            explicitValues,
            availableEvents: options.availableEvents ?? [],
            seed: options.seed ?? DEFAULT_SEED,
            stepId: options.stepId
        });
        const typeInfo = fieldTypeInfo(field, source, commandNode.context);
        return {
            name: field.name,
            label: humanize(field.name),
            type: field.type ?? 'String',
            cardinality: field.cardinality ?? 'Single',
            optional: Boolean(field.optional),
            idAttribute: Boolean(field.idAttribute),
            generated: Boolean(field.generated),
            kotlinType: typeInfo.kotlinType,
            typeInfo,
            source: sourceInfo
        };
    });
}

function inputSourceForField(field, source, options) {
    if (options.explicitValues.has(field.name)) {
        return constantSource(options.explicitValues.get(field.name), 'specification');
    }

    const explicitSource = explicitPreviousEventSource(field, options.availableEvents, source);
    if (explicitSource) return explicitSource;

    const priorEventSource = previousEventSourceByFieldName(field, options.availableEvents);
    if (priorEventSource) return priorEventSource;

    const example = field.example ?? field.default ?? field.value;
    if (example !== undefined) {
        return constantSource(example, field.example !== undefined ? 'example' : 'default');
    }

    return {
        kind: 'Generated',
        previewValue: previewValue(field, options.seed, `${options.stepId}.${field.name}`)
    };
}

function explicitPreviousEventSource(field, availableEvents, source) {
    const refs = normalizeArray(field.source?.from ?? field.source ?? field.mappings ?? []);
    const parsed = refs
        .map((ref) => parseEventFieldRef(ref))
        .find(Boolean);
    if (!parsed) return undefined;

    const eventNode = availableEvents.find((event) => sameRef(event, parsed.event))
        ?? buildSimulationGraph(source).events.find((event) => sameRef(event, parsed.event));
    return {
        kind: 'PreviousEvent',
        event: eventNode?.name ?? parsed.event,
        eventTitle: eventNode?.title ?? parsed.event,
        field: parsed.field
    };
}

function previousEventSourceByFieldName(field, availableEvents) {
    if (!field.name || availableEvents.length === 0) return undefined;
    const shouldReuse = field.idAttribute || /id$/i.test(field.name);
    if (!shouldReuse) return undefined;
    const sourceEvent = [...availableEvents].reverse().find((eventNode) =>
        (eventNode.event?.fields ?? []).some((candidate) => candidate.name === field.name)
    );
    if (!sourceEvent) return undefined;
    return {
        kind: 'PreviousEvent',
        event: sourceEvent.name,
        eventTitle: sourceEvent.title,
        field: field.name
    };
}

function constantSource(value, reason) {
    return {
        kind: 'Constant',
        value,
        reason
    };
}

function buildSpecificationScenarios(source, graph, defaultSeed) {
    const scenarios = [];
    (source.slices ?? []).forEach((slice) => {
        (slice.specifications ?? []).forEach((specification, index) => {
            const given = normalizeArray(specification.given).map((givenEvent) => ({
                title: cleanTitle(givenEvent.title ?? givenEvent.name ?? `Given ${index + 1}`),
                type: givenEvent.type ?? 'EVENT',
                fields: normalizeArray(givenEvent.fields).map((field) => ({
                    name: field.name,
                    value: field.example ?? field.value ?? field.default
                })),
                supported: false,
                reason: 'First phase records given state but does not insert events or database rows.'
            }));
            const whenCommands = normalizeArray(specification.when).filter((item) => String(item.type ?? 'COMMAND').toUpperCase() === 'COMMAND');
            const thenItems = normalizeArray(specification.then);
            const expectedEvents = thenItems
                .filter((item) => String(item.type ?? '').toUpperCase() === 'EVENT')
                .map((item) => eventReference(source, findRef(graph.refs, item, 'EVENT') ?? pseudoEvent(source, slice, item)));
            const expectedRejection = thenItems.find((item) => String(item.outcome ?? '').toUpperCase() === 'REJECT')
                ?? (specification.then && !Array.isArray(specification.then) && String(specification.then.outcome ?? '').toUpperCase() === 'REJECT' ? specification.then : undefined);
            const steps = whenCommands.map((whenCommand, commandIndex) => {
                const commandNode = findRef(graph.refs, whenCommand, 'COMMAND') ?? pseudoCommand(source, slice, whenCommand);
                const explicitValues = new Map(normalizeArray(whenCommand.fields)
                    .filter((field) => field.name && (field.example !== undefined || field.value !== undefined || field.default !== undefined))
                    .map((field) => [field.name, field.example ?? field.value ?? field.default]));
                const stepId = uniqueStepId(commandNode.name, commandIndex + 1);
                return {
                    id: stepId,
                    title: commandNode.title,
                    slice: commandNode.sliceTitle,
                    context: commandNode.context,
                    command: commandNode.name,
                    commandTitle: commandNode.title,
                    commandClassName: commandNode.className,
                    commandFqcn: `${source.rootPackage ?? 'tech.medo'}.${commandNode.contextPackage}.${commandNode.slicePackage}.${commandNode.className}`,
                    execution: 'COMMAND',
                    inputs: buildStepInputs(source, commandNode, {
                        stepId,
                        seed: defaultSeed,
                        availableEvents: [],
                        explicitValues
                    }),
                    expectedEvents,
                    expectedEventNodes: [],
                    expectedRejection: expectedRejection
                        ? {
                            reason: expectedRejection.description ?? expectedRejection.title ?? 'Command rejected',
                            outcome: expectedRejection.outcome ?? 'REJECT'
                        }
                        : undefined
                };
            });

            scenarios.push({
                id: kebab(specification.title ?? specification.specification ?? `${slice.title}-specification-${index + 1}`),
                className: `${pascal(specification.title ?? specification.specification ?? `${slice.title}Specification${index + 1}`)}Scenario`,
                name: cleanTitle(specification.title ?? specification.specification ?? `${slice.title} Specification`),
                kind: 'SPECIFICATION',
                context: slice.context ?? slice.chapter ?? 'EventModel',
                given,
                steps,
                notes: given.some((item) => !item.supported)
                    ? ['Specification given state is recorded as unsupported preparation in phase one.']
                    : []
            });
        });
    });
    return scenarios;
}

function flowScenarioFromPath(path, notes) {
    const first = path[0];
    const last = path[path.length - 1];
    const name = path.length === 1
        ? `${first.slice} Flow`
        : `${first.slice} To ${last.slice}`;
    return {
        id: kebab(name),
        className: `${pascal(name)}Scenario`,
        name,
        kind: 'FLOW',
        context: first.context,
        given: [],
        steps: path.map((step) => ({
            ...step,
            expectedEventNodes: undefined
        })),
        notes
    };
}

function expectedEventsForCommand(commandNode, sliceEvents, refs) {
    const fromCommandDeps = outboundEventRefs(commandNode.command)
        .map((ref) => findRef(refs, ref, 'EVENT'))
        .filter(Boolean);
    const fromEventDeps = sliceEvents.filter((eventNode) =>
        inboundCommandRefs(eventNode.event).some((ref) => sameElementRef(ref, commandNode))
    );
    const result = uniqueBy([...fromCommandDeps, ...fromEventDeps], (event) => event.id);
    return result.length > 0 ? result : sliceEvents;
}

function reactionElements(slice) {
    return [
        ...(slice.processors ?? []),
        ...(slice.automations ?? []),
        ...(slice.policies ?? [])
    ];
}

function reactionSourceEvents(reaction, refs) {
    const dependencyRefs = inboundEventRefs(reaction);
    const metadataRefs = normalizeArray(reaction.metadata?.on).map((title) => ({
        title,
        elementType: 'EVENT'
    }));
    return uniqueBy([...dependencyRefs, ...metadataRefs]
        .map((ref) => findRef(refs, ref, 'EVENT'))
        .filter(Boolean), (event) => event.id);
}

function reactionTargetCommands(reaction, refs, fallbackCommands) {
    const dependencyRefs = outboundCommandRefs(reaction);
    const metadataRefs = normalizeArray(reaction.metadata?.emits).map((title) => ({
        title,
        elementType: 'COMMAND'
    }));
    const commands = uniqueBy([...dependencyRefs, ...metadataRefs]
        .map((ref) => findRef(refs, ref, 'COMMAND'))
        .filter(Boolean), (command) => command.id);
    if (commands.length > 0) return commands;
    return fallbackCommands.length === 1 ? fallbackCommands : [];
}

function outboundEventRefs(element) {
    return dependencyRefs(element, 'OUTBOUND', 'EVENT');
}

function inboundEventRefs(element) {
    return dependencyRefs(element, 'INBOUND', 'EVENT');
}

function outboundCommandRefs(element) {
    return dependencyRefs(element, 'OUTBOUND', 'COMMAND');
}

function inboundCommandRefs(element) {
    return dependencyRefs(element, 'INBOUND', 'COMMAND');
}

function dependencyRefs(element, direction, elementType) {
    return (element?.dependencies ?? [])
        .filter((dependency) => sameDirection(dependency.direction ?? dependency.type, direction))
        .filter((dependency) => sameElementType(dependency.elementType ?? dependency.type, elementType));
}

function sameDirection(value, direction) {
    return String(value ?? '').toUpperCase() === direction;
}

function sameElementType(value, type) {
    return String(value ?? '').toUpperCase() === type;
}

function hasReaction(reactions, eventNode, commandNode) {
    return reactions.some((edge) => edge.sourceEvent.id === eventNode.id && edge.targetCommand.id === commandNode.id);
}

function eventReference(source, eventNode) {
    return {
        name: eventNode.name,
        title: eventNode.title,
        className: eventNode.className,
        fqcn: `${source.rootPackage ?? 'tech.medo'}.${eventNode.contextPackage}.events.${eventNode.className}`,
        fields: (eventNode.event?.fields ?? []).map((field) => ({
            name: field.name,
            type: field.type ?? 'String'
        })),
    };
}

function graphCommandSummary(node) {
    return {
        id: node.id,
        name: node.name,
        title: node.title,
        context: node.context,
        slice: node.sliceTitle,
        startsLifecycle: node.startsLifecycle,
        expectedEvents: (node.expectedEvents ?? []).map((event) => event.name)
    };
}

function graphEventSummary(node) {
    return {
        id: node.id,
        name: node.name,
        title: node.title,
        context: node.context,
        slice: node.sliceTitle
    };
}

function graphReactionSummary(edge) {
    return {
        id: edge.id,
        name: edge.name,
        title: edge.title,
        type: edge.type,
        execution: edge.execution,
        sourceEvent: edge.sourceEvent.name,
        targetCommand: edge.targetCommand.name
    };
}

function unsupportedScenarios(scenarios) {
    return scenarios.flatMap((scenario) =>
        (scenario.given ?? [])
            .filter((given) => !given.supported)
            .map((given) => ({
                scenario: scenario.id,
                item: given.title,
                reason: given.reason
            }))
    );
}

function fieldTypeInfo(field, source, context) {
    const cardinality = String(field.cardinality ?? 'Single').toLowerCase();
    const valueType = findValueTypeForField(field, source, context);
    const conceptState = findConceptState(field, source, context);
    const primitive = primitiveType(field.type);
    const base = conceptState ?? valueTypeInfo(valueType, source) ?? primitive ?? {
        kind: 'scalar',
        kotlinType: 'String',
        baseType: 'String'
    };
    const innerType = base.kotlinType;
    const list = cardinality === 'multiple' || cardinality === 'list';
    const kotlinType = list
        ? `List<${innerType.replace(/\?$/g, '')}>`
        : field.optional
            ? `${innerType.replace(/\?$/g, '')}?`
            : innerType.replace(/\?$/g, '');
    return {
        ...base,
        list,
        optional: Boolean(field.optional),
        kotlinType
    };
}

function primitiveType(type) {
    switch (String(type ?? 'String').toLowerCase()) {
        case 'uuid': return { kind: 'scalar', kotlinType: 'java.util.UUID', baseType: 'UUID' };
        case 'int':
        case 'integer': return { kind: 'scalar', kotlinType: 'Int', baseType: 'Int' };
        case 'long': return { kind: 'scalar', kotlinType: 'Long', baseType: 'Long' };
        case 'double':
        case 'number': return { kind: 'scalar', kotlinType: 'Double', baseType: 'Double' };
        case 'float': return { kind: 'scalar', kotlinType: 'Float', baseType: 'Float' };
        case 'decimal':
        case 'bigdecimal': return { kind: 'scalar', kotlinType: 'java.math.BigDecimal', baseType: 'BigDecimal' };
        case 'boolean': return { kind: 'scalar', kotlinType: 'Boolean', baseType: 'Boolean' };
        case 'date':
        case 'localdate': return { kind: 'scalar', kotlinType: 'java.time.LocalDate', baseType: 'LocalDate' };
        case 'datetime':
        case 'localdatetime': return { kind: 'scalar', kotlinType: 'java.time.LocalDateTime', baseType: 'LocalDateTime' };
        case 'instant': return { kind: 'scalar', kotlinType: 'java.time.Instant', baseType: 'Instant' };
        case 'string':
        default: return { kind: 'scalar', kotlinType: 'String', baseType: 'String' };
    }
}

function valueTypeInfo(valueType, source) {
    if (!valueType) return undefined;
    const fqcn = `${source.rootPackage ?? 'tech.medo'}.${contextPackage(valueType.context)}.domain.types.${valueType.name}`;
    if (valueType.kind === 'enum') {
        return {
            kind: 'enum',
            kotlinType: fqcn,
            typeName: valueType.name,
            fqcn,
            values: valueType.values ?? []
        };
    }
    if (valueType.kind === 'object') {
        return {
            kind: 'value-object',
            kotlinType: fqcn,
            typeName: valueType.name,
            fqcn,
            fields: valueType.fields ?? []
        };
    }
    return {
        kind: 'value-scalar',
        kotlinType: fqcn,
        typeName: valueType.name,
        fqcn,
        base: primitiveType(valueType.resolvedBaseType ?? valueType.baseType ?? 'String')
    };
}

function findValueTypeForField(field, source, context) {
    return (source.valueTypes ?? []).find((valueType) => valueType.name === field.type && valueType.context === context)
        ?? field.valueType
        ?? (source.valueTypes ?? []).find((valueType) => valueType.name === field.type);
}

function findConceptState(field, source, context) {
    const match = String(field.type ?? '').match(/^([A-Za-z_][A-Za-z0-9_]*)\.State$/);
    if (!match) return undefined;
    const concept = (source.concepts ?? []).find((candidate) => candidate.name === match[1]);
    const packageContext = contextPackage(concept?.context ?? context);
    const typeName = `${match[1]}StateEnum`;
    return {
        kind: 'enum',
        kotlinType: `${source.rootPackage ?? 'tech.medo'}.${packageContext}.domain.states.${typeName}`,
        typeName,
        fqcn: `${source.rootPackage ?? 'tech.medo'}.${packageContext}.domain.states.${typeName}`,
        values: concept?.states ?? []
    };
}

function parseEventFieldRef(ref) {
    const value = typeof ref === 'string'
        ? ref
        : ref?.path ?? ref?.field ?? ref?.from;
    const match = String(value ?? '').match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
    return match ? { event: match[1], field: match[2] } : undefined;
}

function addRefs(refs, node, type) {
    [
        node.id,
        node.name,
        node.title,
        node.className
    ].filter(Boolean).forEach((value) => {
        refs.set(refKey(type, value), node);
    });
}

function findRef(refs, ref, type) {
    if (!ref) return undefined;
    return [
        ref.id,
        ref.name,
        ref.title,
        ref.className,
        typeof ref === 'string' ? ref : undefined
    ].filter(Boolean)
        .map((value) => refs.get(refKey(type, value)))
        .find(Boolean);
}

function refKey(type, value) {
    return `${type}:${normalizeRef(value)}`;
}

function sameElementRef(ref, node) {
    return normalizeRef(ref.id) === normalizeRef(node.id)
        || normalizeRef(ref.name) === normalizeRef(node.name)
        || normalizeRef(ref.title) === normalizeRef(node.title)
        || normalizeRef(ref.title) === normalizeRef(node.className);
}

function sameRef(node, value) {
    const normalized = normalizeRef(value);
    return [node.id, node.name, node.title, node.className].some((candidate) => normalizeRef(candidate) === normalized);
}

function normalizeRef(value) {
    return String(value ?? '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function pseudoCommand(source, slice, item) {
    const context = slice.context ?? slice.chapter ?? 'EventModel';
    const title = cleanTitle(item.title ?? item.name ?? 'Command');
    return {
        id: item.id ?? stableId('command', title),
        name: item.name ?? pascal(title),
        title,
        className: _commandTitle(title),
        context,
        contextPackage: contextPackage(context),
        slicePackage: _sliceTitle(slice.title ?? slice.name ?? title),
        sliceTitle: cleanTitle(slice.title ?? slice.name ?? title),
        command: {
            ...item,
            fields: item.fields ?? []
        }
    };
}

function pseudoEvent(source, slice, item) {
    const context = slice.context ?? slice.chapter ?? 'EventModel';
    const title = cleanTitle(item.title ?? item.name ?? 'Event');
    return {
        id: item.id ?? stableId('event', title),
        name: item.name ?? pascal(title),
        title,
        className: _eventTitle(title),
        context,
        contextPackage: contextPackage(context),
        sliceTitle: cleanTitle(slice.title ?? slice.name ?? title),
        event: {
            ...item,
            fields: item.fields ?? []
        }
    };
}

function withUniqueScenarioClasses(scenarios) {
    const ids = new Map();
    const classes = new Map();
    return scenarios.map((scenario) => {
        const idCount = ids.get(scenario.id) ?? 0;
        ids.set(scenario.id, idCount + 1);
        const classCount = classes.get(scenario.className) ?? 0;
        classes.set(scenario.className, classCount + 1);
        return {
            ...scenario,
            id: idCount === 0 ? scenario.id : `${scenario.id}-${idCount + 1}`,
            className: classCount === 0 ? scenario.className : `${scenario.className}${classCount + 1}`
        };
    });
}

function uniqueStepId(commandName, index) {
    const base = String(commandName ?? `step${index}`)
        .replace(/^[A-Z]/, (char) => char.toLowerCase())
        .replace(/[^A-Za-z0-9_]/g, '');
    return base || `step${index}`;
}

function cleanTitle(value) {
    return String(value ?? '')
        .replace(/^(screen|slice|spec|command|readmodel|projection)\s*:\s*/i, '')
        .trim();
}

function humanize(value) {
    return cleanTitle(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stableId(prefix, value) {
    const input = String(value ?? prefix);
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
    }
    return `${prefix}-${Math.abs(hash).toString(16)}`;
}

function groupBy(items, key) {
    const map = new Map();
    items.forEach((item) => {
        const value = key(item);
        map.set(value, [...(map.get(value) ?? []), item]);
    });
    return map;
}

function uniqueBy(items, key) {
    const seen = new Set();
    return items.filter((item) => {
        const value = key(item);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function normalizeArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function positiveNumber(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

module.exports = {
    buildSimulationGraph,
    buildSimulationModel,
    fieldTypeInfo,
    inputSourceForField
};
