/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const { constant, pascal, safeIdentifier } = require('../../../axon5/app/model-helpers');

function simulationFiles(model, options = {}) {
    const root = trimRoot(options.root ?? 'simulation/generated');
    const target = options.target ?? 'all';
    const files = {};

    if (target === 'all' || target === 'model') {
        files[`${root}/model/simulation-model.json`] = `${JSON.stringify(model, null, 2)}\n`;
    }
    if (target === 'all' || target === 'runtime') {
        Object.assign(files, runtimeFiles(root, model));
    }
    if (target === 'all' || target === 'scenarios') {
        Object.assign(files, scenarioFiles(root, model));
    }
    if (target === 'all') {
        files[`${root}/README.md`] = renderReadme(model);
    }

    return files;
}

function runtimeFiles(root, model) {
    return {
        [`${root}/runtime/SimulationScenario.kt`]: renderSimulationScenario(model),
        [`${root}/runtime/SimulationStep.kt`]: renderSimulationStep(model),
        [`${root}/runtime/SimulationContext.kt`]: renderSimulationContext(model),
        [`${root}/runtime/SimulationPorts.kt`]: renderSimulationPorts(model),
        [`${root}/runtime/SimulationRunner.kt`]: renderSimulationRunner(model),
        [`${root}/runtime/ScenarioPlanner.kt`]: renderScenarioPlanner(model),
        [`${root}/data/SimulationDataGenerator.kt`]: renderDataGenerator(model),
        [`${root}/GeneratedSimulationScenarios.kt`]: renderScenarioRegistry(model),
        [`${root}/SimulationMain.kt`]: renderSimulationMain(model)
    };
}

function scenarioFiles(root, model) {
    return Object.fromEntries(model.scenarios.map((scenario) => [
        `${root}/scenarios/${scenario.className}.kt`,
        renderScenario(model, scenario)
    ]));
}

function renderSimulationScenario(model) {
    return `package ${runtimePackage(model)}

interface SimulationScenario {
    val id: String
    val name: String
    val kind: ScenarioKind
    val context: String
    val steps: List<SimulationStepDefinition>

    fun execute(
        runner: SimulationRunner,
        context: SimulationContext
    ): SimulationResult
}

enum class ScenarioKind {
    FLOW,
    SPECIFICATION
}

data class SimulationResult(
    val scenarioId: String,
    val scenarioName: String,
    val success: Boolean,
    val failedStep: String? = null,
    val message: String? = null
)
`;
}

function renderSimulationStep(model) {
    return `package ${runtimePackage(model)}

enum class StepExecution {
    COMMAND,
    AUTOMATIC
}

data class SimulationStepDefinition(
    val id: String,
    val title: String,
    val slice: String,
    val command: String,
    val execution: StepExecution,
    val inputs: List<SimulationInputDefinition> = emptyList(),
    val expectedEvents: List<String> = emptyList(),
    val expectedRejection: String? = null,
    val triggeredBy: String? = null
)

data class SimulationInputDefinition(
    val name: String,
    val type: String,
    val source: InputSourceDefinition
)

sealed class InputSourceDefinition {
    data object Generated : InputSourceDefinition()
    data class Constant(val value: String?) : InputSourceDefinition()
    data class PreviousStep(val stepId: String, val field: String) : InputSourceDefinition()
    data class PreviousEvent(val event: String, val field: String) : InputSourceDefinition()
}
`;
}

function renderSimulationContext(model) {
    return `package ${runtimePackage(model)}

import ${dataPackage(model)}.SimulationDataGenerator

class SimulationContext(
    val seed: Long
) {
    val data: SimulationDataGenerator = SimulationDataGenerator(seed)
    private val values: MutableMap<String, Any?> = linkedMapOf()
    private val stepResults: MutableMap<String, Any?> = linkedMapOf()
    private val events: MutableMap<String, Any?> = linkedMapOf()

    fun put(key: String, value: Any?) {
        values[key] = value
    }

    fun get(key: String): Any? = values[key]

    @Suppress("UNCHECKED_CAST")
    fun <T> value(key: String): T =
        values[key] as? T ?: error("Simulation context value not found: $key")

    @Suppress("UNCHECKED_CAST")
    fun <T> remember(key: String, supplier: () -> T): T {
        if (!values.containsKey(key)) {
            values[key] = supplier()
        }
        return values[key] as T
    }

    fun putStepResult(stepId: String, result: Any?) {
        stepResults[stepId] = result
    }

    fun putEvent(eventType: String, event: Any?) {
        events[eventType] = event
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> eventValue(eventType: String, field: String): T {
        val event = events[eventType] ?: error("Simulation event not found: $eventType")
        return readField(event, field) as? T
            ?: error("Simulation event field not found: $eventType.$field")
    }

    private fun readField(source: Any, field: String): Any? {
        if (source is Map<*, *>) {
            return source[field]
        }
        val getterName = "get" + field.replaceFirstChar { it.uppercase() }
        val getter = source.javaClass.methods.firstOrNull {
            it.name == getterName && it.parameterCount == 0
        }
        if (getter != null) {
            return getter.invoke(source)
        }
        val declaredField = source.javaClass.declaredFields.firstOrNull { it.name == field }
        if (declaredField != null) {
            declaredField.isAccessible = true
            return declaredField.get(source)
        }
        return null
    }
}
`;
}

function renderSimulationPorts(model) {
    return `package ${runtimePackage(model)}

import kotlin.reflect.KClass

data class CommandExecutionResult(
    val success: Boolean,
    val result: Any? = null,
    val message: String? = null
) {
    companion object {
        fun succeeded(result: Any? = null): CommandExecutionResult =
            CommandExecutionResult(success = true, result = result)

        fun failed(message: String, result: Any? = null): CommandExecutionResult =
            CommandExecutionResult(success = false, result = result, message = message)
    }
}

interface SimulationCommandExecutor {
    fun execute(command: Any): CommandExecutionResult
}

interface SimulationEventObserver {
    fun awaitEvent(eventType: KClass<*>, eventName: String): Any?
}

interface SimulationLogger {
    fun log(message: String)
}

class ConsoleSimulationLogger : SimulationLogger {
    override fun log(message: String) {
        println(message)
    }
}

class LoggingSimulationCommandExecutor : SimulationCommandExecutor {
    override fun execute(command: Any): CommandExecutionResult =
        CommandExecutionResult.succeeded(command)
}

class RecordingSimulationEventObserver : SimulationEventObserver {
    override fun awaitEvent(eventType: KClass<*>, eventName: String): Any? = null
}
`;
}

function renderSimulationRunner(model) {
    return `package ${runtimePackage(model)}

import kotlin.reflect.KClass

class SimulationRunner(
    private val commandExecutor: SimulationCommandExecutor,
    private val eventObserver: SimulationEventObserver,
    private val logger: SimulationLogger = ConsoleSimulationLogger()
) {
    fun run(scenario: SimulationScenario, seed: Long): SimulationResult {
        val context = SimulationContext(seed)
        return try {
            scenario.execute(this, context)
        } catch (error: Throwable) {
            logger.log("")
            logger.log("Scenario FAILED")
            logger.log(error.message ?: error::class.simpleName.orEmpty())
            SimulationResult(
                scenarioId = scenario.id,
                scenarioName = scenario.name,
                success = false,
                message = error.message
            )
        }
    }

    fun beginScenario(scenario: SimulationScenario, context: SimulationContext) {
        logger.log("[SIMULATION]")
        logger.log("Scenario: ${'$'}{scenario.name}")
        logger.log("Seed: ${'$'}{context.seed}")
        logger.log("")
    }

    fun step(
        index: Int,
        total: Int,
        id: String,
        title: String,
        execution: StepExecution,
        block: () -> Unit
    ) {
        logger.log("[${'$'}index/${'$'}total] ${'$'}title")
        logger.log(execution.name)
        block()
        logger.log("PASS")
        logger.log("")
    }

    fun command(commandName: String, command: Any, context: SimulationContext): CommandExecutionResult {
        logger.log("COMMAND")
        logger.log(commandName)
        val result = commandExecutor.execute(command)
        context.putStepResult(commandName, result)
        if (!result.success) {
            error(result.message ?: "Command execution failed: ${'$'}commandName")
        }
        return result
    }

    fun automatic(commandName: String, trigger: String?) {
        logger.log("AUTO STEP expected: ${'$'}commandName")
        if (!trigger.isNullOrBlank()) {
            logger.log("triggered by ${'$'}trigger")
        }
    }

    fun expectEvent(
        eventType: KClass<*>,
        eventName: String,
        context: SimulationContext,
        fallbackFields: Map<String, Any?> = emptyMap()
    ): Any? {
        logger.log("EVENT")
        logger.log(eventName)
        val observed = eventObserver.awaitEvent(eventType, eventName)
        val event = observed ?: fallbackFields
        context.putEvent(eventName, event)
        return event
    }

    fun expectRejection(reason: String?) {
        logger.log("EXPECTED REJECTION")
        logger.log(reason ?: "Command rejected")
    }

    fun given(title: String, fields: Map<String, Any?>, supported: Boolean, reason: String?) {
        logger.log("GIVEN")
        logger.log(title)
        if (!supported) {
            logger.log("UNSUPPORTED PREPARATION")
            logger.log(reason ?: "Given state requires project-specific preparation.")
        }
        if (fields.isNotEmpty()) {
            logger.log(fields.toString())
        }
        logger.log("")
    }

    fun pass(scenario: SimulationScenario, context: SimulationContext): SimulationResult {
        logger.log("Scenario PASSED")
        return SimulationResult(
            scenarioId = scenario.id,
            scenarioName = scenario.name,
            success = true
        )
    }
}
`;
}

function renderScenarioPlanner(model) {
    return `package ${runtimePackage(model)}

interface ScenarioPlanner {
    fun plan(): List<SimulationScenario>
}

class ModelBasedScenarioPlanner(
    private val scenarios: List<SimulationScenario>
) : ScenarioPlanner {
    override fun plan(): List<SimulationScenario> = scenarios
}
`;
}

function renderDataGenerator(model) {
    return `package ${dataPackage(model)}

import java.math.BigDecimal
import java.math.RoundingMode
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.UUID

class SimulationDataGenerator(
    private val seed: Long
) {
    fun uuid(key: String): UUID =
        UUID.nameUUIDFromBytes("${'$'}seed:${'$'}key".toByteArray(StandardCharsets.UTF_8))

    fun string(key: String, label: String = "sample"): String =
        "${'$'}{slug(label)}-${'$'}{(positiveHash(key) % 999 + 1).toString().padStart(3, '0')}"

    fun email(key: String): String =
        "sample-${'$'}{positiveHash(key) % 10000}@example.test"

    fun int(key: String, min: Int = 1, max: Int = 999): Int =
        min + (positiveHash(key) % (max - min + 1)).toInt()

    fun long(key: String, min: Long = 1_000L, max: Long = 999_999L): Long =
        min + (positiveHash(key) % (max - min + 1))

    fun double(key: String): Double =
        (positiveHash(key) % 10_000).toDouble() / 100.0

    fun float(key: String): Float =
        double(key).toFloat()

    fun decimal(key: String): BigDecimal =
        BigDecimal.valueOf((positiveHash(key) % 10_000).toDouble() / 1_000.0)
            .setScale(3, RoundingMode.HALF_UP)

    fun boolean(key: String): Boolean =
        positiveHash(key) % 2L == 0L

    fun localDate(key: String): LocalDate =
        LocalDate.of(2026, 1, 1).plusDays(positiveHash(key) % 28)

    fun localDateTime(key: String): LocalDateTime =
        LocalDateTime.of(2026, 1, 1, 10, 0).plusMinutes(positiveHash(key) % 1440)

    fun instant(key: String): Instant =
        Instant.parse("2026-01-01T00:00:00Z").plusSeconds(positiveHash(key) % 86_400)

    private fun positiveHash(key: String): Long {
        var hash = 1125899906842597L + seed
        for (char in key) {
            hash = 31L * hash + char.code
        }
        return if (hash == Long.MIN_VALUE) Long.MAX_VALUE else kotlin.math.abs(hash)
    }

    private fun slug(value: String): String =
        value
            .replace(Regex("([a-z0-9])([A-Z])"), "$1-$2")
            .replace(Regex("[^A-Za-z0-9]+"), "-")
            .trim('-')
            .lowercase()
            .ifBlank { "sample" }
}
`;
}

function renderScenarioRegistry(model) {
    const packageName = generatedPackage(model);
    const scenarioImports = model.scenarios
        .map((scenario) => `import ${scenarioPackage(model)}.${scenario.className}`)
        .join('\n');
    const scenarios = model.scenarios
        .map((scenario) => `        ${scenario.className}()`)
        .join(',\n');
    return `package ${packageName}

import ${runtimePackage(model)}.SimulationScenario
${scenarioImports}

object GeneratedSimulationScenarios {
    val all: List<SimulationScenario> = listOf(
${scenarios}
    )
}
`;
}

function renderSimulationMain(model) {
    return `package ${generatedPackage(model)}

import ${runtimePackage(model)}.LoggingSimulationCommandExecutor
import ${runtimePackage(model)}.RecordingSimulationEventObserver
import ${runtimePackage(model)}.SimulationRunner
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    val scenarioName = argument(args, "scenario")
    val seed = argument(args, "seed")?.toLongOrNull() ?: ${model.defaultSeed}L
    val scenarios = GeneratedSimulationScenarios.all
    val scenario = scenarioName
        ?.let { requested ->
            scenarios.find { it.id == requested || it.name == requested || it::class.simpleName == requested }
        }
        ?: scenarios.firstOrNull()
        ?: error("No generated simulation scenarios.")

    val result = SimulationRunner(
        commandExecutor = LoggingSimulationCommandExecutor(),
        eventObserver = RecordingSimulationEventObserver()
    ).run(scenario, seed)

    if (!result.success) {
        exitProcess(1)
    }
}

private fun argument(args: Array<String>, name: String): String? {
    val prefix = "-P${'$'}name="
    val longPrefix = "--${'$'}name="
    return args.firstOrNull { it.startsWith(prefix) }?.removePrefix(prefix)
        ?: args.firstOrNull { it.startsWith(longPrefix) }?.removePrefix(longPrefix)
}
`;
}

function renderScenario(model, scenario) {
    const steps = scenario.steps ?? [];
    return `package ${scenarioPackage(model)}

import ${runtimePackage(model)}.*

class ${scenario.className} : SimulationScenario {
    override val id: String = "${escapeKotlin(scenario.id)}"
    override val name: String = "${escapeKotlin(scenario.name)}"
    override val kind: ScenarioKind = ScenarioKind.${scenario.kind}
    override val context: String = "${escapeKotlin(scenario.context)}"
    override val steps: List<SimulationStepDefinition> = listOf(
${steps.map((step) => renderStepDefinition(step)).join(',\n')}
    )

    override fun execute(
        runner: SimulationRunner,
        context: SimulationContext
    ): SimulationResult {
        runner.beginScenario(this, context)
${renderGivenBlocks(scenario)}
${steps.map((step, index) => renderExecutableStep(model, step, index + 1, steps.length)).join('\n')}
        return runner.pass(this, context)
    }
}
`;
}

function renderStepDefinition(step) {
    return `        SimulationStepDefinition(
            id = "${escapeKotlin(step.id)}",
            title = "${escapeKotlin(step.title)}",
            slice = "${escapeKotlin(step.slice)}",
            command = "${escapeKotlin(step.command)}",
            execution = StepExecution.${step.execution},
            inputs = listOf(
${(step.inputs ?? []).map((input) => renderInputDefinition(input)).join(',\n')}
            ),
            expectedEvents = ${stringList((step.expectedEvents ?? []).map((event) => event.name))},
            expectedRejection = ${step.expectedRejection ? kotlinString(step.expectedRejection.reason) : 'null'},
            triggeredBy = ${step.triggeredBy ? kotlinString(step.triggeredBy.reaction) : 'null'}
        )`;
}

function renderInputDefinition(input) {
    return `                SimulationInputDefinition(
                    name = "${escapeKotlin(input.name)}",
                    type = "${escapeKotlin(input.type)}",
                    source = ${renderInputSourceDefinition(input.source)}
                )`;
}

function renderInputSourceDefinition(source) {
    if (!source || source.kind === 'Generated') return 'InputSourceDefinition.Generated';
    if (source.kind === 'Constant') return `InputSourceDefinition.Constant(${kotlinString(source.value)})`;
    if (source.kind === 'PreviousStep') {
        return `InputSourceDefinition.PreviousStep("${escapeKotlin(source.stepId)}", "${escapeKotlin(source.field)}")`;
    }
    if (source.kind === 'PreviousEvent') {
        return `InputSourceDefinition.PreviousEvent("${escapeKotlin(source.event)}", "${escapeKotlin(source.field)}")`;
    }
    return 'InputSourceDefinition.Generated';
}

function renderGivenBlocks(scenario) {
    const given = scenario.given ?? [];
    if (given.length === 0) return '';
    return given.map((item) => {
        const fieldPairs = (item.fields ?? [])
            .filter((field) => field.name)
            .map((field) => `            "${escapeKotlin(field.name)}" to ${kotlinString(field.value)}`)
            .join(',\n');
        const fields = fieldPairs
            ? `mapOf(\n${fieldPairs}\n            )`
            : 'emptyMap()';
        return `        runner.given(
            title = "${escapeKotlin(item.title)}",
            fields = ${fields},
            supported = ${Boolean(item.supported)},
            reason = ${kotlinString(item.reason)}
        )`;
    }).join('\n');
}

function renderExecutableStep(model, step, index, total) {
    const inputs = step.inputs ?? [];
    const variableLines = inputs.flatMap((input) => renderInputVariable(input, step));
    const commandCall = step.execution === 'AUTOMATIC'
        ? `runner.automatic(
    commandName = "${escapeKotlin(step.command)}",
    trigger = ${kotlinString(step.triggeredBy?.reaction)}
)`
        : renderCommandCall(step, inputs);
    const expectations = renderExpectations(step, inputs);
    return `        runner.step(
            index = ${index},
            total = ${total},
            id = "${escapeKotlin(step.id)}",
            title = "${escapeKotlin(step.title)}",
            execution = StepExecution.${step.execution}
        ) {
${indentLines([...variableLines, commandCall, expectations].filter(Boolean).join('\n'), 12)}
        }`;
}

function renderInputVariable(input, step) {
    const localName = localVariableName(input.name);
    const key = `${step.id}.${input.name}`;
    const expression = expressionForInput(input, key);
    return [
        `val ${localName} = ${expression}`,
        `context.put("${escapeKotlin(key)}", ${localName})`
    ];
}

function renderCommandCall(step, inputs) {
    const args = inputs.map((input) => {
        return `    ${input.name} = ${localVariableName(input.name)}`;
    }).join(',\n');
    const constructor = args
        ? `${step.commandFqcn}(\n${args}\n)`
        : `${step.commandFqcn}()`;
    return `val command = ${constructor}
runner.command(
    commandName = "${escapeKotlin(step.command)}",
    command = command,
    context = context
)`;
}

function renderExpectations(step, inputs) {
    const eventExpectations = (step.expectedEvents ?? []).map((event) => {
        const fallbackFields = fallbackEventFields(event, inputs);
        return `runner.expectEvent(
    eventType = ${event.fqcn}::class,
    eventName = "${escapeKotlin(event.name)}",
    context = context,
    fallbackFields = ${fallbackFields}
)`;
    });
    if (step.expectedRejection) {
        eventExpectations.push(`runner.expectRejection(${kotlinString(step.expectedRejection.reason)})`);
    }
    return eventExpectations.join('\n');
}

function fallbackEventFields(event, inputs) {
    const inputNames = new Set(inputs.map((input) => input.name));
    const pairs = (event.fields ?? [])
        .filter((field) => inputNames.has(field.name))
        .map((field) => `        "${escapeKotlin(field.name)}" to ${localVariableName(field.name)}`);
    if (pairs.length === 0) return 'emptyMap()';
    return `mapOf(
${pairs.join(',\n')}
    )`;
}

function expressionForInput(input, key) {
    const source = input.source ?? { kind: 'Generated' };
    if (source.kind === 'PreviousEvent') {
        return `context.eventValue<${input.kotlinType}>("${escapeKotlin(source.event)}", "${escapeKotlin(source.field)}")`;
    }
    if (source.kind === 'PreviousStep') {
        return `context.value<${input.kotlinType}>("${escapeKotlin(source.stepId)}.${escapeKotlin(source.field)}")`;
    }
    if (source.kind === 'Constant') {
        return constantExpression(source.value, input.typeInfo, key, input.label);
    }
    return `context.remember("${escapeKotlin(key)}") { ${generatedExpression(input.typeInfo, key, input.label)} }`;
}

function generatedExpression(typeInfo, key, label) {
    if (typeInfo.list) {
        return `listOf(${generatedExpression({ ...typeInfo, list: false, kotlinType: innerKotlinType(typeInfo) }, `${key}.item`, label)})`;
    }
    if (typeInfo.kind === 'value-scalar') {
        return `${typeInfo.fqcn}(${generatedExpression(typeInfo.base, `${key}.value`, label)})`;
    }
    if (typeInfo.kind === 'value-object') {
        const args = (typeInfo.fields ?? []).map((field) => {
            const fieldInfo = nestedTypeInfo(field);
            return `    ${field.name} = ${generatedExpression(fieldInfo, `${key}.${field.name}`, field.name)}`;
        }).join(',\n');
        return `${typeInfo.fqcn}(\n${args}\n)`;
    }
    if (typeInfo.kind === 'enum') {
        return `${typeInfo.fqcn}.values().first()`;
    }
    switch (typeInfo.baseType) {
        case 'UUID': return `context.data.uuid("${escapeKotlin(key)}")`;
        case 'Int': return `context.data.int("${escapeKotlin(key)}")`;
        case 'Long': return `context.data.long("${escapeKotlin(key)}")`;
        case 'Double': return `context.data.double("${escapeKotlin(key)}")`;
        case 'Float': return `context.data.float("${escapeKotlin(key)}")`;
        case 'BigDecimal': return `context.data.decimal("${escapeKotlin(key)}")`;
        case 'Boolean': return `context.data.boolean("${escapeKotlin(key)}")`;
        case 'LocalDate': return `context.data.localDate("${escapeKotlin(key)}")`;
        case 'LocalDateTime': return `context.data.localDateTime("${escapeKotlin(key)}")`;
        case 'Instant': return `context.data.instant("${escapeKotlin(key)}")`;
        case 'String':
        default:
            return String(label ?? key).toLowerCase().includes('email')
                ? `context.data.email("${escapeKotlin(key)}")`
                : `context.data.string("${escapeKotlin(key)}", "${escapeKotlin(label ?? 'sample')}")`;
    }
}

function constantExpression(value, typeInfo, key, label) {
    if (value === null || value === undefined || value === '') {
        return typeInfo.optional ? 'null' : generatedExpression(typeInfo, key, label);
    }
    if (typeInfo.list) {
        return `listOf(${constantExpression(value, { ...typeInfo, list: false, kotlinType: innerKotlinType(typeInfo) }, `${key}.item`, label)})`;
    }
    if (typeInfo.kind === 'value-scalar') {
        return `${typeInfo.fqcn}(${constantExpression(value, typeInfo.base, `${key}.value`, label)})`;
    }
    if (typeInfo.kind === 'value-object') {
        return generatedExpression(typeInfo, key, label);
    }
    if (typeInfo.kind === 'enum') {
        const enumValue = constant(String(value));
        const values = (typeInfo.values ?? []).map((item) => constant(item));
        return values.includes(enumValue)
            ? `${typeInfo.fqcn}.${enumValue}`
            : `${typeInfo.fqcn}.values().first()`;
    }
    switch (typeInfo.baseType) {
        case 'UUID':
            return isUuid(value)
                ? `java.util.UUID.fromString("${escapeKotlin(value)}")`
                : `context.data.uuid("literal:${escapeKotlin(value)}")`;
        case 'Int': {
            const number = Number.parseInt(value, 10);
            return Number.isFinite(number) ? String(number) : `context.data.int("literal:${escapeKotlin(value)}")`;
        }
        case 'Long': {
            const number = Number.parseInt(value, 10);
            return Number.isFinite(number) ? `${number}L` : `context.data.long("literal:${escapeKotlin(value)}")`;
        }
        case 'Double': {
            const number = Number.parseFloat(value);
            return Number.isFinite(number) ? String(number) : `context.data.double("literal:${escapeKotlin(value)}")`;
        }
        case 'Float': {
            const number = Number.parseFloat(value);
            return Number.isFinite(number) ? `${number}f` : `context.data.float("literal:${escapeKotlin(value)}")`;
        }
        case 'BigDecimal': {
            const number = Number.parseFloat(value);
            return Number.isFinite(number)
                ? `java.math.BigDecimal("${escapeKotlin(value)}")`
                : `context.data.decimal("literal:${escapeKotlin(value)}")`;
        }
        case 'Boolean':
            if (String(value).toLowerCase() === 'true') return 'true';
            if (String(value).toLowerCase() === 'false') return 'false';
            return `context.data.boolean("literal:${escapeKotlin(value)}")`;
        case 'LocalDate':
            return `java.time.LocalDate.parse("${escapeKotlin(value)}")`;
        case 'LocalDateTime':
            return `java.time.LocalDateTime.parse("${escapeKotlin(value)}")`;
        case 'Instant':
            return `java.time.Instant.parse("${escapeKotlin(value)}")`;
        case 'String':
        default:
            return kotlinString(value);
    }
}

function nestedTypeInfo(field) {
    const base = primitiveType(field.type);
    const list = ['multiple', 'list'].includes(String(field.cardinality ?? 'Single').toLowerCase());
    const typeInfo = base ?? { kind: 'scalar', kotlinType: 'String', baseType: 'String' };
    return {
        ...typeInfo,
        list,
        optional: Boolean(field.optional),
        kotlinType: list ? `List<${typeInfo.kotlinType}>` : typeInfo.kotlinType
    };
}

function primitiveType(type) {
    switch (String(type ?? 'String').toLowerCase()) {
        case 'uuid': return { kind: 'scalar', kotlinType: 'java.util.UUID', baseType: 'UUID' };
        case 'int':
        case 'integer': return { kind: 'scalar', kotlinType: 'Int', baseType: 'Int' };
        case 'long': return { kind: 'scalar', kotlinType: 'Long', baseType: 'Long' };
        case 'double':
        case 'number': return { kind: 'scalar', kotlinType: 'Double', baseType: 'Double' };
        case 'float': return { kind: 'scalar', kotlinType: 'Float', baseType: 'Float' };
        case 'decimal':
        case 'bigdecimal': return { kind: 'scalar', kotlinType: 'java.math.BigDecimal', baseType: 'BigDecimal' };
        case 'boolean': return { kind: 'scalar', kotlinType: 'Boolean', baseType: 'Boolean' };
        case 'date':
        case 'localdate': return { kind: 'scalar', kotlinType: 'java.time.LocalDate', baseType: 'LocalDate' };
        case 'datetime':
        case 'localdatetime': return { kind: 'scalar', kotlinType: 'java.time.LocalDateTime', baseType: 'LocalDateTime' };
        case 'instant': return { kind: 'scalar', kotlinType: 'java.time.Instant', baseType: 'Instant' };
        case 'string':
        default: return { kind: 'scalar', kotlinType: 'String', baseType: 'String' };
    }
}

function innerKotlinType(typeInfo) {
    const match = String(typeInfo.kotlinType ?? '').match(/^List<(.+)>$/);
    return match ? match[1] : typeInfo.kotlinType;
}

function renderReadme(model) {
    const scenarioList = model.scenarios
        .map((scenario) => `- ${scenario.id}: ${scenario.name} (${scenario.kind})`)
        .join('\n');
    return `# Medol Simulation

Generated by the Medol simulation generator.

## Scenarios

${scenarioList || '- none'}

## Run Shape

The generated runtime is command-first and system-port based:

\`\`\`text
SimulationScenario
  -> SimulationRunner
  -> SimulationCommandExecutor
  -> SimulationEventObserver
\`\`\`

The default generated executor only logs commands and uses fallback event fields so scenario flow can be inspected without infrastructure. Wire a project-specific executor/observer in \`simulation/extension\` when you want to drive a real Axon or HTTP runtime.

Same scenario + same seed + same model version produces the same generated command input values.
`;
}

function generatedPackage(model) {
    return `${model.rootPackage}.simulation.generated`;
}

function runtimePackage(model) {
    return `${generatedPackage(model)}.runtime`;
}

function dataPackage(model) {
    return `${generatedPackage(model)}.data`;
}

function scenarioPackage(model) {
    return `${generatedPackage(model)}.scenarios`;
}

function localVariableName(value) {
    return safeIdentifier(String(value ?? 'value').replace(/^[A-Z]/, (char) => char.toLowerCase()));
}

function stringList(values) {
    return values.length > 0
        ? `listOf(${values.map(kotlinString).join(', ')})`
        : 'emptyList()';
}

function kotlinString(value) {
    if (value === null || value === undefined) return 'null';
    return `"${escapeKotlin(value)}"`;
}

function escapeKotlin(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

function indentLines(value, count) {
    const prefix = ' '.repeat(count);
    return String(value ?? '').split('\n').map((line) => line ? `${prefix}${line}` : line).join('\n');
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

function trimRoot(value) {
    return String(value ?? '').replace(/^\/+|\/+$/g, '') || '.';
}

module.exports = {
    renderScenario,
    simulationFiles
};
