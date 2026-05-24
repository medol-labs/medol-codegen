/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

var Generator = require('yeoman-generator').default;
var slugify = require('slugify');

let config = {};

module.exports = class extends Generator {

    constructor(args, opts) {
        super(args, opts);
        this.opts = opts ?? {};
        this.argument('appname', { type: String, required: false });

        const configPath = `${this.env.cwd}/config.json`;

        try {
            delete require.cache[require.resolve(configPath)];
            config = require(configPath);
        } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND') {
                throw new Error(`❌ No config.json found at ${configPath}. Please create one first.`);
            } else {
                throw err;
            }
        }
    }

    async prompting() {
        const prompts = [];
        const commandChoices = buildCommandChoices(config);

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
        const model = buildFrontendModel(config, selectedCommandKeys);

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
        this.fs.copyTpl(
            this.templatePath('src/pages/list.tsx.tpl'),
            this.destinationPath(`${basePath}/list.tsx`),
            { resource }
        );
        this.fs.copyTpl(
            this.templatePath('src/pages/show.tsx.tpl'),
            this.destinationPath(`${basePath}/show.tsx`),
            { resource }
        );

        if (resource.createCommand) {
            this.fs.copyTpl(
                this.templatePath('src/pages/form.tsx.tpl'),
                this.destinationPath(`${basePath}/create.tsx`),
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
                appName: config?.codeGen?.application ?? 'frontend-foundation'
            }
        );
        ['.env-example', '.gitignore', '.npmrc'].forEach((file) => {
            this.fs.copyTpl(
                this.templatePath(`root/${file}`),
                this.destinationPath(file),
                {
                    appName: config?.codeGen?.application ?? 'frontend-foundation'
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
    const selected = selectedCommandKeys ? new Set(selectedCommandKeys) : null;
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
    });

    const resources = Array.from(commandsByAggregate.values())
        .map((group) => toAggregateResource(group, slices, allScreens, allReadModels))
        .filter(Boolean);
    const chapters = uniqueChapters(resources.map((resource) => resource.chapter).filter(Boolean));

    return {
        appName: source.codeGen?.application ?? 'Event Sourcing App',
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

function toAggregateResource(group, slices, allScreens, allReadModels) {
    const title = cleanTitle(group.title);
    const route = kebab(title);
    const name = snake(title);
    const component = pascal(title);
    const relatedScreens = uniqueElements(group.commands.flatMap((command) => findDependencies(command, 'SCREEN', allScreens)));
    const aggregateReadModels = slices
        .filter((slice) => sliceHasAggregate(slice, title))
        .flatMap((slice) => slice.readmodels ?? []);
    const relatedReadModels = uniqueElements([
        ...aggregateReadModels,
        ...relatedScreens.flatMap((screen) => findDependencies(screen, 'READMODEL', allReadModels)),
        ...group.commands.flatMap((command) => findDependencies(command, 'READMODEL', allReadModels))
    ]);
    const primaryReadModel = relatedReadModels[0];
    const queryModelFields = uniqueFields([
        ...relatedReadModels.flatMap((readModel) => readModel.fields ?? [])
    ]);
    const modelFields = uniqueFields([
        ...queryModelFields,
        ...group.commands.flatMap((command) => command.fields ?? [])
    ]);
    const queryFields = normalizeFields(queryModelFields);
    const fields = normalizeFields(modelFields);
    const idField = fields.find((field) => field.idAttribute) ?? fields.find((field) => field.name === 'id') ?? fields[0];
    let normalizedCommands = group.commands
        .filter((command) => command?.title)
        .map((command) => toCommand(command, route, component));
    normalizedCommands = withPrefillFields(normalizedCommands, queryFields);
    const createCommand = normalizedCommands.find((command) => command.createsAggregate && isCreateCommand(command))
        ?? normalizedCommands.find((command) => command.createsAggregate);
    const editCommand = normalizedCommands.find((command) => isEditCommand(command));
    const deleteCommand = normalizedCommands.find((command) => isDeleteCommand(command));
    const reservedCommandNames = [createCommand, editCommand, deleteCommand].filter(Boolean).map((command) => command.name);

    return {
        title,
        label: titleCase(title),
        route,
        name,
        tableName: tableName(primaryReadModel, title),
        component,
        chapter: group.chapter,
        idField: idField?.name ?? 'id',
        dataProviderName: 'COMMAND_DATA_PROVIDER_NAME',
        fields,
        createCommand,
        editCommand,
        deleteCommand,
        commands: [createCommand, deleteCommand, ...normalizedCommands.filter((command) => !reservedCommandNames.includes(command.name))].filter(Boolean),
        routedCommands: [deleteCommand, ...normalizedCommands.filter((command) => !reservedCommandNames.includes(command.name))].filter(Boolean),
        itemCommands: normalizedCommands.filter((command) => !reservedCommandNames.includes(command.name))
    };
}

function toCommand(command, resourceRoute, resourceComponent) {
    const title = cleanTitle(command.title);
    const component = pascal(title);
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
        createsAggregate: !!command.createsAggregate,
        fields: normalizeFields(command.fields).filter((field) => !field.generated)
    };
}

function withPrefillFields(commands, resourceFields) {
    const resourceFieldNames = new Set(resourceFields.map((field) => field.name));
    return commands.map((command) => ({
        ...command,
        prefillFields: command.fields.filter((field) => resourceFieldNames.has(field.name))
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
    return normalizeArray(slice?.aggregates)
        .map((aggregate) => cleanTitle(typeof aggregate === 'string' ? aggregate : aggregate.title ?? aggregate.name).toLowerCase())
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
