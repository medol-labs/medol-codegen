/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

var Generator = require('yeoman-generator').default;
var path = require('path');
var slugify = require('slugify');
const {loadGeneratorModel} = require("../../common/core/config-loader");

let config = {};
let codegenModel = {};

module.exports = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = { ...(opts ?? {}), skipInstall: true };
        this.options.skipInstall = true;
        if (this.env?.options) {
            this.env.options.skipInstall = true;
        }
        this.argument('appname', { type: String, required: false });

        const loaded = loadGeneratorModel(this.env.cwd);
        config = loaded.config;
        codegenModel = loaded.codegenModel;
    }

    async prompting() {
        const prompts = [];
        const commandChoices = buildCommandChoices(codegenModel);

        if (!this.opts.generatorType) {
            prompts.push({
                type: 'list',
                name: 'generatorType',
                message: 'What frontend code should be generated?',
                choices: ['Skeleton', 'all', 'resources', 'router', 'pages'],
                default: 'Skeleton'
            });
        }

        if (!this.opts.commands && !this.opts.allCommands) {
            prompts.push({
                type: 'checkbox',
                name: 'commands',
                loop: false,
                message: 'Choose Commands to generate?',
                choices: commandChoices,
                default: commandChoices.map((choice) => choice.value),
                when: (answers) => {
                    const generatorType = answers.generatorType ?? this.opts.generatorType ?? 'all';
                    return generatorType !== 'Skeleton' && commandChoices.length > 0;
                }
            });
        }

        this.answers = {
            generatorType: this.opts.generatorType ?? 'all',
            force: this.opts.force ?? true,
            commands: this.opts.commands,
            allCommands: this.opts.allCommands,
            ...(await this.prompt(prompts))
        };
    }

    writing() {
        if (!this.answers.force) {
            this.log('Skipped refine generation.');
            return;
        }

        if (this.answers.generatorType === 'Skeleton') {
            this._writeSkeleton();
            const model = buildFrontendModel(codegenModel);
            this._writeDomainModel(buildDomainModel(codegenModel));
            this._writeI18n(model.i18n);
            return;
        }

        const selectedCommandKeys = this.answers.allCommands
            ? undefined
            : normalizeSelectedCommands(this.answers.commands);
        const model = buildFrontendModel(codegenModel, selectedCommandKeys);
        this._writeDomainModel(buildDomainModel(codegenModel));
        this._writeI18n(model.i18n);

        if (this.answers.generatorType === 'all' || this.answers.generatorType === 'resources') {
            this._writeResources(model);
        }

        if (this.answers.generatorType === 'all' || this.answers.generatorType === 'router') {
            this._writeRouter(model);
        }

        if (this.answers.generatorType === 'all' || this.answers.generatorType === 'pages') {
            model.resources.forEach((resource) => this._writePages(resource));
        }
    }

    _writeResources(model) {
        this.fs.copyTpl(
            this.templatePath('src/providers/resources.tsx.tpl'),
            this.destinationPath('./src/providers/resources.tsx'),
            model
        );
    }

    _writeRouter(model) {
        this.fs.copyTpl(
            this.templatePath('src/providers/app-router.tsx.tpl'),
            this.destinationPath('./src/providers/app-router.tsx'),
            model
        );
    }

    _writePages(resource) {
        const basePath = `./src/pages/${resource.route}`;

        this.fs.copyTpl(
            this.templatePath('src/pages/index.ts.tpl'),
            this.destinationPath(`${basePath}/index.ts`),
            { resource }
        );
        if (resource.canList) {
            this.fs.copyTpl(
                this.templatePath('src/pages/list.tsx.tpl'),
                this.destinationPath(`${basePath}/list.tsx`),
                { resource }
            );
        }
        this.fs.copyTpl(
            this.templatePath('src/pages/show.tsx.tpl'),
            this.destinationPath(`${basePath}/show.tsx`),
            { resource }
        );

        if (resource.createCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/${resource.createCommand.file}.tsx`),
                { resource, command: resource.createCommand }
            );
        }

        if (resource.editCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/edit.tsx`),
                { resource, command: resource.editCommand }
            );
        }

        if (resource.deleteCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/${resource.deleteCommand.file}.tsx`),
                { resource, command: resource.deleteCommand }
            );
        }

        resource.itemCommands.forEach((command) => {
            this.fs.copyTpl(
                this.templatePath('src/pages/command-form.tsx.tpl'),
                this.destinationPath(`${basePath}/${command.file}.tsx`),
                { resource, command }
            );
        });
    }

    _writeDomainModel(model) {
        this.fs.copyTpl(
            this.templatePath('src/domain/value-types.ts.tpl'),
            this.destinationPath('./src/domain/value-types.ts'),
            model
        );
        this.fs.copyTpl(
            this.templatePath('src/domain/schemas.ts.tpl'),
            this.destinationPath('./src/domain/schemas.ts'),
            model
        );
    }

    _writeI18n(model) {
        this.fs.copyTpl(
            this.templatePath('src/i18n/messages.ts.tpl'),
            this.destinationPath('./src/i18n/messages.ts'),
            model
        );
    }

    _writeSkeleton() {
        this.fs.copyTpl(
            this.templatePath('root'),
            this.destinationPath('.'),
            {
                appName: codegenModel?.domain ?? 'frontend-foundation'
            }
        );
        ['.env-example', '.gitignore', '.npmrc'].forEach((file) => {
            this.fs.copyTpl(
                this.templatePath(`root/${file}`),
                this.destinationPath(file),
                {
                    appName: codegenModel?.domain ?? 'frontend-foundation'
                }
            );
        });
        this._writeAgentSkills();
    }

    _writeAgentSkills() {
        const agentTemplates = path.resolve(__dirname, '../../common/agent-templates');
        this.fs.copy(agentTemplates, this.destinationPath('.agent'));
    }
};

function buildFrontendModel(source, selectedCommandKeys) {
    source = withResolvedValueTypes(source);
    const slices = source.slices ?? [];
    const allAggregates = source.aggregates ?? [];
    const allContexts = source.contexts ?? source.context ?? [];
    const allEvents = slices.flatMap((slice) => slice.events ?? []);
    const selected = selectedCommandKeys ? new Set(selectedCommandKeys) : null;
    const backendModules = buildBackendModules(source);
    const workflow = buildWorkflowModel(slices, allAggregates, allContexts, selected, backendModules, source.transitions ?? []);
    const resources = withResourceI18n(uniqueResourceNames(slices
        .flatMap((slice) => (slice.readmodels ?? [])
            .filter((readModel) => readModel?.title && readModel.listElement)
            .map((readModel) => toReadModelResource({
                ...aggregateName(readModel, slice, allAggregates, allContexts),
                deployment: backendModuleForContext(slice.context ?? slice.chapter, backendModules),
                slice,
                commands: workflow.commandsForReadModel(readModel),
                producerCommandKeys: workflow.producerCommandKeys(readModel),
                itemCommandKeys: workflow.itemCommandKeys(readModel)
            }, readModel, allEvents, workflow)))
        .filter(Boolean)));
    const modules = withModuleResourceRoutes(backendModules, resources);
    const chapters = withChapterI18n(uniqueChapters(resources.map((resource) => resource.chapter).filter(Boolean)));
    const i18n = buildI18nModel(source, chapters, resources);

    return {
        appName: source.domain ?? 'Event Sourcing App',
        backendModules: modules,
        chapters,
        resources: resources.sort((a, b) => a.route.localeCompare(b.route)),
        i18n
    };
}

function buildBackendModules(source) {
    const deployments = normalizeArray(source.deployments);
    if (deployments.length === 0) {
        return [{
            name: 'default',
            label: 'Backend',
            dataProviderName: 'command',
            envName: 'VITE_AXON_API_URL',
            defaultApiUrl: 'http://localhost:8080',
            contexts: new Set((source.contexts ?? []).map((context) => context.name).filter(Boolean))
        }];
    }

    return deployments.map((deployment, index) => {
        const label = cleanTitle(deployment.title ?? deployment.name) || `Backend ${index + 1}`;
        const dataProviderName = kebab(deployment.title ?? deployment.name ?? label) || `backend-${index + 1}`;
        return {
            name: dataProviderName,
            label,
            dataProviderName,
            envName: `VITE_${snakeCase(dataProviderName).toUpperCase()}_API_URL`,
            defaultApiUrl: `http://localhost:${8080 + index}`,
            contexts: new Set(normalizeArray(deployment.contexts)
                .map((context) => typeof context === 'string' ? context : context.name)
                .filter(Boolean))
        };
    });
}

function backendModuleForContext(contextName, modules) {
    return modules.find((module) => module.contexts.has(contextName)) ?? modules[0];
}

function withModuleResourceRoutes(modules, resources) {
    return modules.map((module) => {
        const moduleResources = resources
            .filter((resource) => resource.dataProviderName === module.dataProviderName)
            .map((resource) => resource.route)
            .sort((a, b) => a.localeCompare(b));
        return {
            ...module,
            contexts: Array.from(module.contexts),
            resourceRoutes: moduleResources,
            homeRoute: moduleResources[0] ? `/${moduleResources[0]}` : '/dashboard'
        };
    });
}

function buildDomainModel(source) {
    source = withResolvedValueTypes(source);
    const valueTypes = (source.valueTypes ?? []).map((valueType) => ({
        ...valueType,
        tsBaseType: tsValueType(valueType),
        schema: zodValueTypeExpression(valueType)
    }));
    const commands = uniqueCommands((source.slices ?? []).flatMap((slice) => slice.commands ?? []))
        .filter((command) => command?.title)
        .map((command) => {
            const component = pascal(cleanTitle(command.title));
            return {
                name: component,
                schemaName: `${component}CommandSchema`,
                inputTypeName: `${component}CommandInput`,
                fields: normalizeFields(command.fields).map((field) => ({
                    ...field,
                    schema: zodFieldExpression(field)
                }))
            };
        });
    return {valueTypes, commands};
}

function withResolvedValueTypes(source) {
    const valueTypesByName = new Map((source.valueTypes ?? []).map((valueType) => [valueType.name, valueType]));
    const enrichField = (field) => ({
        ...field,
        valueType: field.valueType ?? valueTypesByName.get(field.type)
    });
    const enrichValueType = (valueType) => ({
        ...valueType,
        fields: (valueType.fields ?? []).map(enrichField)
    });
    const valueTypes = (source.valueTypes ?? []).map(enrichValueType);
    const slices = (source.slices ?? []).map((slice) => ({
        ...slice,
        commands: (slice.commands ?? []).map((command) => ({
            ...command,
            fields: (command.fields ?? []).map(enrichField)
        })),
        events: (slice.events ?? []).map((event) => ({
            ...event,
            fields: (event.fields ?? []).map(enrichField)
        })),
        readmodels: (slice.readmodels ?? []).map((readModel) => ({
            ...readModel,
            fields: (readModel.fields ?? []).map(enrichField)
        }))
    }));
    return {...source, valueTypes, slices};
}

function uniqueCommands(commands) {
    const byName = new Map();
    commands.filter(Boolean).forEach((command) => {
        if (!byName.has(command.name)) {
            byName.set(command.name, command);
        }
    });
    return Array.from(byName.values());
}

function buildWorkflowModel(slices, aggregates, contexts, selectedCommands, backendModules, transitions = []) {
    const selectableReadModels = new Map();
    const commandsById = new Map();
    const eventsById = new Map();
    const producerCommandsByReadModelId = new Map();
    const nextCommandsByReadModelId = new Map();
    const transitionsByCommandId = new Map();

    transitions
        .filter((transition) => transition?.command)
        .forEach((transition) => {
            const keys = [
                transition.command.id,
                transition.command.name,
                transition.command.title
            ].filter(Boolean);
            keys.forEach((key) => transitionsByCommandId.set(String(key), transition));
        });

    slices.flatMap((slice) => slice.commands ?? [])
        .filter((command) => command?.title)
        .filter((command) => !selectedCommands || selectedCommands.has(commandKey(command)))
        .forEach((command) => {
            commandsById.set(commandKey(command), command);
            if (command.id) {
                commandsById.set(command.id, command);
            }
        });

    slices.flatMap((slice) => slice.events ?? [])
        .filter((event) => event?.title)
        .forEach((event) => {
            eventsById.set(String(event.title), event);
            if (event.id) {
                eventsById.set(event.id, event);
            }
        });

    slices.flatMap((slice) => (slice.readmodels ?? []).map((readModel) => ({readModel, slice})))
        .filter(({readModel}) => readModel?.title && readModel.listElement)
        .forEach(({readModel, slice}) => {
            const id = idFieldName(readModel);
            if (!id || selectableReadModels.has(id)) {
                return;
            }

            const aggregate = aggregateName(readModel, { title: readModel.slice }, aggregates, contexts);
            const deployment = backendModuleForContext(slice.context ?? slice.chapter, backendModules);
            const optionLabel = optionLabelField(readModel);
            selectableReadModels.set(id, {
                resource: snake(cleanTitle(readModel.title)),
                dataProviderName: deployment.dataProviderName,
                optionValue: id,
                optionLabel,
                meta: {
                    idField: id,
                    label: cleanTitle(readModel.title),
                    aggregateRoute: axonRoute(aggregate.title),
                    queryRoute: axonRoute(readModel.title)
                }
            });
        });

    slices.flatMap((slice) => slice.readmodels ?? [])
        .filter((readModel) => readModel?.title)
        .forEach((readModel) => {
            const inboundEventIds = (readModel.dependencies ?? [])
                .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'EVENT')
                .map((dependency) => dependency.id ?? String(dependency.title ?? ''));
            const inboundEvents = inboundEventIds
                .map((eventId) => eventsById.get(eventId))
                .filter(Boolean);
            const producerCommands = uniqueElements(inboundEvents
                .flatMap((event) => (event.dependencies ?? [])
                    .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'COMMAND')
                    .map((dependency) => commandsById.get(dependency.id) ?? commandsById.get(String(dependency.title ?? '')))
                    .filter(Boolean)));
            const nextCommands = uniqueElements(inboundEvents
                .flatMap((event) => (event.dependencies ?? [])
                    .filter((dependency) => dependencyDirection(dependency) === 'OUTBOUND' && dependency.elementType === 'COMMAND')
                    .map((dependency) => commandsById.get(dependency.id) ?? commandsById.get(String(dependency.title ?? '')))
                    .filter(Boolean)));

            if (producerCommands.length > 0) {
                producerCommandsByReadModelId.set(readModel.id, producerCommands);
            }
            if (nextCommands.length > 0) {
                nextCommandsByReadModelId.set(readModel.id, nextCommands);
            }
        });

    return {
        selectableReadModels,
        commandsForReadModel(readModel) {
            return uniqueElements([
                ...(producerCommandsByReadModelId.get(readModel.id) ?? []),
                ...(nextCommandsByReadModelId.get(readModel.id) ?? [])
            ]);
        },
        producerCommandKeys(readModel) {
            return new Set((producerCommandsByReadModelId.get(readModel.id) ?? []).map(commandKey));
        },
        itemCommandKeys(readModel) {
            return new Set((nextCommandsByReadModelId.get(readModel.id) ?? []).map(commandKey));
        },
        stateControlForCommand(command, readModel) {
            const transition = transitionsByCommandId.get(commandKey(command))
                ?? transitionsByCommandId.get(String(command.name ?? ''))
                ?? transitionsByCommandId.get(String(command.title ?? ''));
            return stateControlForTransition(transition, readModel);
        }
    };
}

function commandWorkflowFields(command, readModel, allEvents, workflow) {
    const inboundEventIds = (command.dependencies ?? [])
        .filter((dependency) => dependencyDirection(dependency) === 'INBOUND' && dependency.elementType === 'EVENT')
        .map((dependency) => dependency.id ?? String(dependency.title ?? ''));
    const inboundEvents = allEvents.filter((event) => inboundEventIds.includes(event.id) || inboundEventIds.includes(event.title));
    const upstreamFieldNames = new Set([
        ...(readModel?.fields ?? []).map((field) => field.name),
        ...inboundEvents.flatMap((event) => event.fields ?? []).map((field) => field.name)
    ]);
    const prefill = new Set();
    const selects = new Map();

    normalizeFields(command.fields)
        .filter((field) => !field.generated)
        .forEach((field) => {
            if (upstreamFieldNames.has(field.name)) {
                prefill.add(field.name);
            }

            const select = workflow.selectableReadModels.get(field.name);
            if (select && !field.idAttribute && isReferenceSelectField(field)) {
                selects.set(field.name, select);
            }
        });

    return { prefill, selects };
}

function toReadModelResource(group, readModel, allEvents, workflow) {
    const aggregateTitle = cleanTitle(group.title);
    const queryTitle = cleanTitle(readModel?.title ?? aggregateTitle);
    const route = kebab(queryTitle);
    const name = snake(queryTitle);
    const component = pascal(queryTitle);
    const queryFields = normalizeFields(readModel?.fields ?? []);
    const fields = queryFields.length > 0
        ? queryFields
        : normalizeFields(group.commands.flatMap((command) => command.fields ?? []));
    const idFields = identifierFields(fields);
    const idField = idFields[0] ?? fields.find((field) => field.name === 'id') ?? fields[0];
    const resourceCommands = uniqueElements(group.commands);
    const deployment = group.deployment;
    let normalizedCommands = resourceCommands
        .filter((command) => command?.title)
        .map((command) => ({
            ...toCommand(command, route, component, readModel, allEvents, workflow),
            dataProviderName: deployment.dataProviderName
        }));
    normalizedCommands = withPrefillFields(normalizedCommands, queryFields);
    normalizedCommands = withActionControlFields(normalizedCommands, queryFields);
    const producerCommandKeys = group.producerCommandKeys ?? new Set();
    const itemCommandKeys = group.itemCommandKeys ?? new Set();
    const producerCommands = normalizedCommands.filter((command) => producerCommandKeys.has(command.id));
    const createCommand = producerCommands.find((command) => command.startsLifecycle && isCreateCommand(command))
        ?? producerCommands.find((command) => command.startsLifecycle);
    const rowCommands = normalizedCommands
        .filter((command) => itemCommandKeys.has(command.id))
        .filter((command) => sharesIdentifierField(command.fields, queryFields));
    const primaryIdField = idField?.name ?? 'id';
    const primaryRowCommands = rowCommands.filter((command) =>
        command.fields.some((field) => field.name === primaryIdField)
    );
    const editCommand = primaryRowCommands.find((command) => isEditCommand(command));
    const deleteCommand = primaryRowCommands.find((command) => isDeleteCommand(command));
    const reservedCommandNames = [createCommand, editCommand, deleteCommand].filter(Boolean).map((command) => command.name);
    const itemCommands = rowCommands
        .filter((command) => !reservedCommandNames.includes(command.name));

    return {
        title: queryTitle,
        aggregateTitle,
        label: queryTitle,
        aggregateRoute: axonRoute(aggregateTitle),
        queryRoute: axonRoute(queryTitle),
        route,
        name,
        tableName: tableName(readModel, queryTitle),
        component,
        chapter: group.chapter,
        moduleName: deployment.name,
        moduleLabel: deployment.label,
        dataProviderName: deployment.dataProviderName,
        idField: idField?.name ?? 'id',
        idFields: (idFields.length > 0 ? idFields : [idField]).filter(Boolean).map((field) => field.name),
        rowIdExpression: rowIdExpression((idFields.length > 0 ? idFields : [idField]).filter(Boolean)),
        readModelId: readModel?.id,
        canList: readModel ? !!readModel.listElement : true,
        fields,
        actionControls: actionControls(queryFields),
        valueTypeImports: Array.from(new Set(fields.map((field) => field.valueType?.name).filter(Boolean))).sort(),
        createCommand,
        editCommand,
        deleteCommand,
        commands: [createCommand, editCommand, deleteCommand, ...itemCommands].filter(Boolean),
        routedCommands: [deleteCommand, ...itemCommands].filter(Boolean),
        itemCommands
    };
}

function sharesIdentifierField(commandFields, readModelFields) {
    const readModelIdentifiers = new Set(readModelFields
        .filter(isIdentifierField)
        .map((field) => field.name));
    return commandFields
        .filter(isIdentifierField)
        .some((field) => readModelIdentifiers.has(field.name));
}

function isIdentifierField(field) {
    return field.idAttribute || field.name === 'id' || field.name?.toLowerCase().endsWith('id');
}

function uniqueResourceNames(resources) {
    const seenNames = new Map();
    return resources.map((resource) => {
        const count = seenNames.get(resource.name) ?? 0;
        seenNames.set(resource.name, count + 1);

        if (count === 0) {
            return resource;
        }

        return {
            ...resource,
            name: `${resource.name}_${resource.aggregateRoute}`,
            route: `${resource.route}-${resource.aggregateRoute}`,
            component: `${resource.component}${pascal(resource.aggregateTitle)}`,
            createCommand: withResourceComponent(resource.createCommand, `${resource.component}${pascal(resource.aggregateTitle)}`),
            editCommand: withResourceComponent(resource.editCommand, `${resource.component}${pascal(resource.aggregateTitle)}`),
            deleteCommand: withResourceComponent(resource.deleteCommand, `${resource.component}${pascal(resource.aggregateTitle)}`),
            commands: resource.commands.map((command) => withResourceComponent(command, `${resource.component}${pascal(resource.aggregateTitle)}`)),
            routedCommands: resource.routedCommands.map((command) => withResourceComponent(command, `${resource.component}${pascal(resource.aggregateTitle)}`)),
            itemCommands: resource.itemCommands.map((command) => withResourceComponent(command, `${resource.component}${pascal(resource.aggregateTitle)}`))
        };
    });
}

function withChapterI18n(chapters) {
    return chapters.map((chapter) => ({
        ...chapter,
        i18nKey: `chapters.${chapter.name}.label`
    }));
}

function withResourceI18n(resources) {
    return resources.map((resource) => {
        const resourceKey = `resources.${resource.name}`;
        const withCommand = (command) => command ? withCommandI18n(command, resourceKey) : command;
        return {
            ...resource,
            i18nKey: `${resourceKey}.label`,
            fields: resource.fields.map((field) => ({
                ...field,
                i18nKey: `${resourceKey}.fields.${field.name}.label`
            })),
            createCommand: withCommand(resource.createCommand),
            editCommand: withCommand(resource.editCommand),
            deleteCommand: withCommand(resource.deleteCommand),
            commands: resource.commands.map(withCommand),
            routedCommands: resource.routedCommands.map(withCommand),
            itemCommands: resource.itemCommands.map(withCommand)
        };
    });
}

function withCommandI18n(command, resourceKey) {
    const commandKey = `${resourceKey}.commands.${command.name}`;
    return {
        ...command,
        i18nKey: `${commandKey}.label`,
        fields: command.fields.map((field) => withFieldI18n(field, `${commandKey}.fields.${field.name}`)),
        prefillFields: command.prefillFields.map((field) => withFieldI18n(field, `${commandKey}.fields.${field.name}`)),
        workflowPrefillFields: command.workflowPrefillFields.map((field) => withFieldI18n(field, `${commandKey}.fields.${field.name}`))
    };
}

function withFieldI18n(field, fieldKey) {
    return {
        ...field,
        i18nKey: `${fieldKey}.label`,
        placeholderKey: `${fieldKey}.placeholder`,
        requiredKey: `${fieldKey}.required`,
        nestedFields: (field.nestedFields ?? []).map((nestedField) => withFieldI18n(nestedField, `${fieldKey}.fields.${nestedField.name}`))
    };
}

function withResourceComponent(command, resourceComponent) {
    if (!command) {
        return command;
    }

    return {
        ...command,
        pageComponent: `${resourceComponent}${command.component}`
    };
}

function toCommand(command, resourceRoute, resourceComponent, readModel, allEvents, workflow) {
    const title = cleanTitle(command.title);
    const component = pascal(title);
    const normalizedFields = normalizeFields(command.fields).filter((field) => !field.generated);
    const workflowFields = commandWorkflowFields(command, readModel, allEvents, workflow);
    const stateControl = workflow.stateControlForCommand(command, readModel);
    const commandAggregateTitle = cleanTitle(
        command.concept
        ?? command.concepts?.[0]
        ?? command.aggregateName
        ?? command.aggregate
        ?? title
    );
    return {
        id: commandKey(command),
        title,
        label: titleCase(title),
        name: camel(title),
        route: kebab(title),
        file: kebab(title),
        component,
        schemaName: `${component}CommandSchema`,
        inputTypeName: `${component}CommandInput`,
        pageComponent: `${resourceComponent}${component}`,
        resourceRoute,
        aggregateRoute: axonRoute(commandAggregateTitle),
        startsLifecycle: !!(command.startsLifecycle ?? command.createsAggregate),
        allowedStates: stateControl.allowedStates,
        targetState: stateControl.targetState,
        stateField: stateControl.stateField,
        fields: normalizedFields.map((field) => ({
            ...field,
            select: workflowFields.selects.get(field.name) ?? null
        })),
        workflowPrefillFields: normalizedFields.filter((field) => workflowFields.prefill.has(field.name)),
        defaultValueFields: normalizedFields
            .filter((field) => !workflowFields.prefill.has(field.name))
            .filter((field) => field.object || field.list)
            .map((field) => ({
                name: field.name,
                defaultValue: defaultValueExpression(field)
            })),
        hasSelectFields: workflowFields.selects.size > 0,
        hasObjectFields: normalizedFields.some((field) => field.object),
        hasArrayFields: normalizedFields.some((field) => field.list || hasNestedArrayField(field))
    };
}

function withPrefillFields(commands, resourceFields) {
    const resourceFieldNames = new Set(resourceFields.map((field) => field.name));
    return commands.map((command) => ({
        ...command,
        prefillFields: uniqueFields([
            ...command.fields.filter((field) => resourceFieldNames.has(field.name)),
            ...(command.workflowPrefillFields ?? [])
        ]),
        hasSelectFields: command.fields.some((field) => field.select)
    }));
}

function withActionControlFields(commands, resourceFields) {
    return commands.map((command) => ({
        ...command,
        enabledField: findActionControlField(command, resourceFields)
    }));
}

function stateControlForTransition(transition, readModel) {
    const allowedStates = normalizeArray(transition?.from).filter(Boolean);
    const conceptName = transition?.owner?.name ?? transition?.owner?.title;
    return {
        allowedStates,
        targetState: transition?.to,
        stateField: allowedStates.length > 0 ? stateFieldForReadModel(readModel, conceptName) : undefined
    };
}

function stateFieldForReadModel(readModel, conceptName) {
    const fields = normalizeFields(readModel?.fields ?? []);
    const conceptStateType = conceptName ? `${conceptName}.State` : undefined;
    const candidates = [
        fields.find((field) => conceptStateType && field.type === conceptStateType),
        fields.find((field) => field.name === 'state'),
        fields.find((field) => conceptName && field.name === `${camel(conceptName)}State`),
        fields.find((field) => conceptName && field.name === `${camel(conceptName)}Status`),
        fields.find((field) => /Status$/.test(field.name ?? '')),
        fields.find((field) => field.name === 'status')
    ];
    return candidates.filter(Boolean)[0]?.name;
}

function dependencyDirection(dependency) {
    return dependency?.direction ?? dependency?.type;
}

function findActionControlField(command, resourceFields) {
    const fields = new Set(resourceFields.map((field) => field.name));
    const candidates = unique([
        `can${pascal(command.title)}`,
        `can${pascal(command.name)}`,
        ...verbActionCandidates(command.title),
        ...verbActionCandidates(command.name),
        ...verbObjectActionCandidates(command.title),
        ...verbObjectActionCandidates(command.name)
    ]);
    return candidates.find((candidate) => fields.has(candidate));
}

function verbActionCandidates(value) {
    const words = titleCase(value).split(/\s+/).filter(Boolean);
    return words.length > 0 ? [`can${pascal(words[0])}`] : [];
}

function verbObjectActionCandidates(value) {
    const words = titleCase(value).split(/\s+/).filter(Boolean);
    if (words.length < 2) {
        return [];
    }
    return [`can${pascal(words[0])}${pascal(words[words.length - 1])}`];
}

function actionControls(fields) {
    return {
        availableActionsField: fields.find((field) => field.name === 'availableActions')?.name,
        blockedReasonField: fields.find((field) => field.name === 'blockedReason')?.name,
        enabledFields: fields.filter((field) => /^can[A-Z]/.test(field.name)).map((field) => field.name)
    };
}

function buildCommandChoices(source) {
    const slices = source.slices ?? [];
    const choicesByKey = new Map();

    slices.forEach((slice) => {
        (slice.commands ?? [])
            .filter((command) => command?.title)
            .forEach((command) => {
                const key = commandKey(command);
                if (!choicesByKey.has(key)) {
                    choicesByKey.set(key, {
                        name: `${aggregateName(command, slice, source.aggregates ?? [], source.contexts ?? source.context ?? []).title} -> ${cleanTitle(command.title)}`,
                        value: key,
                        checked: true
                    });
                }
            });
    });

    return Array.from(choicesByKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSelectedCommands(commands) {
    if (!commands) {
        return undefined;
    }
    if (Array.isArray(commands)) {
        return commands;
    }
    return String(commands)
        .split(',')
        .map((command) => command.trim())
        .filter(Boolean);
}

function commandKey(command) {
    return String(command.id ?? command.title);
}

function aggregateName(command, slice, aggregates = [], contexts = []) {
    const title = cleanTitle(
        command.concept
        ?? command.concepts?.[0]
        ?? slice?.concepts?.[0]
        ?? command.aggregateName
        ?? command.aggregate
        ?? slice?.title
        ?? 'app'
    );
    const aggregate = findAggregate(command, title, aggregates);
    const context = contextName(
        command.modelContext
        ?? aggregate?.modelContext
        ?? findContextForAggregate(title, contexts)
        ?? slice?.context
        ?? slice?.modelContext
    );

    return {
        key: kebab(title),
        title,
        chapter: context
    };
}

function findContextForAggregate(aggregateTitle, contexts) {
    const normalizedAggregateTitle = cleanTitle(aggregateTitle).toLowerCase();
    return normalizeArray(contexts).find((context) => {
        return normalizeArray(context?.aggregates)
            .map((aggregate) => cleanTitle(typeof aggregate === 'string' ? aggregate : aggregate.title ?? aggregate.name).toLowerCase())
            .includes(normalizedAggregateTitle);
    });
}

function normalizeArray(value) {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function findAggregate(command, title, aggregates) {
    const candidates = [
        command.aggregate,
        command.aggregateName,
        ...(command.aggregateDependencies ?? []),
        title
    ].filter(Boolean).map((value) => cleanTitle(value).toLowerCase());

    return aggregates.find((aggregate) => {
        const aggregateTitle = cleanTitle(aggregate.title ?? aggregate.name).toLowerCase();
        return candidates.includes(aggregateTitle);
    });
}

function contextName(value) {
    if (!value) {
        return null;
    }

    const title = cleanTitle(typeof value === 'string' ? value : value.title ?? value.name ?? value.label);
    if (!title) {
        return null;
    }

    return {
        name: kebab(title),
        label: titleCase(title)
    };
}

function uniqueChapters(chapters) {
    const byName = new Map();
    chapters.filter(Boolean).forEach((chapter) => {
        if (!byName.has(chapter.name)) {
            byName.set(chapter.name, chapter);
        }
    });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildI18nModel(source, chapters, resources) {
    const entries = [
        ['resources.dashboard.label', 'Dashboard'],
        ['buttons.submit', 'Submit'],
        ['buttons.submitting', 'Submitting...'],
        ['buttons.cancel', 'Cancel'],
        ['buttons.add', 'Add'],
        ['table.actions', 'Actions'],
        ['table.selectAll', 'Select all'],
        ['table.selectRow', 'Select row'],
        ['table.sort.asc', 'Asc'],
        ['table.sort.desc', 'Desc'],
        ['table.sort.reset', 'Reset'],
        ['table.column.hide', 'Hide'],
        ['table.pagination.selectedRows', '{{selected}} of {{total}} row(s) selected.'],
        ['table.pagination.totalRows', '{{total}} row(s)'],
        ['table.pagination.rowsPerPage', 'Rows per page'],
        ['table.pagination.pageOf', 'Page {{page}} of {{pageCount}}'],
        ['table.pagination.firstPage', 'Go to first page'],
        ['table.pagination.previousPage', 'Go to previous page'],
        ['table.pagination.nextPage', 'Go to next page'],
        ['table.pagination.lastPage', 'Go to last page'],
        ['table.empty.noResults', 'No results.'],
        ['table.empty.noResultsFound', 'No results found.'],
        ['table.empty.noDataTitle', 'No data to display'],
        ['table.empty.noDataDescription', 'This table is empty for the time being.'],
        ['pagination.label', 'pagination'],
        ['pagination.previous', 'Previous'],
        ['pagination.next', 'Next'],
        ['pagination.morePages', 'More pages'],
        ['breadcrumb.actions.create', 'Create'],
        ['breadcrumb.actions.edit', 'Edit'],
        ['breadcrumb.actions.show', 'Show'],
        ['breadcrumb.actions.list', 'List'],
        ['values.boolean.true', 'True'],
        ['values.boolean.false', 'False']
    ];

    chapters.forEach((chapter) => {
        entries.push([chapter.i18nKey, chapter.label]);
    });

    resources.forEach((resource) => {
        entries.push([resource.i18nKey, resource.label]);
        resource.fields.forEach((field) => addFieldI18nEntries(entries, field));
        resource.commands.forEach((command) => {
            entries.push([command.i18nKey, command.label]);
            command.fields.forEach((field) => addFieldI18nEntries(entries, field));
        });
    });

    const translations = normalizeTranslations(source.translations ?? source.i18n?.translations ?? {});
    const defaultLocale = source.defaultLocale ?? source.i18n?.defaultLocale ?? 'en';
    const locales = unique(['en', defaultLocale, ...(source.locales ?? source.i18n?.locales ?? []), ...Object.keys(translations)]);
    const messages = Object.fromEntries(locales.map((locale) => [locale, {}]));

    entries.forEach(([key, defaultValue]) => {
        messages.en[key] = defaultValue;
        locales
            .filter((locale) => locale !== 'en')
            .forEach((locale) => {
                messages[locale][key] = translations[locale]?.[key]
                    ?? translations[locale]?.[defaultValue]
                    ?? defaultValue;
            });
    });

    return {
        locales,
        defaultLocale,
        messages: Object.fromEntries(Object.entries(messages).map(([locale, values]) => [
            locale,
            Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)))
        ]))
    };
}

function addFieldI18nEntries(entries, field) {
    entries.push([field.i18nKey, field.label]);
    entries.push([field.placeholderKey, field.placeholder]);
    entries.push([field.requiredKey, `${field.label} is required`]);
    (field.nestedFields ?? []).forEach((nestedField) => addFieldI18nEntries(entries, nestedField));
}

function normalizeTranslations(translations) {
    if (Array.isArray(translations)) {
        return translations.reduce((acc, item) => {
            const locale = item.locale ?? item.language;
            const key = item.key ?? item.i18nKey;
            const value = item.value ?? item.text ?? item.translation;
            if (!locale || !key || value === undefined) {
                return acc;
            }
            acc[locale] = acc[locale] ?? {};
            acc[locale][key] = String(value);
            return acc;
        }, {});
    }
    return translations;
}

function uniqueElements(elements) {
    const byId = new Map();
    elements.filter(Boolean).forEach((element) => {
        const key = element.id ?? element.title;
        if (!byId.has(key)) {
            byId.set(key, element);
        }
    });
    return Array.from(byId.values());
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function uniqueFields(fields) {
    const byName = new Map();
    fields.filter((field) => field?.name).forEach((field) => {
        const existing = byName.get(field.name);
        if (!existing || (existing.generated && !field.generated)) {
            byName.set(field.name, field);
        }
    });
    return Array.from(byName.values());
}

function tableName(readModel, fallbackTitle) {
    if (readModel?.tableName) {
        return readModel.tableName;
    }
    if (readModel?.dbName) {
        return readModel.dbName;
    }
    if (readModel?.databaseName) {
        return readModel.databaseName;
    }

    const entityName = `${pascal(readModel?.title ?? fallbackTitle)}ReadModelEntity`;
    return snakeCase(entityName);
}

function idFieldName(element) {
    return element?.fields?.find((field) => field.idAttribute)?.name ?? element?.fields?.find((field) => field.name === 'id')?.name;
}

function identifierFields(fields = []) {
    return fields.filter((field) => field.idAttribute);
}

function rowIdExpression(fields = []) {
    if (fields.length === 0) {
        return 'String(row.id)';
    }
    if (fields.length === 1) {
        return `String(row.${fields[0].name})`;
    }
    return fields.map((field) => `String(row.${field.name})`).join(' + ":" + ');
}

function optionLabelField(readModel) {
    return readModel?.fields?.find((field) => {
        const lower = field.name?.toLowerCase();
        return field.type?.toLowerCase() === 'string'
            && !field.idAttribute
            && !['state', 'status', 'type'].includes(lower)
            && !lower.endsWith('id');
    })?.name ?? idFieldName(readModel);
}

function normalizeFields(fields = []) {
    return fields
        .filter((field) => field?.name && !field.excludeFromApi && !field.generated)
        .map((field) => decorateField({
            name: field.name,
            label: titleCase(field.name),
            type: field.type ?? 'String',
            optional: !!field.optional,
            generated: !!field.generated,
            idAttribute: !!field.idAttribute,
            cardinality: field.cardinality ?? 'Single',
            valueType: field.valueType
        }));
}

function decorateField(field) {
    const object = isObjectField(field);
    const list = isListField(field);
    const json = object;
    const textArea = !object && (field.name.toLowerCase().includes('content')
        || field.name.toLowerCase().includes('description')
        || field.name.toLowerCase().includes('notes'));
    const boolean = isBooleanField(field);
    const nestedFields = object
        ? normalizeFields(field.valueType?.fields ?? []).map((nestedField) => ({
            ...nestedField,
            defaultValue: defaultValueExpression(nestedField)
        }))
        : [];

    return {
        ...field,
        tsType: tsType(field),
        filterable: isFilterable(field),
        cellValue: cellValue(field),
        inputComponent: textArea ? 'Textarea' : 'Input',
        inputType: inputType(field),
        boolean,
        object,
        list,
        scalarList: list && !object,
        json,
        jsonEmptyValue: isListField(field) ? '[]' : '{}',
        placeholder: json ? jsonPlaceholder(field) : `Enter ${field.label}`,
        fieldArrayName: `${camel(field.name)}Fields`,
        defaultValue: defaultValueExpression(field),
        scalarListItemDefaultValue: scalarListItemDefaultExpression(field),
        nestedFields,
        rows: json ? 10 : textArea ? 8 : null,
        rules: field.optional || boolean ? '{}' : `{ required: "${escapeString(field.label)} is required" }`
    };
}

function isReferenceSelectField(field) {
    const name = String(field.name ?? '');
    return !isJsonField(field) && /(^id$|Id$|id$)/.test(name);
}

function isJsonField(field) {
    return isObjectField(field);
}

function isObjectField(field) {
    return field.valueType?.kind === 'object';
}

function isListField(field) {
    return ['list', 'multiple', 'many'].includes(String(field.cardinality ?? '').toLowerCase());
}

function jsonPlaceholder(field) {
    if (!field.valueType?.fields?.length) {
        return isListField(field) ? 'Enter JSON array' : 'Enter JSON object';
    }
    const sample = Object.fromEntries(field.valueType.fields.map((nestedField) => [
        nestedField.name,
        sampleJsonValue(nestedField)
    ]));
    const value = isListField(field) ? [sample] : sample;
    return JSON.stringify(value, null, 2);
}

function sampleJsonValue(field) {
    if (isListField(field)) return [];
    const type = (field.valueType?.resolvedBaseType ?? field.type ?? 'String').toLowerCase();
    if (type === 'boolean') return false;
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(type)) return 0;
    return '';
}

function defaultValueExpression(field) {
    if (isListField(field)) {
        return isObjectField(field) ? `[${defaultObjectValueExpression(field.valueType)}]` : `[${scalarListItemDefaultExpression(field)}]`;
    }
    if (isObjectField(field)) {
        return defaultObjectValueExpression(field.valueType);
    }
    const type = (field.valueType?.resolvedBaseType ?? field.type ?? 'String').toLowerCase();
    if (type === 'boolean') return 'false';
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(type)) return 'undefined';
    return '""';
}

function defaultObjectValueExpression(valueType) {
    const fields = normalizeFields(valueType?.fields ?? []);
    const members = fields.map((field) => `  ${field.name}: ${defaultValueExpression(field)}`);
    return `{\n${members.join(',\n')}\n}`;
}

function hasNestedArrayField(field) {
    return isObjectField(field) && normalizeFields(field.valueType?.fields ?? []).some((nestedField) => nestedField.list);
}

function scalarListItemDefaultExpression(field) {
    const type = (field.valueType?.resolvedBaseType ?? field.type ?? 'String').toLowerCase();
    if (type === 'boolean') return 'false';
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(type)) return '0';
    return '""';
}

function isBooleanField(field) {
    return (field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase() === 'boolean';
}

function isEditCommand(command) {
    return /^(edit|update|change|modify)/i.test(command.name);
}

function isCreateCommand(command) {
    return /^(create|register|submit|add|new)/i.test(command.name);
}

function isDeleteCommand(command) {
    return /^(delete|remove|cancel|archive)/i.test(command.name);
}

function tsType(field) {
    if (field.valueType) {
        const valueType = field.valueType.name;
        return isListField(field) ? `${valueType}[]` : valueType;
    }
    const lower = field.type?.toLowerCase();
    const base = ['int', 'long', 'double', 'number'].includes(lower) ? 'number' : lower === 'boolean' ? 'boolean' : 'string';
    return isListField(field) ? `${base}[]` : base;
}

function tsValueType(valueType) {
    if (valueType.kind === 'object') {
        const fields = normalizeFields(valueType.fields ?? []);
        const members = fields.map((field) => `  ${field.name}${field.optional ? '?' : ''}: ${field.tsType};`);
        return `{\n${members.join('\n')}\n}`;
    }
    if (valueType.kind === 'enum' && (valueType.values ?? []).length > 0) {
        return (valueType.values ?? []).map((value) => JSON.stringify(String(value))).join(' | ');
    }
    return tsPrimitive(valueType.resolvedBaseType ?? valueType.baseType);
}

function tsPrimitive(type) {
    const lower = String(type ?? 'String').toLowerCase();
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(lower)) return 'number';
    if (lower === 'boolean') return 'boolean';
    return 'string';
}

function zodValueTypeExpression(valueType) {
    if (valueType.kind === 'object') {
        const fields = normalizeFields(valueType.fields ?? []);
        const members = fields.map((field) => `  ${field.name}: ${zodFieldExpression(field)}`);
        return `z.object({\n${members.join(',\n')}\n})`;
    }
    if (valueType.kind === 'enum' && (valueType.values ?? []).length > 0) {
        return `z.enum([${(valueType.values ?? []).map((value) => JSON.stringify(String(value))).join(', ')}])`;
    }
    let expression = zodPrimitive(valueType.resolvedBaseType ?? valueType.baseType);
    for (const constraint of valueType.resolvedConstraints ?? valueType.constraints ?? []) {
        switch (constraint.kind) {
            case 'format':
                if (constraint.format === 'email') expression += '.email()';
                else if (constraint.format === 'url') expression += '.url()';
                else if (constraint.format === 'uuid') expression += '.uuid()';
                break;
            case 'length':
                expression += `.min(${constraint.min}).max(${constraint.max})`;
                break;
            case 'range':
                expression += `.min(${constraint.min}).max(${constraint.max})`;
                break;
            case 'matches':
                expression += `.regex(new RegExp(${JSON.stringify(constraint.pattern)}))`;
                break;
            case 'oneOf':
                expression += `.refine((value) => ${JSON.stringify(constraint.values ?? [])}.includes(value), { message: "Invalid value" })`;
                break;
        }
    }
    return expression;
}

function zodFieldExpression(field) {
    let expression = field.valueType ? `${field.valueType.name}Schema` : zodPrimitive(field.type);
    if (isListField(field)) expression = `z.array(${expression})`;
    if (isJsonField(field)) {
        expression = `z.preprocess((value) => {
    if (typeof value !== "string") return value;
    if (!value.trim()) return ${isListField(field) ? '[]' : 'undefined'};
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, ${expression})`;
    }
    if (field.optional) expression += '.optional().nullable()';
    return expression;
}

function zodPrimitive(type) {
    switch (String(type ?? 'String').toLowerCase()) {
        case 'int':
        case 'integer': return 'z.coerce.number().int()';
        case 'long':
        case 'double':
        case 'float':
        case 'decimal':
        case 'bigdecimal':
        case 'number': return 'z.coerce.number()';
        case 'boolean': return 'z.boolean()';
        case 'uuid': return 'z.string().uuid()';
        case 'date': return 'z.string().date()';
        case 'datetime': return 'z.string().datetime()';
        default: return 'z.string()';
    }
}

function inputType(field) {
    const lower = (field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase();
    if (['int', 'long', 'double', 'number'].includes(lower)) {
        return 'number';
    }
    if (lower === 'date') {
        return 'date';
    }
    if (lower === 'datetime') {
        return 'datetime-local';
    }
    return null;
}

function cellValue(field) {
    const lower = (field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase();
    if (lower === 'boolean') {
        return 'getValue() ? "Yes" : "No"';
    }
    if (lower === 'date' || lower === 'datetime') {
        return 'getValue() ? new Date(String(getValue())).toLocaleString() : "-"';
    }
    return 'String(getValue() ?? "-")';
}

function isFilterable(field) {
    return ['string', 'uuid'].includes((field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase());
}

function cleanTitle(value) {
    return String(value ?? '')
        .replace(/^(screen|slice|spec|command|readmodel|projection)\s*:\s*/i, '')
        .trim();
}

function titleCase(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function kebab(value) {
    return slugify(cleanTitle(value), { lower: true, strict: true });
}

function snake(value) {
    return kebab(value).replace(/-/g, '_');
}

function snakeCase(value) {
    return String(value ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .replace(/__+/g, '_')
        .toLowerCase();
}

function axonRoute(value) {
    return cleanTitle(value).replace(/[\s_-]+/g, '').toLowerCase();
}

function camel(value) {
    const pascalValue = pascal(value);
    return pascalValue.charAt(0).toLowerCase() + pascalValue.slice(1);
}

function pascal(value) {
    return titleCase(value).replace(/\s/g, '');
}

function escapeString(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
