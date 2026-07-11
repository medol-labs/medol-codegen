function fieldOptionsFor(field) {
    if (!field?.optionSet && !field?.options && !field?.enumOptions) {
        return undefined;
    }
    const values = normalizeValues(field.optionSet?.values ?? field.options ?? field.enumOptions);
    if (values.length === 0) {
        return undefined;
    }
    return {
        enumName: field.optionSet?.enumName ?? field.enumName ?? field.type ?? pascal(field.name),
        values,
        fieldName: field.name,
        source: 'field'
    };
}

function collectFieldOptionEnums(source) {
    const fields = [
        ...(source?.slices ?? []).flatMap((slice) => [
            ...(slice.commands ?? []).flatMap((command) => command.fields ?? []),
            ...(slice.events ?? []).flatMap((event) => event.fields ?? []),
            ...(slice.readmodels ?? []).flatMap((readmodel) => readmodel.fields ?? [])
        ]),
        ...(source?.valueTypes ?? []).flatMap((valueType) => valueType.fields ?? [])
    ];
    const byName = new Map();
    fields
        .map(fieldOptionsFor)
        .filter(Boolean)
        .forEach((optionSet) => {
            if (!byName.has(optionSet.enumName)) {
                byName.set(optionSet.enumName, optionSet);
            }
        });
    return Array.from(byName.values()).sort((left, right) => left.enumName.localeCompare(right.enumName));
}

function normalizeValues(values = []) {
    return values
        .map((option) => {
            if (Array.isArray(option)) {
                const [value, label] = option;
                return optionValue(value, label);
            }
            if (option && typeof option === 'object') {
                return optionValue(option.value ?? option.name, option.label ?? option.title);
            }
            return optionValue(option);
        })
        .filter((option) => option.value);
}

function optionValue(value, label) {
    const stringValue = String(value ?? '').trim();
    if (!stringValue) {
        return null;
    }
    return {
        value: stringValue,
        label: String(label ?? optionLabel(stringValue)),
        enumConstant: constant(stringValue)
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

function pascal(value) {
    return optionLabel(value).replace(/\s/g, '');
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

module.exports = {
    fieldOptionsFor,
    collectFieldOptionEnums
};
