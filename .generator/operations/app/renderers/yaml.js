/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

function renderYaml(value) {
    return `${renderNode(value, 0)}\n`;
}

function renderDocuments(documents) {
    return documents
        .filter(Boolean)
        .map((document) => renderYaml(document).trimEnd())
        .join('\n---\n') + '\n';
}

function renderNode(value, indent) {
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return value.map((item) => renderArrayItem(item, indent)).join('\n');
    }
    if (isObject(value)) {
        const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
        if (entries.length === 0) return '{}';
        return entries.map(([key, entryValue]) => renderObjectEntry(key, entryValue, indent)).join('\n');
    }
    return renderScalar(value);
}

function renderObjectEntry(key, value, indent) {
    const prefix = `${spaces(indent)}${renderKey(key)}:`;
    if (Array.isArray(value) && value.length === 0) return `${prefix} []`;
    if (isObject(value) && Object.keys(value).length === 0) return `${prefix} {}`;
    if (isScalar(value)) return `${prefix} ${renderScalar(value)}`;
    return `${prefix}\n${renderNode(value, indent + 2)}`;
}

function renderArrayItem(item, indent) {
    const prefix = `${spaces(indent)}-`;
    if (isScalar(item)) return `${prefix} ${renderScalar(item)}`;
    if (Array.isArray(item)) return `${prefix}\n${renderNode(item, indent + 2)}`;
    const entries = Object.entries(item).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return `${prefix} {}`;
    const [first, ...rest] = entries;
    const firstValue = renderInlineOrNested(first[1], indent + 2);
    const firstLine = firstValue.startsWith('\n')
        ? `${prefix} ${renderKey(first[0])}:${firstValue}`
        : `${prefix} ${renderKey(first[0])}: ${firstValue}`;
    const restLines = rest.map(([key, value]) => renderObjectEntry(key, value, indent + 2));
    return [firstLine, ...restLines].join('\n');
}

function renderInlineOrNested(value, indent) {
    if (isScalar(value)) return renderScalar(value);
    if (Array.isArray(value) && value.length === 0) return '[]';
    if (isObject(value) && Object.keys(value).length === 0) return '{}';
    return `\n${renderNode(value, indent + 2)}`;
}

function renderScalar(value) {
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(String(value));
}

function renderKey(key) {
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function isScalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function spaces(count) {
    return ' '.repeat(count);
}

function indentBlock(value, count) {
    const prefix = spaces(count);
    return value.trimEnd().split('\n').map((line) => `${prefix}${line}`).join('\n');
}

module.exports = {
    indentBlock,
    renderDocuments,
    renderYaml
};
