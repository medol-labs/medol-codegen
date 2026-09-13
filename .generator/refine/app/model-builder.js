/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {uniqueChapters, buildI18nModel, normalizeFields, axonRoute, cleanTitle, titleCase, pascal, constant} = require('./model-utils');
const {buildBackendModules, backendModuleForContext, withModuleResourceRoutes} = require('./backend-modules');
const {buildDomainModel, withResolvedValueTypes} = require('./domain-model');
const {buildWorkflowModel} = require('./workflow-model');
const {toReadModelResource, uniqueResourceNames} = require('./resource-model');
const {withChapterI18n, withResourceI18n} = require('./i18n-model');
const {buildCommandChoices, normalizeSelectedCommands} = require('./command-selection');
const {aggregateName} = require('./resource-naming');

function buildFrontendModel(source, selectedCommandKeys, options = {}) {
    source = withResolvedValueTypes(source);
    source = withStateFieldOptions(source);
    assertKnownFrontendApplication(source, options.frontendApp);
    const frontendApplication = selectFrontendApplication(source, options.frontendApp);
    const frontendSource = projectSourceForFrontendApplication(source, frontendApplication);
    const slices = frontendSource.slices ?? [];
    const allAggregates = source.aggregates ?? [];
    const allContexts = source.contexts ?? source.context ?? [];
    const allEvents = slices.flatMap((slice) => slice.events ?? []);
    const selected = selectedCommandKeys ? new Set(selectedCommandKeys) : null;
    const backendModules = buildBackendModules(source);
    const backendModuleForSlice = buildFrontendBackendModuleResolver(frontendApplication, backendModules);
    const workflow = buildWorkflowModel(slices, allAggregates, allContexts, selected, backendModules, source.transitions ?? [], backendModuleForSlice);
    const resources = withResourceI18n(uniqueResourceNames(slices
        .flatMap((slice) => (slice.readmodels ?? [])
            .filter((readModel) => readModel?.title && readModel.listElement)
            .map((readModel) => toReadModelResource({
                ...aggregateName(readModel, slice, allAggregates, allContexts),
                deployment: backendModuleForSlice(slice),
                slice,
                commands: workflow.commandsForReadModel(readModel),
                producerCommandKeys: workflow.producerCommandKeys(readModel),
                itemCommandKeys: workflow.itemCommandKeys(readModel)
            }, readModel, allEvents, workflow)))
        .filter(Boolean)));
    const modules = withModuleResourceRoutes(backendModules, resources);
    const chapters = withChapterI18n(uniqueChapters(resources.map((resource) => resource.chapter).filter(Boolean)));
    const i18n = buildI18nModel(frontendSource, chapters, resources);
    const fileUploadCapability = buildFileUploadCapability(slices, allAggregates, allContexts, backendModules, backendModuleForSlice);
    const authBackendModule = buildAuthBackendModule(modules);

    return {
        appName: frontendApplication?.title ?? source.domain ?? 'Event Sourcing App',
        frontendApplication,
        frontendSource,
        backendModules: modules,
        authBackendModule,
        fileUploadCapability,
        chapters,
        resources: resources.sort((a, b) => a.route.localeCompare(b.route)),
        i18n
    };
}

function assertKnownFrontendApplication(source, name) {
    if (!name || `${name}`.trim() === '' || `${name}` === '__all__') {
        return;
    }
    if (selectFrontendApplication(source, name)) {
        return;
    }
    const available = (source.frontendApplications ?? []).map((application) => application.name).filter(Boolean);
    throw new Error(`Unknown frontend application "${name}". Available frontend applications: ${available.join(', ') || '(none)'}.`);
}

function buildFrontendApplicationChoices(source) {
    return (source.frontendApplications ?? [])
        .filter((application) => application?.name)
        .map((application) => ({
            name: cleanTitle(application.title ?? application.name),
            value: application.name
        }));
}

function buildFrontendBackendModuleResolver(application, backendModules) {
    const backendByContext = new Map();
    for (const context of application?.contexts ?? []) {
        const contextName = contextNameOf(context);
        if (!contextName || !context.backend) {
            continue;
        }
        const backendModule = backendModuleByName(context.backend, backendModules);
        if (backendModule) {
            backendByContext.set(contextName, backendModule);
        }
    }

    return (slice) => {
        const contextName = slice.context ?? slice.chapter;
        return backendByContext.get(contextName) ?? backendModuleForContext(contextName, backendModules);
    };
}

function backendModuleByName(name, backendModules) {
    const normalized = normalizeName(name);
    return backendModules.find((module) =>
        normalizeName(module.name) === normalized
        || normalizeName(module.label) === normalized
        || normalizeName(module.dataProviderName) === normalized
    );
}

function selectFrontendApplication(source, name) {
    const applications = source.frontendApplications ?? [];
    if (!name || `${name}`.trim() === '' || `${name}` === '__all__') {
        return undefined;
    }

    const normalized = normalizeName(name);
    return applications.find((application) =>
        normalizeName(application.name) === normalized
        || normalizeName(application.title) === normalized
    );
}

function projectSourceForFrontendApplication(source, application) {
    if (!application) {
        return source;
    }

    const includeRules = new Map();
    for (const context of application.contexts ?? []) {
        const contextName = contextNameOf(context);
        if (!contextName) {
            continue;
        }

        const slices = normalizeContextSlices(context);
        const current = includeRules.get(contextName) ?? new Set();
        if (slices.length === 0) {
            includeRules.set(contextName, null);
            continue;
        }
        if (current === null) {
            continue;
        }
        slices.forEach((slice) => current.add(slice));
        includeRules.set(contextName, current);
    }

    if (includeRules.size === 0) {
        return source;
    }

    const includesContext = (contextName) => {
        return includeRules.has(contextName);
    };
    const includesSlice = (slice) => {
        const contextName = slice.context ?? slice.chapter;
        const rule = includeRules.get(contextName);
        return rule === null || (rule instanceof Set && rule.has(slice.name ?? slice.title));
    };

    return {
        ...source,
        contexts: (source.contexts ?? []).filter((context) => includesContext(context.name ?? context.title)),
        slices: (source.slices ?? []).filter(includesSlice),
        frontendApplications: [application]
    };
}

function contextNameOf(context) {
    return typeof context === 'string' ? context : (context?.name ?? context?.title);
}

function normalizeContextSlices(context) {
    if (!context || typeof context === 'string') {
        return [];
    }
    return (context.slices ?? [])
        .map((slice) => typeof slice === 'string' ? slice : (slice?.name ?? slice?.title))
        .filter(Boolean);
}

function normalizeName(value) {
    return `${value ?? ''}`.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function buildAuthBackendModule(backendModules) {
    return backendModules.find((module) => (module.contexts ?? []).includes('IdentityAccessManagement'))
        ?? backendModules[0]
        ?? {
            name: 'default',
            label: 'Backend',
            dataProviderName: 'command',
            envName: 'VITE_AXON_API_URL',
            defaultApiUrl: 'http://localhost:8080',
            apiUrl: 'http://localhost:8080'
        };
}

function withStateFieldOptions(source) {
    const stateOptionsByType = buildStateOptionsByType(source);
    if (stateOptionsByType.size === 0) {
        return source;
    }

    const enrichFields = (fields = []) => fields.forEach((field) => {
        if (!field?.name) {
            return;
        }

        const options = stateOptionsByType.get(field.type);
        if (options && !field.optionSet && !field.options && !field.enumOptions) {
            field.enumOptions = options;
        }

        if (field.valueType?.fields) {
            enrichFields(field.valueType.fields);
        }
    });

    (source.slices ?? []).forEach((slice) => {
        (slice.commands ?? []).forEach((command) => enrichFields(command.fields));
        (slice.events ?? []).forEach((event) => enrichFields(event.fields));
        (slice.readmodels ?? []).forEach((readModel) => enrichFields(readModel.fields));
    });
    (source.valueTypes ?? []).forEach((valueType) => enrichFields(valueType.fields));

    return source;
}

function buildStateOptionsByType(source) {
    const stateOptionsByType = new Map();
    const concepts = [
        ...(source.concepts ?? []),
        ...(source.contexts ?? []).flatMap((context) => context.concepts ?? []),
        ...(source.slices ?? []).flatMap((slice) => slice.concepts ?? [])
    ];

    concepts
        .filter((concept) => concept?.name && (concept.states ?? []).length > 0)
        .forEach((concept) => {
            const options = concept.states.map((state) => ({
                value: constant(state),
                label: titleCase(state)
            }));
            [
                `${concept.name}.State`,
                `${concept.title}.State`,
                `${cleanTitle(concept.name)}.State`,
                `${cleanTitle(concept.title)}.State`,
                `${pascal(concept.name)}.State`,
                `${pascal(concept.title)}.State`
            ].filter(Boolean).forEach((type) => stateOptionsByType.set(type, options));
        });

    return stateOptionsByType;
}

function buildFileUploadCapability(slices, aggregates, contexts, backendModules, backendModuleForSlice) {
    const candidates = slices
        .flatMap((slice) => (slice.commands ?? []).map((command) => ({slice, command})))
        .map(({slice, command}) => {
            const rawFields = command.fields ?? [];
            const fields = normalizeFields(rawFields);
            const fileField = fields.find((field) => field.uploadFile)
                ?? rawFields.find((field) => field.uploadFile);
            const idField = rawFields.find((field) => field.generated && field.idAttribute);

            if (!fileField || !idField) {
                return null;
            }

            const aggregate = aggregateName({
                title: command.concept ?? command.aggregateName ?? command.aggregate ?? command.title
            }, slice, aggregates, contexts);
            const deployment = backendModuleForSlice(slice);
            return {
                dataProviderName: deployment.dataProviderName,
                aggregateRoute: axonRoute(cleanTitle(aggregate.title)),
                commandRoute: axonRoute(cleanTitle(command.title)),
                fileField: fileField.name,
                idField: idField.name,
                additionalFields: fields
                    .filter((field) => field.name !== fileField.name && field.name !== idField.name)
                    .filter((field) => !field.generated && !field.optional && !field.technicalAttribute && !field.uploadFile)
                    .map((field) => ({
                        name: field.name,
                        type: field.type ?? 'String'
                    }))
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.dataProviderName.localeCompare(right.dataProviderName)
            || left.aggregateRoute.localeCompare(right.aggregateRoute)
            || left.commandRoute.localeCompare(right.commandRoute));

    const capability = candidates[0];
    if (!capability) {
        return null;
    }

    return {
        dataProviderName: capability.dataProviderName,
        path: `/${capability.aggregateRoute}/${capability.commandRoute}/file`,
        fileField: capability.fileField,
        idField: capability.idField,
        additionalFields: capability.additionalFields ?? []
    };
}

module.exports = {
    buildFrontendModel,
    buildFrontendApplicationChoices,
    projectSourceForFrontendApplication,
    buildDomainModel,
    buildCommandChoices,
    normalizeSelectedCommands
};
