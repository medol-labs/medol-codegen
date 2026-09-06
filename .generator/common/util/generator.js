/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const {configureValueTypes, conceptState, conceptStateImport, isValueType, valueTypeImport} = require('./value-types');

class ClassesGenerator {

    static generateDataClass(name, fields) {
        return `data class ${name}(${this.generateVariables(fields, ",\n")})`
    }

    static generateVariables(fields, separator = "\n") {

        return fields?.map((variable) => {
            if (variable.cardinality?.toLowerCase() === "list") {
                return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
            } else {
                if (variable.type?.toLowerCase() === "date") {
                    return `\t@JsonFormat(pattern = "dd.MM.yyyy") var ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
                } else if (variable.type?.toLowerCase() === "datetime") {
                    return `\t@JsonFormat(pattern = "dd.MM.yyyy HH:mm:ss") var ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;
                } else {
                    return `\tvar ${variable.name}:${typeMapping(variable.type, variable.cardinality, variable.optional)}`;

                }
            }
        }).join(separator)
    }

}


function idType(element) {
    var idField = element.fields?.find(it => it.idAttribute)
    return idField ? typeMapping(idField.type, idField.cardinality, idField.optional, idField.mutable) : "java.util.UUID"
}

const typeMapping = (fieldType, fieldCardinality, optional, mutable) => {
    const isList = fieldCardinality?.toLowerCase() === "list";
    const typeOptional = isList ? false : optional;
    var fieldType;
    switch (fieldType?.toLowerCase()) {
        case "string":
        case "text":
            fieldType = typeOptional ? "String?" : "String";
            break
        case "double":
            fieldType = typeOptional ? "Double?" : "Double";
            break
        case "float":
            fieldType = typeOptional ? "Float?" : "Float";
            break
        case "decimal":
        case "bigdecimal":
            fieldType = typeOptional ? "BigDecimal?" : "BigDecimal";
            break
        case "number":
            fieldType = typeOptional ? "Double?" : "Double";
            break
        case "int":
            fieldType = typeOptional ? "Int?" : "Int";
            break
        case "long":
            fieldType = typeOptional ? "Long?" : "Long";
            break
        case "boolean":
            fieldType = typeOptional ? "Boolean?" : "Boolean";
            break
        case "date":
            fieldType = typeOptional ? "LocalDate?" : "LocalDate";
            break
        case "datetime":
            fieldType = typeOptional ? "LocalDateTime?" : "LocalDateTime";
            break
        case "uuid":
            fieldType = typeOptional ? "UUID?" : "UUID";
            break
        default: {
            const state = conceptState(fieldType);
            fieldType = state
                ? (typeOptional ? `${state.typeName}?` : state.typeName)
                : isValueType(fieldType)
                ? (typeOptional ? `${fieldType}?` : fieldType)
                : (typeOptional ? "String?" : "String");
            break
        }
    }
    if (isList) {
        return mutable ? `MutableList<${fieldType}>` : `List<${fieldType}>`
    } else {
        return fieldType
    }

}

const typeImports = (fields, additionalImports) => {
    if (!fields || fields.length === 0) {
        return []
    }
    var imports = fields?.map((field) => {
        switch (field.type?.toLowerCase()) {
            case "date":
                return ["import java.time.LocalDate", "import org.springframework.format.annotation.DateTimeFormat", "import com.fasterxml.jackson.annotation.JsonFormat"]
            case "datetime":
                return ["import java.time.LocalDateTime", "import org.springframework.format.annotation.DateTimeFormat", "import com.fasterxml.jackson.annotation.JsonFormat"]
            case "uuid":
                return ["import java.util.UUID"]
            case "decimal":
            case "bigdecimal":
                return ["import java.math.BigDecimal"]
        }
        if (isValueType(field.type)) {
            return [valueTypeImport(field.type)]
        }
        if (conceptState(field.type)) {
            return [conceptStateImport(field.type)]
        }
        switch (field.cardinality?.toLowerCase()) {
            case "list":
                return ["import kotlin.collections.List"]
            default:
                return []
        }
    }).concat(additionalImports)
    return Array.from([...new Set(imports?.flat() ?? [])]).flat().join(";\n")

}

module.exports = {ClassesGenerator, configureValueTypes, typeMapping, typeImports, idType}
