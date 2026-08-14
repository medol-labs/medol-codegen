/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const slugify = require('slugify');
const {fieldOptionsFor} = require("../../common/core/field-options");

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
    (field.enumOptions ?? []).forEach((option) => {
        entries.push([option.i18nKey, option.label]);
    });
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
    const fields = readModel?.fields ?? [];
    const id = idFieldName(readModel);
    const displayField = fields.find((field) => field.display);
    if (displayField?.name) {
        return displayField.name;
    }

    const candidates = fields.filter((field) => {
        const lower = field.name?.toLowerCase();
        return field.type?.toLowerCase() === 'string'
            && !field.idAttribute
            && !['state', 'status', 'type'].includes(lower)
            && !lower.endsWith('id');
    });
    if (candidates.length === 0) {
        return id;
    }

    const titleWords = cleanTitle(readModel?.title ?? readModel?.name ?? '')
        .split(/\s+/)
        .map((word) => word.toLowerCase())
        .filter(Boolean)
        .filter((word) => !['catalog', 'directory', 'overview', 'readiness', 'capability', 'latest', 'view', 'log'].includes(word));
    const primaryWord = titleWords[0];

    return candidates
        .map((field, index) => ({ field, index, score: optionLabelFieldScore(field.name, primaryWord) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]
        .field.name;
}

function optionLabelFieldScore(name, primaryWord) {
    const lower = name?.toLowerCase() ?? '';
    if (lower === 'displayname') return 100;
    if (primaryWord && lower === `${primaryWord}name`) return 95;
    if (['name', 'title', 'label'].includes(lower)) return 90;
    if (lower.endsWith('name')) return lower === 'organizationname' ? 70 : 80;
    if (lower.endsWith('code')) return 60;
    if (lower.includes('version')) return 50;
    return 10;
}

function dictionaryProviderFor(readModel) {
    if (readModel?.dictionaryProvider?.code && readModel?.dictionaryProvider?.value) {
        return readModel.dictionaryProvider;
    }

    return null;
}

function dictionaryProviderField(readModel, role) {
    return dictionaryProviderFor(readModel)?.[role];
}

function normalizeFields(fields = []) {
    return fields
        .filter((field) => field?.name && !field.excludeFromApi && !field.generated)
        .map((field) => decorateField({
            name: field.name,
            label: titleCase(field.name),
            type: field.type ?? 'String',
            dictionary: field.dictionary,
            optional: !!field.optional,
            generated: !!field.generated,
            excludeFromForm: !!field.excludeFromForm,
            hidden: !!field.hidden,
            readOnly: !!field.readOnly,
            technicalAttribute: !!field.technicalAttribute,
            idAttribute: !!field.idAttribute,
            uploadFile: !!field.uploadFile,
            file: !!field.file,
            cardinality: field.cardinality ?? 'Single',
            source: field.source,
            valueType: field.valueType
        }));
}

function decorateField(field) {
    const object = isObjectField(field);
    const list = isListField(field);
    const json = object;
    const uploadFile = !!field.uploadFile;
    const file = !!field.file;
    const fileInput = uploadFile || file;
    const optionSet = !object ? optionSetForField(field) : undefined;
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
        inputType: fileInput ? 'file' : inputType(field),
        uploadFile,
        file,
        fileInput,
        boolean,
        enumName: optionSet?.enumName ?? null,
        enumOptions: optionSet?.values ?? [],
        object,
        list,
        scalarList: list && !object,
        json,
        jsonEmptyValue: isListField(field) ? '[]' : '{}',
        placeholder: file ? `Select ${field.label}` : optionSet ? `Select ${field.label}` : json ? jsonPlaceholder(field) : `Enter ${field.label}`,
        fieldArrayName: `${camel(field.name)}Fields`,
        defaultValue: defaultValueExpression(field),
        searchParamDefault: searchParamDefaultExpression(field),
        scalarListItemDefaultValue: scalarListItemDefaultExpression(field),
        nestedFields,
        rows: json ? 10 : textArea ? 8 : null,
        rules: field.optional || boolean ? '{}' : `{ required: "${escapeString(field.label)} is required" }`
    };
}

function optionSetForField(field) {
    const explicit = fieldOptionsFor(field);
    if (explicit) {
        return explicit;
    }
    if (field.valueType?.kind === 'enum' && (field.valueType.values ?? []).length > 0) {
        return optionSetFromValues(field.valueType.name, field.valueType.values, 'valueType');
    }
    const oneOf = (field.valueType?.resolvedConstraints ?? field.valueType?.constraints ?? [])
        .find((constraint) => constraint.kind === 'oneOf' && (constraint.values ?? []).length > 0);
    if (oneOf) {
        return optionSetFromValues(field.valueType.name, oneOf.values, 'oneOf');
    }
    return undefined;
}

function optionSetFromValues(enumName, values, source) {
    return {
        enumName,
        source,
        values: values.map((value) => {
            const stringValue = String(value);
            return {
                value: stringValue,
                label: optionLabel(stringValue),
                enumConstant: constant(stringValue)
            };
        })
    };
}

function optionLabel(value) {
    return String(value ?? '')
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => {
            const upper = part.toUpperCase();
            if (/^[A-Z0-9]+$/.test(upper) && /\d/.test(upper)) return upper;
            if (['VM', 'GPU', 'CPU', 'HA', 'VPN', 'TLS', 'API', 'IP', 'URL', 'UUID', 'CIDR'].includes(upper)) {
                return upper;
            }
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(' ');
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
    if (optionSetForField(field)) return 'undefined';
    const type = (field.valueType?.resolvedBaseType ?? field.type ?? 'String').toLowerCase();
    if (type === 'boolean') return 'false';
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(type)) return 'undefined';
    return '""';
}

function searchParamDefaultExpression(field) {
    const name = JSON.stringify(field.name);
    if (isListField(field)) {
        return `searchParams.get(${name})?.split(",").map((value) => value.trim()).filter(Boolean) ?? undefined`;
    }
    const type = (field.valueType?.resolvedBaseType ?? field.type ?? 'String').toLowerCase();
    if (type === 'boolean') {
        return `(() => { const value = searchParams.get(${name}); return value === null ? undefined : value === "true"; })()`;
    }
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(type)) {
        return `(() => { const value = searchParams.get(${name}); return value === null ? undefined : Number(value); })()`;
    }
    return `searchParams.get(${name}) ?? undefined`;
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
    const optionSet = optionSetForField(field);
    if (optionSet) return JSON.stringify(optionSet.values[0]?.value ?? '');
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
    const optionSet = optionSetForField(field);
    if (optionSet) {
        const type = optionSet.values.map((option) => JSON.stringify(option.value)).join(' | ');
        return isListField(field) ? `(${type})[]` : type;
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
    const optionSet = optionSetForField(field);
    let expression = field.valueType
        ? `${field.valueType.name}Schema`
        : optionSet ? `z.enum([${optionSet.values.map((option) => JSON.stringify(option.value)).join(', ')}])` : zodPrimitive(field.type);
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
        case 'datetime': return 'dateTimeLocalSchema';
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

function constant(value) {
    return String(value ?? '')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/([0-9])([A-Z][a-z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

function escapeString(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = {
    normalizeArray,
    findAggregate,
    contextName,
    uniqueChapters,
    buildI18nModel,
    addFieldI18nEntries,
    normalizeTranslations,
    uniqueElements,
    unique,
    uniqueFields,
    tableName,
    idFieldName,
    identifierFields,
    rowIdExpression,
    optionLabelField,
    dictionaryProviderFor,
    dictionaryProviderField,
    normalizeFields,
    decorateField,
    optionSetForField,
    optionSetFromValues,
    optionLabel,
    isReferenceSelectField,
    isJsonField,
    isObjectField,
    isListField,
    jsonPlaceholder,
    sampleJsonValue,
    defaultValueExpression,
    searchParamDefaultExpression,
    defaultObjectValueExpression,
    hasNestedArrayField,
    scalarListItemDefaultExpression,
    isBooleanField,
    isEditCommand,
    isCreateCommand,
    isDeleteCommand,
    tsType,
    tsValueType,
    tsPrimitive,
    zodValueTypeExpression,
    zodFieldExpression,
    zodPrimitive,
    inputType,
    cellValue,
    isFilterable,
    cleanTitle,
    titleCase,
    kebab,
    snake,
    snakeCase,
    axonRoute,
    camel,
    pascal,
    constant,
    escapeString
};
