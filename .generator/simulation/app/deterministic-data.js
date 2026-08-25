/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

function previewValue(field = {}, seed = 1001, key = field.name ?? 'value') {
    const type = String(field.resolvedBaseType ?? field.baseType ?? field.type ?? 'String').toLowerCase();
    const hash = stableHash(`${seed}:${key}`);

    if (type === 'uuid') return uuidFromHash(seed, key);
    if (type === 'int' || type === 'integer') return 1 + (hash % 999);
    if (type === 'long') return 1000 + (hash % 999999);
    if (type === 'double' || type === 'float' || type === 'number') return Number(((hash % 10000) / 100).toFixed(2));
    if (type === 'decimal' || type === 'bigdecimal') return Number(((hash % 10000) / 1000).toFixed(3));
    if (type === 'boolean') return hash % 2 === 0;
    if (type === 'date' || type === 'localdate') return `2026-01-${String(1 + (hash % 28)).padStart(2, '0')}`;
    if (type === 'datetime' || type === 'localdatetime') return `2026-01-${String(1 + (hash % 28)).padStart(2, '0')}T10:${String(hash % 60).padStart(2, '0')}:00`;
    if (type === 'instant') return `2026-01-${String(1 + (hash % 28)).padStart(2, '0')}T10:${String(hash % 60).padStart(2, '0')}:00Z`;
    if (String(field.name ?? '').toLowerCase().includes('email')) return `sample-${hash % 10000}@example.test`;

    return `${labelFor(field.name ?? field.title ?? key)}-${String(1 + (hash % 999)).padStart(3, '0')}`;
}

function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value ?? '')) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function uuidFromHash(seed, key) {
    const hex = Array.from({ length: 32 }, (_, index) => {
        const value = stableHash(`${seed}:${key}:${index}`).toString(16).padStart(8, '0');
        return value[index % value.length];
    }).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function labelFor(value) {
    return String(value ?? 'sample')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'sample';
}

module.exports = {
    previewValue,
    stableHash
};
