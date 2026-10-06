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
        ['values.boolean.false', 'False'],
        ['errors.commandRejected', 'Command rejected'],
        ['errors.commandFailed', 'Command failed'],
        ['errors.validationFailed', 'Validation failed for {{fields}}.'],
        ['errors.http.400', 'Bad request.'],
        ['errors.http.401', 'Authentication is required.'],
        ['errors.http.403', 'You do not have permission to perform this action.'],
        ['errors.http.404', 'The requested resource was not found.'],
        ['errors.http.409', 'The request conflicts with the current state.'],
        ['errors.http.422', 'The request could not be processed.'],
        ['errors.http.500', 'The server encountered an error.'],
        ['errors.fileUploadCapabilityMissing', 'A file upload capability must be modeled before generated file fields can upload files.'],
        ['errors.fileUploadFailed', 'Failed to upload file: {{status}}'],
        ['errors.portalSignInFailed', 'Portal sign-in failed.'],
        ['errors.portalTokenMissing', 'Portal token is missing.'],
        ['errors.currentUserLoadFailed', 'Current user could not be loaded.'],
        ['download.started', 'Download started'],
        ['download.failed', 'Download failed'],
        ['download.tooltip', 'Download'],
        ['dataExport.export', 'Export'],
        ['dataExport.exporting', 'Exporting'],
        ['dataExport.downloadStarted', 'Export download started'],
        ['dataExport.jobCreated', 'Export job created'],
        ['dataExport.failed', 'Export failed'],
        ['errors.downloadUriEmpty', 'Download URI is empty.'],
        ['errors.downloadUriUnavailable', 'Download URI is not available.'],
        ['errors.downloadHttpFailed', 'Download failed with HTTP {{status}}.'],
        ['sso.portal.title', 'Portal sign in'],
        ['sso.portal.description', 'Verifying your portal session.'],
        ['sso.portal.signingIn', 'Signing you in...'],
        ['sso.portal.awaitingPermissionsTitle', 'Account awaiting permissions'],
        ['sso.portal.awaitingPermissionsDescription', 'Please contact an administrator to assign permissions before using the system.'],
        ['sso.portal.failedTitle', 'Portal sign-in failed'],
        ['sso.portal.backToSignIn', 'Back to sign in'],
        ['dataGrid.clipboard.cellsCopied', '{{count}} cell(s) copied'],
        ['dataGrid.clipboard.cellsCut', '{{count}} cell(s) cut'],
        ['dataGrid.clipboard.cellsPasted', '{{count}} cell(s) pasted'],
        ['dataGrid.clipboard.cellsPastedWithSkipped', '{{count}} cell(s) pasted, {{skipped}} skipped'],
        ['dataGrid.clipboard.cellsSkippedInvalid', '{{count}} cell(s) skipped pasting for invalid data'],
        ['dataGrid.clipboard.copyFailed', 'Failed to copy to clipboard'],
        ['dataGrid.clipboard.cutFailed', 'Failed to cut to clipboard'],
        ['dataGrid.clipboard.pasteFailed', 'Failed to paste. Please try again.'],
        ['dataGrid.undo.noActions', 'No actions to undo'],
        ['dataGrid.undo.actionsUndone', '{{count}} action(s) undone'],
        ['dataGrid.redo.noActions', 'No actions to redo'],
        ['dataGrid.redo.actionsRedone', '{{count}} action(s) redone'],
        ['dataGrid.context.cellsCleared', '{{count}} cell(s) cleared'],
        ['dataGrid.context.rowsDeleted', '{{count}} row(s) deleted'],
        ['dataGrid.context.copy', 'Copy'],
        ['dataGrid.context.cut', 'Cut'],
        ['dataGrid.context.clear', 'Clear'],
        ['dataGrid.context.deleteRows', 'Delete rows'],
        ['dataGrid.pasteDialog.title', 'Do you want to add more rows?'],
        ['dataGrid.pasteDialog.description', 'We need {{count}} additional row(s) to paste everything from your clipboard.'],
        ['dataGrid.pasteDialog.createRows', 'Create new rows'],
        ['dataGrid.pasteDialog.createRowsDescription', 'Add {{count}} new row(s) to the table and paste all data'],
        ['dataGrid.pasteDialog.keepRows', 'Keep current rows'],
        ['dataGrid.pasteDialog.keepRowsDescription', 'Paste only what fits in the existing rows'],
        ['dataGrid.pasteDialog.cancel', 'Cancel'],
        ['dataGrid.pasteDialog.continue', 'Continue'],
        ['dataGrid.url.invalid', 'Invalid URL'],
        ['dataGrid.url.dangerousProtocol', 'URL contains a dangerous protocol.'],
        ['dataGrid.files.uploadFailed', 'Failed to upload {{count}} file(s)'],
        ['dataGrid.files.deleteFailed', 'Failed to delete {{name}}'],
        ['dataGrid.files.deleteFilesFailed', 'Failed to delete files']
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

    addDictionaryI18nEntries(entries, source);
    addGeneratedErrorI18nEntries(entries, source);

    const translations = normalizeTranslations(source.translations ?? source.i18n?.translations ?? {});
    addDictionaryTranslations(translations, source);
    const defaultLocale = source.defaultLocale ?? source.i18n?.defaultLocale ?? 'en';
    const locales = unique(['en', defaultLocale, ...(source.locales ?? source.i18n?.locales ?? []), ...Object.keys(translations)]);
    const messages = Object.fromEntries(locales.map((locale) => [locale, {}]));

    entries.forEach(([key, defaultValue]) => {
        messages.en[key] = defaultValue;
        locales
            .filter((locale) => locale !== 'en')
            .forEach((locale) => {
                const localeTranslations = {
                    ...builtinTranslations(locale),
                    ...(translations[locale] ?? {})
                };
                messages[locale][key] = localeTranslations[key]
                    ?? translatedDefaultValue(defaultValue, locale, localeTranslations)
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

function addGeneratedErrorI18nEntries(entries, source) {
    (source.transitions ?? []).forEach((transition) => {
        if (!transition?.from || transition.owner?.type !== 'concept') return;
        const commandName = transition.command?.name ?? transition.command?.title ?? 'Command';
        const ownerName = transition.owner.name;
        entries.push([
            `errors.${i18nContextKey(transition.context)}.${camel(commandName)}.requiresState`,
            `${titleCase(commandName)} requires ${titleCase(ownerName)} to be ${transition.from}.`
        ]);
    });

    const commands = (source.slices ?? []).flatMap((slice) =>
        (slice.commands ?? []).map((command) => ({command, slice}))
    );
    (source.slices ?? []).forEach((slice) => {
        (slice.readmodels ?? []).forEach((readmodel) => {
            normalizeArray(readmodel.eligibility).forEach((eligibility) => {
                commands
                    .filter(({command, slice: commandSlice}) =>
                        commandUsesReadModel(command, readmodel)
                        && eligibilityMatchesCommand(eligibility, command, commandSlice)
                    )
                    .forEach(({command, slice: commandSlice}) => {
                        entries.push([
                            `errors.${i18nContextKey(commandSlice.context ?? commandSlice.chapter)}.${camel(command.title ?? command.name)}.${camel(readmodel.title ?? readmodel.name)}.notEligible`,
                            `${cleanTitle(readmodel.title ?? readmodel.name)} selection is not eligible${eligibility.profile ? ` for ${cleanTitle(eligibility.profile)}` : ''}.`
                        ]);
                    });
            });
        });
    });
}

function i18nContextKey(value) {
    const context = contextName(value)?.name;
    return context ? context.replace(/[-_]/g, '').toLowerCase() : 'eventmodel';
}

function eligibilityMatchesCommand(eligibility, command, commandSlice) {
    const commandRefs = normalizeArray(
        eligibility.command ?? eligibility.commands ?? eligibility.for ?? eligibility.useCase ?? eligibility.profile
    ).map((value) => String(value ?? '').toLowerCase());
    if (commandRefs.length === 0) return true;
    const candidates = [
        command.id,
        command.name,
        command.title,
        cleanTitle(command.name),
        cleanTitle(command.title),
        `${commandSlice.context}.${command.name}`,
        `${commandSlice.context}.${command.title}`
    ].filter(Boolean).map((value) => String(value).toLowerCase());
    return commandRefs.some((ref) => candidates.includes(ref));
}

function commandUsesReadModel(command, readmodel) {
    return (command.fields ?? []).some((field) =>
        field?.source?.kind === 'direct'
        && normalizeArray(field?.source?.from).some((source) => {
            const [sourceOwner] = String(source ?? '').split('.').filter(Boolean);
            return sourceOwner && readModelMatchesSource(readmodel, sourceOwner);
        })
    );
}

function readModelMatchesSource(readmodel, sourceOwner) {
    const sourceKey = normalizedEligibilityKey(sourceOwner);
    return [
        readmodel.name,
        readmodel.title,
        readmodel.label,
        cleanTitle(readmodel.name),
        cleanTitle(readmodel.title),
        cleanTitle(readmodel.label)
    ].filter(Boolean).some((value) => normalizedEligibilityKey(value) === sourceKey);
}

function normalizedEligibilityKey(value) {
    return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
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

function addDictionaryI18nEntries(entries, source) {
    normalizeArray(source.dictionaries ?? source.i18n?.dictionaries).forEach((dictionary) => {
        const dictionaryCode = dictionary.dictionaryCode ?? dictionary.code ?? dictionary.name;
        if (!dictionaryCode) {
            return;
        }
        normalizeArray(dictionary.values ?? dictionary.dictionaryValues).forEach((value) => {
            const valueCode = value.valueCode ?? value.code ?? value.value ?? value.name;
            if (valueCode) {
                entries.push([`dictionaries.${dictionaryCode}.${valueCode}`, dictionaryEnglishLabel(value)]);
            }
        });
    });
    normalizeArray(source.dictionaryValues ?? source.i18n?.dictionaryValues).forEach((value) => {
        const dictionaryCode = value.dictionaryCode ?? value.dictionary ?? value.code;
        const valueCode = value.valueCode ?? value.value ?? value.name;
        if (dictionaryCode && valueCode) {
            entries.push([`dictionaries.${dictionaryCode}.${valueCode}`, dictionaryEnglishLabel(value)]);
        }
    });
}

function addDictionaryTranslations(translations, source) {
    const addTranslation = (dictionaryCode, value) => {
        const valueCode = value.valueCode ?? value.code ?? value.value ?? value.name;
        const label = value.displayNameZh ?? value.labelZh ?? value.displayName ?? value.label;
        if (!dictionaryCode || !valueCode || !label) {
            return;
        }
        translations['zh-CN'] = translations['zh-CN'] ?? {};
        translations['zh-CN'][`dictionaries.${dictionaryCode}.${valueCode}`] = String(label);
    };
    normalizeArray(source.dictionaries ?? source.i18n?.dictionaries).forEach((dictionary) => {
        const dictionaryCode = dictionary.dictionaryCode ?? dictionary.code ?? dictionary.name;
        normalizeArray(dictionary.values ?? dictionary.dictionaryValues).forEach((value) => addTranslation(dictionaryCode, value));
    });
    normalizeArray(source.dictionaryValues ?? source.i18n?.dictionaryValues).forEach((value) => {
        addTranslation(value.dictionaryCode ?? value.dictionary ?? value.code, value);
    });
}

function dictionaryEnglishLabel(value) {
    return String(value.displayNameEn ?? value.labelEn ?? value.titleEn ?? optionLabel(value.valueCode ?? value.code ?? value.value ?? value.name));
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

function translatedDefaultValue(defaultValue, locale, translations) {
    if (translations[defaultValue]) {
        return translations[defaultValue];
    }
    if (locale !== 'zh-CN') {
        return undefined;
    }

    const enterMatch = /^Enter (.+)$/.exec(defaultValue);
    if (enterMatch && translations[enterMatch[1]]) {
        return `请输入${translations[enterMatch[1]]}`;
    }

    const selectMatch = /^Select (.+)$/.exec(defaultValue);
    if (selectMatch && translations[selectMatch[1]]) {
        return `请选择${translations[selectMatch[1]]}`;
    }

    const requiredMatch = /^(.+) is required$/.exec(defaultValue);
    if (requiredMatch && translations[requiredMatch[1]]) {
        return `${translations[requiredMatch[1]]}为必填项`;
    }

    const stateRequirementMatch = /^(.+) requires (.+) to be (.+)\.$/.exec(defaultValue);
    if (stateRequirementMatch) {
        return `${translatedTerm(stateRequirementMatch[1], translations)}要求${translatedTerm(stateRequirementMatch[2], translations)}处于${translatedTerm(stateRequirementMatch[3], translations)}状态。`;
    }

    const eligibilityMatch = /^(.+) selection is not eligible(?: for (.+))?\.$/.exec(defaultValue);
    if (eligibilityMatch) {
        const projection = translatedTerm(eligibilityMatch[1], translations);
        const profile = eligibilityMatch[2] ? translatedTerm(eligibilityMatch[2], translations) : undefined;
        return profile ? `${projection}当前不可用，不能用于${profile}。` : `${projection}当前不可用。`;
    }

    return undefined;
}

function translatedTerm(value, translations) {
    const text = cleanTitle(value);
    return translations[text] ?? translations[titleCase(text)] ?? titleCase(text);
}

function builtinTranslations(locale) {
    if (locale !== 'zh-CN') {
        return {};
    }
    return {
        'Add': '新增',
        'Cancel': '取消',
        'Create': '创建',
        'Edit': '编辑',
        'Show': '查看',
        'List': '列表',
        'Submit': '提交',
        'Submitting...': '正在提交...',
        'Previous': '上一页',
        'Next': '下一页',
        'More pages': '更多页',
        'No data to display': '暂无数据',
        'This table is empty for the time being.': '当前表格暂无数据。',
        'Equals': '等于',
        'Not equals': '不等于',
        'Less than': '小于',
        'Greater than': '大于',
        'Less than or equal to': '小于等于',
        'Greater than or equal to': '大于等于',
        'Contains': '包含',
        'Does not contain': '不包含',
        'Starts with': '开头为',
        'Ends with': '结尾为',
        'Is null': '为空',
        'Is not null': '不为空',
        'True': '是',
        'False': '否',
        'values.boolean.true': '是',
        'values.boolean.false': '否',
        'pagination': '分页',
        'Validation failed for {{fields}}.': '{{fields}} 校验失败。',
        'Bad request.': '请求参数错误。',
        'Authentication is required.': '需要先登录。',
        'You do not have permission to perform this action.': '你没有执行该操作的权限。',
        'The requested resource was not found.': '请求的资源不存在。',
        'The request conflicts with the current state.': '请求与当前状态冲突。',
        'The request could not be processed.': '请求无法处理。',
        'The server encountered an error.': '服务器处理失败。',
        'A file upload capability must be modeled before generated file fields can upload files.': '需要先建模文件上传能力，生成的文件字段才能上传文件。',
        'Failed to upload file: {{status}}': '文件上传失败：{{status}}',
        'Portal sign-in failed.': '门户登录失败。',
        'Portal token is missing.': '缺少门户登录令牌。',
        'Current user could not be loaded.': '无法加载当前用户。',
        'Download started': '已开始下载',
        'Download failed': '下载失败',
        'Download': '下载',
        'Export': '导出',
        'Exporting': '正在导出',
        'Export download started': '导出下载已开始',
        'Export job created': '导出任务已创建',
        'Export failed': '导出失败',
        'Download URI is empty.': '下载地址为空。',
        'Download URI is not available.': '下载地址不可用。',
        'Download failed with HTTP {{status}}.': '下载失败，HTTP 状态码 {{status}}。',
        'Portal sign in': '门户登录',
        'Verifying your portal session.': '正在验证门户会话。',
        'Signing you in...': '正在登录...',
        'Account awaiting permissions': '账号等待分配权限',
        'Please contact an administrator to assign permissions before using the system.': '请联系管理员分配权限后再使用系统。',
        'Portal sign-in failed': '门户登录失败',
        'Back to sign in': '返回登录',
        '{{count}} cell(s) copied': '已复制 {{count}} 个单元格',
        '{{count}} cell(s) cut': '已剪切 {{count}} 个单元格',
        '{{count}} cell(s) pasted': '已粘贴 {{count}} 个单元格',
        '{{count}} cell(s) pasted, {{skipped}} skipped': '已粘贴 {{count}} 个单元格，跳过 {{skipped}} 个',
        '{{count}} cell(s) skipped pasting for invalid data': '因数据无效，已跳过 {{count}} 个单元格',
        'Failed to copy to clipboard': '复制到剪贴板失败',
        'Failed to cut to clipboard': '剪切到剪贴板失败',
        'Failed to paste. Please try again.': '粘贴失败，请重试。',
        'No actions to undo': '没有可撤销的操作',
        '{{count}} action(s) undone': '已撤销 {{count}} 个操作',
        'No actions to redo': '没有可重做的操作',
        '{{count}} action(s) redone': '已重做 {{count}} 个操作',
        '{{count}} cell(s) cleared': '已清空 {{count}} 个单元格',
        '{{count}} row(s) deleted': '已删除 {{count}} 行',
        'Copy': '复制',
        'Cut': '剪切',
        'Clear': '清空',
        'Delete rows': '删除行',
        'Do you want to add more rows?': '是否添加更多行？',
        'We need {{count}} additional row(s) to paste everything from your clipboard.': '需要新增 {{count}} 行才能粘贴剪贴板中的全部内容。',
        'Create new rows': '创建新行',
        'Add {{count}} new row(s) to the table and paste all data': '向表格新增 {{count}} 行并粘贴全部数据',
        'Keep current rows': '保留当前行',
        'Paste only what fits in the existing rows': '只粘贴当前行能容纳的数据',
        'Continue': '继续',
        'Invalid URL': 'URL 无效',
        'URL contains a dangerous protocol.': 'URL 包含危险协议。',
        'Failed to upload {{count}} file(s)': '{{count}} 个文件上传失败',
        'Failed to delete {{name}}': '删除 {{name}} 失败',
        'Failed to delete files': '删除文件失败'
    };
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

    const provider = (readModel?.capabilityProviders ?? [])
        .find((item) => item?.kind === 'dictionaryValues' && item?.mappings?.code && item?.mappings?.value);
    if (provider) {
        return {
            name: provider.source ?? readModel?.name,
            ...provider.mappings
        };
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
            portOutput: !!field.portOutput,
            selectionPrefill: !!field.selectionPrefill,
            idAttribute: !!field.idAttribute,
            display: !!field.display,
            uploadFile: !!field.uploadFile,
            file: !!field.file,
            cardinality: field.cardinality ?? 'Single',
            source: field.source,
            optionSet: field.optionSet,
            options: field.options,
            enumName: field.enumName,
            enumOptions: field.enumOptions,
            valueType: field.valueType
        }));
}

function decorateField(field) {
    const object = isObjectField(field);
    const list = isListField(field);
    const json = object;
    const longText = !object && !list
        && (field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase() === 'text';
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
        filterVariant: filterVariant(field),
        filterOperator: filterOperator(field),
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
        longText,
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
    if (lower === 'text') {
        return '<CopyableText value={getValue()} compact />';
    }
    if (lower === 'boolean') {
        return 'formatValue(getValue(), t, dictionaryLabel)';
    }
    if (lower === 'date' || lower === 'datetime') {
        return 'getValue() ? new Date(String(getValue())).toLocaleString() : "-"';
    }
    return 'String(getValue() ?? "-")';
}

function isFilterable(field) {
    return !isListField(field) && !isObjectField(field);
}

function filterVariant(field) {
    const lower = (field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase();
    if (optionSetForField(field)) {
        return 'multiSelect';
    }
    if (lower === 'boolean') {
        return 'boolean';
    }
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(lower)) {
        return 'number';
    }
    if (['date', 'datetime', 'localdate', 'localdatetime'].includes(lower)) {
        return 'date';
    }
    return 'text';
}

function filterOperator(field) {
    const lower = (field.valueType?.resolvedBaseType ?? field.type)?.toLowerCase();
    if (optionSetForField(field)) {
        return 'inArray';
    }
    if (lower === 'boolean') {
        return 'eq';
    }
    if (['int', 'integer', 'long', 'double', 'float', 'decimal', 'bigdecimal', 'number'].includes(lower)) {
        return 'eq';
    }
    if (['date', 'datetime', 'localdate', 'localdatetime'].includes(lower)) {
        return 'eq';
    }
    if (!['string', 'uuid'].includes(lower)) {
        return 'eq';
    }
    return null;
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
