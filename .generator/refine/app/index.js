/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

var Generator = require('yeoman-generator').default;
var slugify = require('slugify');
const {loadGeneratorModel} = require("../../common/core/config-loader");

let config = {};
let codegenModel = {};

module.exports = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
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
            return;
        }

        const selectedCommandKeys = this.answers.allCommands
            ? undefined
            : normalizeSelectedCommands(this.answers.commands);
        const model = buildFrontendModel(codegenModel, selectedCommandKeys);

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
    }
};

function buildFrontendModel(source, selectedCommandKeys) {
    const slices = source.slices ?? [];
    const allAggregates = source.aggregates ?? [];
    const allContexts = source.contexts ?? source.context ?? [];
    const allReadModels = slices.flatMap((slice) => slice.readmodels ?? []);
    const allScreens = slices.flatMap((slice) => slice.screens ?? []);
    const allEvents = slices.flatMap((slice) => slice.events ?? []);
    const selected = selectedCommandKeys ? new Set(selectedCommandKeys) : null;
    const workflow = buildWorkflowModel(slices, allAggregates, allContexts, selected);
    const commandsByAggregate = new Map();

    slices.forEach((slice) => {
        (slice.commands ?? [])
            .filter((command) => command?.title)
            .filter((command) => !selected || selected.has(commandKey(command)))
            .forEach((command) => {
                const aggregate = aggregateName(command, slice, allAggregates, allContexts);
                if (!commandsByAggregate.has(aggregate.key)) {
                    commandsByAggregate.set(aggregate.key, {
                        ...aggregate,
                        slice,
                        commands: []
                    });
                }
                commandsByAggregate.get(aggregate.key).commands.push(command);
            });

        (slice.readmodels ?? [])
            .filter((readModel) => readModel?.title)
            .forEach((readModel) => {
                const aggregate = aggregateName(readModel, slice, allAggregates, allContexts);
                if (!commandsByAggregate.has(aggregate.key)) {
                    commandsByAggregate.set(aggregate.key, {
                        ...aggregate,
                        slice,
                        commands: []
                    });
                }
            });
    });

    const resources = uniqueResourceNames(Array.from(commandsByAggregate.values())
        .flatMap((group) => toAggregateResources(group, slices, allScreens, allReadModels, allEvents, workflow))
        .filter(Boolean));
    const chapters = uniqueChapters(resources.map((resource) => resource.chapter).filter(Boolean));

    return {
        appName: source.domain ?? 'Event Sourcing App',
        chapters,
        resources: resources.sort((a, b) => a.route.localeCompare(b.route))
    };
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

function findDependencies(element, elementType, source) {
    const ids = (element.dependencies ?? [])
        .filter((dependency) => dependency.type === 'INBOUND' || dependency.type === 'OUTBOUND')
        .filter((dependency) => dependency.elementType === elementType)
        .map((dependency) => dependency.id);

    return (source ?? []).filter((item) => ids.includes(item.id));
}

function buildWorkflowModel(slices, aggregates, contexts, selectedCommands) {
    const selectableReadModels = new Map();
    const commandsById = new Map();
    const eventsById = new Map();
    const nextCommandsByReadModelId = new Map();

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

    slices.flatMap((slice) => slice.readmodels ?? [])
        .filter((readModel) => readModel?.title && readModel.listElement)
        .forEach((readModel) => {
            const id = idFieldName(readModel);
            if (!id || selectableReadModels.has(id)) {
                return;
            }

            const aggregate = aggregateName(readModel, { title: readModel.slice }, aggregates, contexts);
            const optionLabel = optionLabelField(readModel);
            selectableReadModels.set(id, {
                resource: snake(cleanTitle(readModel.title)),
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
                .filter((dependency) => dependency.type === 'INBOUND' && dependency.elementType === 'EVENT')
                .map((dependency) => dependency.id ?? String(dependency.title ?? ''));
            const nextCommands = uniqueElements(inboundEventIds
                .map((eventId) => eventsById.get(eventId))
                .filter(Boolean)
                .flatMap((event) => (event.dependencies ?? [])
                    .filter((dependency) => dependency.type === 'OUTBOUND' && dependency.elementType === 'COMMAND')
                    .map((dependency) => commandsById.get(dependency.id) ?? commandsById.get(String(dependency.title ?? '')))
                    .filter(Boolean)));

            if (nextCommands.length > 0) {
                nextCommandsByReadModelId.set(readModel.id, nextCommands);
            }
        });

    return { selectableReadModels, nextCommandsByReadModelId };
}

function commandWorkflowFields(command, readModel, allEvents, workflow) {
    const inboundEventIds = (command.dependencies ?? [])
        .filter((dependency) => dependency.type === 'INBOUND' && dependency.elementType === 'EVENT')
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
            if (select && !field.idAttribute) {
                selects.set(field.name, select);
            }
        });

    return { prefill, selects };
}

function toAggregateResources(group, slices, allScreens, allReadModels, allEvents, workflow) {
    const title = cleanTitle(group.title);
    const aggregateSlices = slices.filter((slice) => sliceHasAggregate(slice, title));
    const relatedScreens = uniqueElements(group.commands.flatMap((command) => findDependencies(command, 'SCREEN', allScreens)));
    const aggregateReadModels = aggregateSlices
        .flatMap((slice) => slice.readmodels ?? []);
    const relatedReadModels = uniqueElements([
        ...aggregateReadModels,
        ...allReadModels.filter((readModel) => elementHasAggregate(readModel, title)),
        ...relatedScreens.flatMap((screen) => findDependencies(screen, 'READMODEL', allReadModels)),
        ...group.commands.flatMap((command) => findDependencies(command, 'READMODEL', allReadModels))
    ]);

    if (relatedReadModels.length === 0) {
        return [toReadModelResource(group, null, allEvents, workflow)];
    }

    return relatedReadModels.map((readModel) => toReadModelResource({
        ...group,
        commands: commandsForReadModel(readModel, aggregateSlices, group.commands)
    }, readModel, allEvents, workflow));
}

function commandsForReadModel(readModel, slices, aggregateCommands) {
    if (!readModel) {
        return aggregateCommands;
    }

    const ownerIndex = slices.findIndex((slice) =>
        (slice.readmodels ?? []).some((item) => item.id === readModel.id)
        || (
            (slice.screens ?? []).some((screen) => screen.ui?.type === 'list' || screen.ui?.type === 'detail')
            && (slice.readmodels ?? []).some((item) => cleanTitle(item.title) === cleanTitle(readModel.title))
        )
    );
    if (ownerIndex < 0) {
        return aggregateCommands;
    }

    const selectedCommandIds = new Set(aggregateCommands.map(commandKey));
    const timelineCommands = uniqueElements(slices
        .slice(0, ownerIndex)
        .flatMap((slice) => slice.commands ?? [])
        .filter((command) => selectedCommandIds.has(commandKey(command))));

    return timelineCommands.length > 0 ? timelineCommands : aggregateCommands;
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
    const idField = fields.find((field) => field.idAttribute) ?? fields.find((field) => field.name === 'id') ?? fields[0];
    const resourceCommands = uniqueElements(group.commands);
    let normalizedCommands = resourceCommands
        .filter((command) => command?.title)
        .map((command) => toCommand(command, route, component, readModel, allEvents, workflow));
    normalizedCommands = withPrefillFields(normalizedCommands, queryFields);
    const createCommand = normalizedCommands.find((command) => command.createsAggregate && isCreateCommand(command))
        ?? normalizedCommands.find((command) => command.createsAggregate);
    const editCommand = normalizedCommands.find((command) => isEditCommand(command));
    const deleteCommand = normalizedCommands.find((command) => isDeleteCommand(command));
    const reservedCommandNames = [createCommand, editCommand, deleteCommand].filter(Boolean).map((command) => command.name);

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
        idField: idField?.name ?? 'id',
        readModelId: readModel?.id,
        canList: readModel ? !!readModel.listElement : true,
        fields,
        createCommand,
        editCommand,
        deleteCommand,
        commands: [createCommand, deleteCommand, ...normalizedCommands.filter((command) => !reservedCommandNames.includes(command.name))].filter(Boolean),
        routedCommands: [deleteCommand, ...normalizedCommands.filter((command) => !reservedCommandNames.includes(command.name))].filter(Boolean),
        itemCommands: normalizedCommands.filter((command) => !reservedCommandNames.includes(command.name))
    };
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
    const commandAggregateTitle = cleanTitle(command.aggregateName ?? command.aggregate ?? title);
    return {
        id: commandKey(command),
        title,
        label: titleCase(title),
        name: camel(title),
        route: kebab(title),
        file: kebab(title),
        component,
        pageComponent: `${resourceComponent}${component}`,
        resourceRoute,
        aggregateRoute: axonRoute(commandAggregateTitle),
        createsAggregate: !!command.createsAggregate,
        fields: normalizedFields.map((field) => ({
            ...field,
            select: workflowFields.selects.get(field.name) ?? null
        })),
        workflowPrefillFields: normalizedFields.filter((field) => workflowFields.prefill.has(field.name)),
        hasSelectFields: workflowFields.selects.size > 0
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
    const title = cleanTitle(command.aggregateName ?? command.aggregate ?? slice?.title ?? 'app');
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

function sliceHasAggregate(slice, aggregateTitle) {
    const normalizedAggregateTitle = cleanTitle(aggregateTitle).toLowerCase();
    const directMatch = normalizeArray(slice?.aggregates)
        .map((aggregate) => cleanTitle(typeof aggregate === 'string' ? aggregate : aggregate.title ?? aggregate.name).toLowerCase())
        .includes(normalizedAggregateTitle);
    if (directMatch) {
        return true;
    }

    return [
        ...(slice?.commands ?? []),
        ...(slice?.events ?? []),
        ...(slice?.readmodels ?? []),
        ...(slice?.screens ?? []),
        ...(slice?.processors ?? [])
    ].some((element) => elementHasAggregate(element, normalizedAggregateTitle));
}

function elementHasAggregate(element, aggregateTitle) {
    const normalizedAggregateTitle = cleanTitle(aggregateTitle).toLowerCase();
    return [
        element?.aggregate,
        element?.aggregateName,
        ...(element?.aggregateDependencies ?? [])
    ]
        .filter(Boolean)
        .map((value) => cleanTitle(typeof value === 'string' ? value : value.title ?? value.name).toLowerCase())
        .includes(normalizedAggregateTitle);
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
            cardinality: field.cardinality ?? 'Single'
        }));
}

function decorateField(field) {
    const textArea = field.name.toLowerCase().includes('content')
        || field.name.toLowerCase().includes('description')
        || field.name.toLowerCase().includes('notes');

    return {
        ...field,
        tsType: tsType(field),
        filterable: isFilterable(field),
        cellValue: cellValue(field),
        inputComponent: textArea ? 'Textarea' : 'Input',
        inputType: inputType(field),
        rows: textArea ? 8 : null,
        rules: field.optional ? '{}' : `{ required: "${escapeString(field.label)} is required" }`
    };
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
    const lower = field.type?.toLowerCase();
    const base = ['int', 'long', 'double', 'number'].includes(lower) ? 'number' : lower === 'boolean' ? 'boolean' : 'string';
    return field.cardinality?.toLowerCase() === 'list' ? `${base}[]` : base;
}

function inputType(field) {
    const lower = field.type?.toLowerCase();
    if (lower === 'boolean') {
        return 'boolean';
    }
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
    const lower = field.type?.toLowerCase();
    if (lower === 'boolean') {
        return 'getValue() ? "Yes" : "No"';
    }
    if (lower === 'date' || lower === 'datetime') {
        return 'getValue() ? new Date(String(getValue())).toLocaleString() : "-"';
    }
    return 'String(getValue() ?? "-")';
}

function isFilterable(field) {
    return ['string', 'uuid'].includes(field.type?.toLowerCase());
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
