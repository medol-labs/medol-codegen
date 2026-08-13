/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

function fromConfig(config = {}) {
    const contexts = normalizeContexts(config);
    const concepts = normalizeConcepts(config, contexts);
    const valueTypes = normalizeValueTypes(config, contexts);
    const aggregates = normalizeAggregates(config, contexts, valueTypes);
    const actors = normalizeActors(config);
    const slices = normalizeSlices(config, aggregates, contexts, actors, valueTypes);
    const transitions = normalizeTransitions(config.transitions ?? [], slices, concepts, aggregates);

    return {
        rootPackage: config.codeGen?.rootPackage ?? 'tech.medo',
        ...(config.domain ? { domain: config.domain } : {}),
        ...(config.domains ? { domains: config.domains } : {}),
        ...(config.deployments ? { deployments: config.deployments } : {}),
        ...(config.i18n ? { i18n: config.i18n } : {}),
        ...(config.translations ? { translations: config.translations } : {}),
        ...(config.locales ? { locales: config.locales } : {}),
        ...(config.defaultLocale ? { defaultLocale: config.defaultLocale } : {}),
        contexts,
        concepts,
        valueTypes,
        aggregates,
        transitions,
        actors,
        slices,
        source: {
            kind: 'config',
            boardId: config.boardId
        }
    };
}

function fromCodegenModel(model = {}) {
    const contexts = normalizeContexts(model);
    const concepts = normalizeConcepts(model, contexts);
    const valueTypes = normalizeValueTypes(model, contexts);
    const aggregates = normalizeAggregates(model, contexts, valueTypes);
    const actors = normalizeActors(model);
    const slices = normalizeSlices(model, aggregates, contexts, actors, valueTypes);
    const transitions = normalizeTransitions(model.transitions ?? [], slices, concepts, aggregates);

    return {
        rootPackage: model.rootPackage ?? 'tech.medo',
        ...(model.domain ? { domain: model.domain } : {}),
        ...(model.domains ? { domains: model.domains } : {}),
        ...(model.deployments ? { deployments: model.deployments } : {}),
        ...(model.i18n ? { i18n: model.i18n } : {}),
        ...(model.translations ? { translations: model.translations } : {}),
        ...(model.locales ? { locales: model.locales } : {}),
        ...(model.defaultLocale ? { defaultLocale: model.defaultLocale } : {}),
        contexts,
        concepts,
        valueTypes,
        aggregates,
        transitions,
        actors,
        slices,
        source: {
            kind: 'codegen-model'
        }
    };
}

function toGeneratorConfig(model, source = {}) {
    return {
        ...source,
        slices: model.slices,
        flows: source.flows ?? [],
        valueTypes: model.valueTypes,
        concepts: model.concepts,
        aggregates: model.aggregates,
        transitions: model.transitions,
        actors: model.actors,
        ...(model.i18n ? { i18n: model.i18n } : {}),
        ...(model.translations ? { translations: model.translations } : {}),
        ...(model.locales ? { locales: model.locales } : {}),
        ...(model.defaultLocale ? { defaultLocale: model.defaultLocale } : {}),
        ...(model.domain ? { domain: model.domain } : {}),
        ...(model.domains ? { domains: model.domains } : {}),
        ...(model.deployments ? { deployments: model.deployments } : {}),
        context: primaryContextName(model),
        contexts: model.contexts,
        codeGen: {
            ...(source.codeGen ?? {}),
            application: model.domain ?? source.codeGen?.application ?? '',
            rootPackage: model.rootPackage,
            contextPackage: primaryContextName(model)
        }
    };
}

function normalizeConcepts(config, contexts) {
    const source = (config.concepts ?? []).length > 0
        ? config.concepts
        : contexts.flatMap((context) => context.concepts ?? []);
    const byName = new Map();
    source.forEach((concept) => {
        const name = concept.name ?? concept.title;
        if (!name || byName.has(name)) {
            return;
        }
        byName.set(name, {
            ...concept,
            name,
            title: concept.title ?? humanize(name),
            context: concept.context ?? contexts.find((context) =>
                (context.concepts ?? []).some((candidate) =>
                    (candidate.name ?? candidate.title) === name
                )
            )?.name,
            states: concept.states ?? []
        });
    });
    return Array.from(byName.values());
}

function primaryContextName(model) {
    return model.contexts[0]?.name ?? 'EventModel';
}

function normalizeContexts(config) {
    if (Array.isArray(config.contexts) && config.contexts.length > 0) {
        return config.contexts.map((context, index) => ({
            id: context.id ?? stableId('context', context.name ?? context.title ?? index),
            name: context.name ?? context.title ?? String(context),
            title: context.title ?? humanize(context.name ?? context.title ?? String(context)),
            ...(context.domain ? { domain: context.domain } : {}),
            notes: context.notes ?? [],
            risks: context.risks ?? [],
            decisions: context.decisions ?? [],
            metrics: context.metrics ?? [],
            concepts: context.concepts ?? [],
            valueTypes: normalizeValueTypeRefs(context.valueTypes ?? []),
            aggregates: normalizeAggregateRefs(context.aggregates ?? [])
        }));
    }

    const contextNames = unique([
        ...(config.slices ?? []).map((slice) => slice.context ?? slice.chapter).filter(Boolean),
        typeof config.context === 'string' ? config.context : undefined
    ].filter(Boolean));
    const names = contextNames.length > 0 ? contextNames : ['EventModel'];

    return names.map((contextName) => ({
        id: stableId('context', contextName),
        name: contextName,
        title: humanize(contextName),
        notes: [],
        risks: [],
        decisions: [],
        metrics: [],
        concepts: [],
        valueTypes: normalizeValueTypeRefs(valueTypesForContext(config, contextName)),
        aggregates: normalizeAggregateRefs(aggregatesForContext(config, contextName))
    }));
}

function normalizeValueTypes(config, contexts) {
    const initial = (config.valueTypes ?? []).map((valueType, index) => {
        const name = valueType.name ?? valueType.title ?? `ValueType${index + 1}`;
        const context = valueType.context ?? findContextForValueType(name, contexts);
        return {
            id: valueType.id ?? stableId('type', `${context ?? ''}/${name}`),
            name,
            title: valueType.title ?? humanize(name),
            context,
            kind: valueType.kind ?? (Array.isArray(valueType.fields) && valueType.fields.length > 0 ? 'object' : valueType.values?.length > 0 ? 'enum' : 'scalar'),
            baseType: valueType.baseType ?? 'String',
            constraints: normalizeValueTypeConstraints(valueType.constraints ?? []),
            values: valueType.values ?? [],
            fields: valueType.fields ?? []
        };
    });
    const byName = new Map(initial.map((valueType) => [valueType.name, valueType]));
    const resolved = initial.map((valueType) => ({
        ...valueType,
        resolvedBaseType: resolveValueTypeBase(valueType, byName),
        resolvedConstraints: resolveValueTypeConstraints(valueType, byName)
    }));
    return resolved.map((valueType) => ({
        ...valueType,
        fields: normalizeFields(valueType.fields ?? [], resolved)
    }));
}

function resolveValueTypeBase(valueType, byName, visited = new Set()) {
    if (!byName.has(valueType.baseType)) {
        return valueType.baseType;
    }
    if (visited.has(valueType.name)) {
        return 'String';
    }
    const next = new Set(visited).add(valueType.name);
    return resolveValueTypeBase(byName.get(valueType.baseType), byName, next);
}

function resolveValueTypeConstraints(valueType, byName, visited = new Set()) {
    if (visited.has(valueType.name)) {
        return valueType.constraints;
    }
    const parent = byName.get(valueType.baseType);
    const inherited = parent
        ? resolveValueTypeConstraints(parent, byName, new Set(visited).add(valueType.name))
        : [];
    return [...inherited, ...valueType.constraints];
}

function normalizeValueTypeConstraints(constraints) {
    return constraints.map((constraint) => {
        switch (constraint.kind) {
            case 'format':
                return {kind: 'format', format: constraint.format};
            case 'length':
            case 'range':
                return {kind: constraint.kind, min: Number(constraint.min), max: Number(constraint.max)};
            case 'matches':
                return {kind: 'matches', pattern: constraint.pattern};
            case 'oneOf':
                return {kind: 'oneOf', values: constraint.values ?? []};
            default:
                return constraint;
        }
    });
}

function normalizeValueTypeRefs(valueTypes) {
    return valueTypes.map((valueType) => {
        if (typeof valueType === 'string') {
            return {id: stableId('type', valueType), name: valueType, title: humanize(valueType)};
        }
        const name = valueType.name ?? valueType.title;
        return {
            id: valueType.id ?? stableId('type', name),
            name,
            title: valueType.title ?? humanize(name)
        };
    });
}

function findContextForValueType(valueTypeName, contexts) {
    return contexts.find((context) => (context.valueTypes ?? []).some((valueType) => {
        const name = typeof valueType === 'string' ? valueType : valueType.name ?? valueType.title;
        return name === valueTypeName;
    }))?.name;
}

function valueTypesForContext(config, contextName) {
    return (config.valueTypes ?? []).filter((valueType) => !valueType.context || valueType.context === contextName);
}

function normalizeAggregates(config, contexts, valueTypes) {
    return (config.aggregates ?? []).map((aggregate) => {
        const name = aggregate.name ?? aggregate.title;
        const title = aggregate.title ?? humanize(name);
        return {
            id: aggregate.id ?? stableId('aggregate', name ?? title),
            name,
            title,
            context: aggregate.context ?? findContextForAggregate(title, contexts),
            fields: normalizeFields(aggregate.fields ?? [], valueTypes),
            states: aggregate.states ?? []
        };
    });
}

function normalizeActors(config) {
    const byId = new Map();
    for (const actor of config.actors ?? []) {
        const name = actor.name ?? actor.title;
        const item = {
            id: actor.id ?? stableId('actor', name),
            name,
            title: actor.title ?? humanize(name)
        };
        byId.set(item.id, item);
    }
    for (const slice of config.slices ?? []) {
        for (const actor of slice.actors ?? []) {
            const name = actor.name ?? actor.title;
            const item = {
                id: actor.id ?? stableId('actor', name),
                name,
                title: actor.title ?? humanize(name)
            };
            byId.set(item.id, item);
        }
    }
    return Array.from(byId.values());
}

function normalizeSlices(config, aggregates, contexts, actors, valueTypes) {
    return (config.slices ?? []).map((slice, index) => {
        const context = slice.context ?? slice.chapter ?? config.context ?? primaryContextName({ contexts });
        const aggregate = normalizeAggregateRef(slice.aggregates?.[0] ?? findAggregateForSlice(slice, aggregates));
        return {
            id: slice.id ?? stableId('slice', slice.title ?? index),
            index: slice.index ?? index,
            name: slice.name ?? toIdentifier(slice.title ?? `Slice${index + 1}`),
            title: cleanTitle(slice.title ?? slice.name ?? `Slice ${index + 1}`),
            chapter: slice.chapter ?? context,
            context,
            concepts: slice.concepts ?? [],
            aggregate,
            commands: normalizeElements(slice.commands, 'COMMAND', slice, aggregate, valueTypes),
            events: normalizeElements(slice.events, 'EVENT', slice, aggregate, valueTypes),
            readmodels: normalizeElements(slice.readmodels, 'READMODEL', slice, aggregate, valueTypes),
            screens: normalizeElements(slice.screens, 'SCREEN', slice, aggregate, valueTypes),
            processors: normalizeElements(slice.processors, 'PROCESSOR', slice, aggregate, valueTypes),
            specifications: slice.specifications ?? [],
            actors: slice.actors ?? [],
            hotspots: slice.hotspots ?? [],
            ...(slice.stateChange ? { stateChange: slice.stateChange } : {})
        };
    });
}

function normalizeTransitions(transitions = [], slices = [], concepts = [], aggregates = []) {
    const conceptsByName = new Map(concepts.map((concept) => [concept.name, concept]));
    const aggregatesByName = new Map(aggregates.map((aggregate) => [aggregate.name, aggregate]));
    const slicesById = new Map(slices.map((slice) => [slice.id, slice]));
    const slicesByName = new Map(slices.map((slice) => [slice.name, slice]));

    return transitions.map((transition, index) => {
        const slice = transition.slice?.id
            ? slicesById.get(transition.slice.id)
            : slicesByName.get(transition.slice?.name);
        const ownerName = transition.owner?.name ?? transition.concept ?? transition.aggregate;
        const ownerType = transition.owner?.type ?? (conceptsByName.has(ownerName) ? 'concept' : 'aggregate');
        const owner = ownerType === 'concept'
            ? conceptsByName.get(ownerName)
            : aggregatesByName.get(ownerName);
        return {
            ...transition,
            id: transition.id ?? stableId('transition', `${ownerName ?? 'owner'}/${slice?.name ?? index}`),
            context: transition.context ?? slice?.context ?? owner?.context,
            owner: {
                id: transition.owner?.id ?? owner?.id ?? stableId(ownerType, ownerName ?? index),
                type: ownerType,
                name: ownerName,
                title: transition.owner?.title ?? owner?.title ?? humanize(ownerName)
            },
            slice: transition.slice ?? (slice ? {id: slice.id, name: slice.name, title: slice.title} : undefined),
            startsLifecycle: Boolean(transition.startsLifecycle)
        };
    });
}

function normalizeElements(elements = [], type, slice, sliceAggregate, valueTypes) {
    return elements.map((element) => {
        const aggregate = normalizeAggregateRef(element.aggregate ?? element.aggregateName ?? element.aggregateDependencies?.[0] ?? sliceAggregate);
        return {
            ...element,
            id: element.id ?? stableId(type.toLowerCase(), element.title ?? element.name),
            name: element.name ?? toIdentifier(element.title),
            title: cleanTitle(element.title ?? element.name),
            type: element.type ?? type,
            modelContext: element.modelContext ?? slice.context,
            slice: element.slice ?? slice.title,
            concept: element.concept ?? element.concepts?.[0] ?? slice.concepts?.[0],
            aggregate: aggregate?.name,
            aggregateRef: aggregate,
            aggregateDependencies: element.aggregateDependencies ?? (aggregate?.title ? [aggregate.title] : []),
            fields: normalizeFields(element.fields ?? [], valueTypes),
            dependencies: normalizeDependencies(element.dependencies ?? []),
            startsLifecycle: element.startsLifecycle ?? element.createsAggregate ?? false
        };
    });
}

function normalizeFields(fields, valueTypes = []) {
    const byName = new Map(valueTypes.map((valueType) => [valueType.name, valueType]));
    return fields.map((field) => ({
        ...field,
        name: field.name,
        type: field.type ?? 'String',
        cardinality: field.cardinality ?? 'Single',
        optional: !!field.optional,
        idAttribute: !!field.idAttribute,
        generated: !!field.generated,
        technicalAttribute: !!field.technicalAttribute,
        query: !!field.query,
        file: !!field.file,
        ...(byName.has(field.type) ? { valueType: byName.get(field.type) } : {}),
        ...(field.mappings && !field.source ? { source: field.mappings[0] } : {})
    }));
}

function normalizeDependencies(dependencies) {
    return dependencies.map((dependency) => ({
        ...dependency,
        direction: dependency.direction ?? dependency.type,
        type: dependency.type ?? dependency.direction,
        elementType: dependency.elementType,
        id: dependency.id,
        title: dependency.title
    }));
}

function normalizeAggregateRefs(aggregates) {
    return aggregates.map(normalizeAggregateRef).filter(Boolean);
}

function normalizeAggregateRef(aggregate) {
    if (!aggregate) {
        return undefined;
    }
    if (typeof aggregate === 'string') {
        return {
            id: stableId('aggregate', aggregate),
            name: aggregate,
            title: cleanTitle(aggregate)
        };
    }
    const name = aggregate.name ?? aggregate.title;
    return {
        id: aggregate.id ?? stableId('aggregate', name),
        name,
        title: aggregate.title ?? humanize(name)
    };
}

function findAggregateForSlice(slice, aggregates) {
    const candidates = [
        slice.aggregate,
        slice.aggregateName,
        ...(slice.aggregates ?? []).map((aggregate) => aggregate.title ?? aggregate.name ?? aggregate)
    ].filter(Boolean).map((value) => cleanTitle(value).toLowerCase());

    return aggregates.find((aggregate) => {
        return candidates.includes(cleanTitle(aggregate.title ?? aggregate.name).toLowerCase());
    });
}

function findContextForAggregate(aggregateTitle, contexts) {
    const normalizedTitle = cleanTitle(aggregateTitle).toLowerCase();
    return contexts.find((context) => {
        return normalizeAggregateRefs(context.aggregates ?? [])
            .map((aggregate) => cleanTitle(aggregate.title ?? aggregate.name).toLowerCase())
            .includes(normalizedTitle);
    })?.name;
}

function aggregatesForContext(config, contextName) {
    const titles = unique((config.slices ?? [])
        .filter((slice) => (slice.context ?? slice.chapter) === contextName)
        .flatMap((slice) => slice.aggregates ?? [])
        .map((aggregate) => aggregate.title ?? aggregate.name ?? aggregate));

    if (titles.length === 0) {
        return config.aggregates ?? [];
    }

    return (config.aggregates ?? []).filter((aggregate) => {
        const title = aggregate.title ?? aggregate.name;
        return titles.includes(title) || titles.includes(aggregate.name);
    });
}

function stableId(prefix, value) {
    const input = String(value ?? prefix);
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
    }
    return `${prefix}-${Math.abs(hash).toString(16)}`;
}

function humanize(value) {
    return cleanTitle(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanTitle(value) {
    return String(value ?? '')
        .replace(/^(screen|slice|spec|command|readmodel|projection)\s*:\s*/i, '')
        .trim();
}

function toIdentifier(value) {
    const title = humanize(value).replace(/\s+/g, '');
    return title ? title.charAt(0).toLowerCase() + title.slice(1) : 'item';
}

function unique(values) {
    return Array.from(new Set(values));
}

module.exports = {
    fromCodegenModel,
    fromConfig,
    toGeneratorConfig,
    primaryContextName
};
