/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

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
        resultFields: (command.resultFields ?? []).map((field) => withFieldI18n(field, `${commandKey}.result.fields.${field.name}`)),
        prefillFields: command.prefillFields.map((field) => withFieldI18n(field, `${commandKey}.fields.${field.name}`)),
        rowPrefillFields: (command.rowPrefillFields ?? []).map((field) => withFieldI18n(field, `${commandKey}.fields.${field.name}`)),
        workflowPrefillFields: command.workflowPrefillFields.map((field) => withFieldI18n(field, `${commandKey}.fields.${field.name}`))
    };
}

function withFieldI18n(field, fieldKey) {
    return {
        ...field,
        i18nKey: `${fieldKey}.label`,
        placeholderKey: `${fieldKey}.placeholder`,
        requiredKey: `${fieldKey}.required`,
        enumOptions: (field.enumOptions ?? []).map((option) => ({
            ...option,
            i18nKey: `${fieldKey}.options.${option.value}`
        })),
        nestedFields: (field.nestedFields ?? []).map((nestedField) => withFieldI18n(nestedField, `${fieldKey}.fields.${nestedField.name}`))
    };
}

module.exports = {
    withChapterI18n,
    withResourceI18n,
    withCommandI18n,
    withFieldI18n
};
