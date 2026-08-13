/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {collectFieldOptionEnums} = require('../../common/core/field-options');
const {contextPackage, resolvedBaseType} = require('../../common/util/value-types');
const {
    conceptStateEnumName,
    groupByMap,
    stringList,
    pascal,
    constant,
    kotlinPrimitive,
    kotlinImports,
    renderScalarValueType,
    renderEnum,
    renderObjectValueType,
    escapeKotlin
} = require('./model-helpers');

const domainWriterMethods = {
    _writeValueTypes() {
        for (const valueType of this.model.valueTypes) {
            const packageName = `${this.model.rootPackage}.${contextPackage(valueType.context)}.domain.types`;
            const baseType = kotlinPrimitive(resolvedBaseType(valueType));
            const lines = [
                `package ${packageName}`,
                '',
                kotlinImports(baseType),
                '',
                valueType.kind === 'enum'
                    ? renderEnum(valueType)
                    : valueType.kind === 'object'
                        ? renderObjectValueType(valueType, this.model.rootPackage)
                        : renderScalarValueType(valueType, baseType)
            ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
            this.fs.write(this._rootKotlinPath(`${contextPackage(valueType.context)}/domain/types/${valueType.name}.kt`), `${lines}\n`);
        }
    },

    _writeFieldOptionEnums() {
        const optionSets = collectFieldOptionEnums(this.model);
        for (const optionSet of optionSets) {
            const values = optionSet.values.map((option) => `    ${option.enumConstant}`).join(',\n');
            this.fs.write(
                this._sharedKernelKotlinPath(`shared/domain/enums/${optionSet.enumName}.kt`),
                `package ${this.model.rootPackage}.shared.domain.enums\n\nenum class ${optionSet.enumName} {\n${values}\n}\n`
            );
        }
    },

    _writeConceptStates() {
        for (const concept of this.model.concepts.filter((candidate) => candidate.states?.length)) {
            const packageName = `${this.model.rootPackage}.${contextPackage(concept.context)}.domain.states`;
            const typeName = conceptStateEnumName(concept.name);
            const values = concept.states.map((state) => `    ${constant(state)}`).join(',\n');
            this.fs.write(
                this._rootKotlinPath(`${contextPackage(concept.context)}/domain/states/${typeName}.kt`),
                `package ${packageName}\n\nenum class ${typeName} {\n${values}\n}\n`
            );
        }
    },

    _writeConceptCatalog() {
        const byContext = groupByMap(this.model.concepts, (concept) => concept.context);
        for (const [context, concepts] of byContext.entries()) {
            const packageName = `${this.model.rootPackage}.${contextPackage(context)}.domain`;
            const body = concepts.map((concept) => [
                `    data object ${pascal(concept.name)} {`,
                `        const val NAME = "${escapeKotlin(concept.name)}"`,
                `        val slices = ${stringList(concept.slices.map((slice) => slice.name))}`,
                `        val states = ${stringList(concept.states ?? [])}`,
                '    }'
            ].join('\n')).join('\n\n');
            this.fs.write(
                this._rootKotlinPath(`${contextPackage(context)}/domain/Concepts.kt`),
                `package ${packageName}\n\nobject Concepts {\n${body}\n}\n`
            );
        }
    }
};

module.exports = {domainWriterMethods};
