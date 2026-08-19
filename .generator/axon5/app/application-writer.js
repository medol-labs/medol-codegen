/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const path = require('path');
const {configureValueTypes} = require('../../common/util/generator');
const {pascal, kebab, safeDatabaseName, safeIdentifier, filterModelByDeployment} = require('./model-helpers');
const {manualInfrastructurePortPathForCommand} = require('./infrastructure-port-writer');
const {writeMetadataSupport} = require('./metadata-support');

const SHARED_KERNEL_MODULE = 'shared-kernel';
const UMA_DB_EVENT_STORAGE_MODULE = 'axon-event-storage-umadb';

function lowerCamel(value) {
    const name = pascal(value);
    return safeIdentifier(name.charAt(0).toLowerCase() + name.slice(1));
}

const applicationWriterMethods = {
    _isMonoMode() {
        return !process.env.CODEGEN_DEPLOYMENT && (this.model.deployments ?? []).length > 1;
    },

    _writeMonoSkeleton() {
        const deployments = this.model.deployments ?? [];
        const modules = [SHARED_KERNEL_MODULE, UMA_DB_EVENT_STORAGE_MODULE, ...deployments.map((deployment) => this._deploymentModuleName(deployment))];
        const appName = this._rootAggregatorName();
        this.fs.copyTpl(this.templatePath('mono-pom.xml.tpl'), this.destinationPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName,
            modules
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this.destinationPath('README.md'), {
            appName,
            domain: this.model.domain,
            rootPackage: this.model.rootPackage,
            appPort: 8080,
            dbPort: 5432,
            umadbPort: 50051,
            dbName: safeDatabaseName(appName),
            modulePrefix: '',
            hasInfra: true
        });
        this.fs.copy(this.templatePath('gitignore'), this.destinationPath('.gitignore'));
        this._copyMavenWrapper();
        this._writeDevSeedScript();
        this._writeAgentSkills();
        this._writeSharedKernelModule();
        this._writeInfraModule();
        deployments.forEach((deployment) => this._withDeployment(deployment, () => this._writeSkeleton()));
    },

    _writeMonoSlices() {
        for (const deployment of this.model.deployments ?? []) {
            this._withDeployment(deployment, () => {
                const selected = this.answers.sliceNames ?? this.model.slices.map((slice) => slice.title);
                const selectedSlices = this.model.slices.filter((slice) => selected.includes(slice.title));
                selectedSlices.forEach((slice) => this._writeSlice(slice));
                this._writeConceptEntityStates(selectedSlices);
            });
        }
    },

    _withDeployment(deployment, write) {
        const previousModel = this.model;
        const previousPrefix = this.modulePrefix;
        const previousDeployment = this.currentDeployment;
        const previousDeploymentIndex = this.currentDeploymentIndex;
        const deploymentIndex = deployment.index ?? (previousModel.deployments ?? []).findIndex((candidate) => candidate.name === deployment.name);
        this.model = filterModelByDeployment(previousModel, deployment);
        this.modulePrefix = this._deploymentModuleName(deployment);
        this.currentDeployment = deployment;
        this.currentDeploymentIndex = deploymentIndex >= 0 ? deploymentIndex : 0;
        configureValueTypes(this.model.valueTypes, this.model.rootPackage, this.model.concepts);
        try {
            write();
        } finally {
            this.model = previousModel;
            this.modulePrefix = previousPrefix;
            this.currentDeployment = previousDeployment;
            this.currentDeploymentIndex = previousDeploymentIndex;
            configureValueTypes(this.model.valueTypes, this.model.rootPackage, this.model.concepts);
        }
    },

    _deploymentModuleName(deployment) {
        return kebab(deployment.name) || 'application';
    },

    _rootAggregatorName() {
        const appName = kebab(this.model.domain) || 'medol-application';
        return `${appName}-parent`;
    },

    _usesInfraModule() {
        return Boolean(this.modulePrefix || this.model.deployment || process.env.CODEGEN_DEPLOYMENT);
    },

    _writeSkeleton() {
        const appName = kebab(this.model.domain) || 'medol-application';
        const applicationClass = `${pascal(this.model.domain)}Application`;
        const runtime = this._runtimeConfig(appName);
        const hasInfra = this._usesInfraModule();
        this.fs.copyTpl(this.templatePath('pom.xml.tpl'), this._destPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName,
            appPort: runtime.appPort,
            hasInfra,
            hasSharedKernel: this._usesSharedKernelModule()
        });
        this.fs.copyTpl(this.templatePath('Application.kt.tpl'), this._rootKotlinPath('Application.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this._destPath('README.md'), {
            appName,
            domain: this.model.domain,
            rootPackage: this.model.rootPackage,
            modulePrefix: this.modulePrefix,
            hasInfra,
            appPort: runtime.appPort,
            dbPort: runtime.dbPort,
            umadbPort: runtime.umadbPort,
            dbName: runtime.dbName
        });
        this.fs.copyTpl(this.templatePath('ApplicationTest.kt.tpl'), this._rootTestKotlinPath('ApplicationTest.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        if (!this._usesSharedKernelModule()) {
            this._writeSharedKernelArtifacts({hasInfra});
        }
        this.fs.copyTpl(this.templatePath('application.yml'), this._destPath('src/main/resources/application.yml'), {
            ...runtime,
            rootPackage: this.model.rootPackage,
            hasInfra
        });
        this.fs.copyTpl(this.templatePath('logback-spring.xml.tpl'), this._destPath('src/main/resources/logback-spring.xml'), {
            rootPackage: this.model.rootPackage
        });
        this.fs.copyTpl(this.templatePath('docker-compose.yml'), this._destPath('docker-compose.yml'), runtime);
        this.fs.copy(this.templatePath('V1__baseline.sql'), this._destPath('src/main/resources/db/migration/V1__baseline.sql'));
        this.fs.copy(this.templatePath('gitignore'), this._destPath('.gitignore'));
        if (!this.modulePrefix) {
            if (hasInfra) {
                this.fs.copyTpl(this.templatePath('env.example'), this._destPath('.env.example'), runtime);
            }
            this._copyMavenWrapper();
            this._writeDevSeedScript();
        } else if (hasInfra) {
            this.fs.copyTpl(this.templatePath('env.example'), this._destPath('.env.example'), runtime);
        }
        this._writeValueTypes();
        if (!this._usesSharedKernelModule()) {
            this._writeFieldOptionEnums();
        }
        this._writeConceptStates();
        this._writeConceptCatalog();
        this._writeExternalSystems();
        this._writeManualInfrastructureDirectories();
        if (!this.modulePrefix) {
            this._writeAgentSkills();
        }
    },

    _writeMetadataSupport() {
        writeMetadataSupport(this);
    },

    _usesSharedKernelModule() {
        return Boolean(this.modulePrefix || this.model.deployment || process.env.CODEGEN_DEPLOYMENT);
    },

    _writeSharedKernelModule() {
        this.fs.copyTpl(this.templatePath('shared-kernel/pom.xml.tpl'), this.destinationPath(`${SHARED_KERNEL_MODULE}/pom.xml`), {
            rootPackage: this.model.rootPackage
        });
        const previousWritingSharedKernel = this.writingSharedKernel;
        this.writingSharedKernel = true;
        try {
            this._writeSharedKernelArtifacts({hasInfra: true});
            this._writeFieldOptionEnums();
        } finally {
            this.writingSharedKernel = previousWritingSharedKernel;
        }
    },

    _writeSharedKernelArtifacts({hasInfra}) {
        this.fs.copyTpl(this.templatePath('OpenApiConfig.kt.tpl'), this._sharedKernelKotlinPath('shared/infrastructure/configuration/OpenApiConfig.kt'), {
            rootPackage: this.model.rootPackage,
            domain: this.model.domain
        });
        this.fs.copyTpl(this.templatePath('ApiExceptionHandler.kt.tpl'), this._sharedKernelKotlinPath('shared/infrastructure/web/ApiExceptionHandler.kt'), {
            rootPackage: this.model.rootPackage
        });
        this._writeMetadataSupport();
        this.fs.copyTpl(this.templatePath('AxonFlowLoggingConfiguration.kt.tpl'), this._sharedKernelKotlinPath('shared/application/axon/AxonFlowLoggingConfiguration.kt'), {
            rootPackage: this.model.rootPackage
        });
        this.fs.copyTpl(this.templatePath('SuppressScheduledHibernateSqlLogFilter.kt.tpl'), this._sharedKernelKotlinPath('shared/application/logging/SuppressScheduledHibernateSqlLogFilter.kt'), {
            rootPackage: this.model.rootPackage
        });
        this.fs.copyTpl(this.templatePath('AxonEventStorageConfig.kt.tpl'), this._sharedKernelKotlinPath('shared/infrastructure/configuration/AxonEventStorageConfig.kt'), {
            rootPackage: this.model.rootPackage,
            hasInfra
        });
    },

    _writeInfraModule() {
        this.fs.copyTpl(this.templatePath('infra/pom.xml.tpl'), this.destinationPath(`${UMA_DB_EVENT_STORAGE_MODULE}/pom.xml`), {
            rootPackage: this.model.rootPackage
        });
        this.fs.copyTpl(
            this.templatePath('infra/src/main/java/umadb'),
            this.destinationPath(`${UMA_DB_EVENT_STORAGE_MODULE}/src/main/java/${this.model.rootPackage.split('.').join('/')}/infra/umadb`),
            {rootPackage: this.model.rootPackage}
        );
        this.fs.copyTpl(
            this.templatePath('infra/src/test/java/umadb'),
            this.destinationPath(`${UMA_DB_EVENT_STORAGE_MODULE}/src/test/java/${this.model.rootPackage.split('.').join('/')}/infra/umadb`),
            {rootPackage: this.model.rootPackage}
        );
        this.fs.copy(this.templatePath('infra/src/main/proto'), this.destinationPath(`${UMA_DB_EVENT_STORAGE_MODULE}/src/main/proto`));
    },

    _runtimeConfig(appName) {
        const index = this.currentDeployment ? this.currentDeploymentIndex : 0;
        return {
            appName,
            appPort: 8080 + index,
            dbPort: 5432 + index,
            umadbPort: 50051 + index,
            dbName: safeDatabaseName(appName),
            composeFile: 'docker-compose.yml',
            envFile: '.env',
            dockerComposeEnabled: 'true',
            externalSystems: this._externalSystemConfigs(),
            integrationClients: this._integrationClientConfigs()
        };
    },

    _externalSystemConfigs() {
        return (this.model.externalSystems ?? []).map((external) => ({
            ...external,
            className: pascal(external.name),
            configKey: kebab(external.name),
            endpointEnv: external.endpoint?.type === 'config' ? external.endpoint.key : `${kebab(external.name).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL`
        }));
    },

    _integrationClientConfigs() {
        const localContexts = new Set((this.model.contexts ?? []).map((context) => context.name));
        return (this.fullModel?.deployments ?? this.model.deployments ?? [])
            .filter((deployment) => !(deployment.contexts ?? []).some((context) => localContexts.has(context.name)))
            .map((deployment) => {
                const configKey = kebab(deployment.name);
                return {
                    name: deployment.name,
                    configKey,
                    endpointEnv: `${configKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL`
                };
            });
    },

    _writeExternalSystems() {
        const externalSystems = this._externalSystemConfigs();
        for (const external of externalSystems) {
            this.fs.write(
                this._kotlinPath(`external/${external.className}Properties.kt`),
                this._renderExternalProperties(external)
            );
            this.fs.write(
                this._kotlinPath(`external/${external.className}Client.kt`),
                this._renderExternalClient(external)
            );
            if ((external.capabilities ?? []).some((capability) => capability.type === 'event')) {
                this.fs.write(
                    this._kotlinPath(`external/${external.className}EventResource.kt`),
                    this._renderExternalEventResource(external)
                );
            }
        }
    },

    _renderExternalProperties(external) {
        return `package ${this.model.rootPackage}.external

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "external.${external.configKey}")
data class ${external.className}Properties(
    var endpoint: String = ""
)
`;
    },

    _renderExternalClient(external) {
        const commandMethods = (external.capabilities ?? [])
            .filter((capability) => capability.type === 'command')
            .map((capability) => this._renderExternalCommandMethod(capability))
            .join('\n\n');
        return `package ${this.model.rootPackage}.external

import org.springframework.cloud.openfeign.FeignClient
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody

@FeignClient(name = "${external.configKey}", url = "\\${'${'}external.${external.configKey}.endpoint:}")
interface ${external.className}Client {
${commandMethods}
}
`;
    },

    _renderExternalCommandMethod(capability) {
        const methodName = lowerCamel(capability.name);
        const route = kebab(capability.name);
        return `    @PostMapping("/${route}")
    fun ${methodName}(@RequestBody payload: Map<String, Any?>): Any?`;
    },

    _renderExternalEventResource(external) {
        const eventMethods = (external.capabilities ?? [])
            .filter((capability) => capability.type === 'event')
            .map((capability) => this._renderExternalEventMethod(capability))
            .join('\n\n');
        return `package ${this.model.rootPackage}.external

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/external/${external.configKey}/events")
class ${external.className}EventResource {
${eventMethods}
}
`;
    },

    _renderExternalEventMethod(capability) {
        const methodName = lowerCamel(capability.name);
        const route = kebab(capability.name);
        return `    @PostMapping("/${route}")
    fun ${methodName}(@RequestBody payload: Map<String, Any?>): ResponseEntity<Void> =
        ResponseEntity.accepted().build()`;
    },

    _writeAgentSkills() {
        const agentTemplates = path.resolve(__dirname, '../../common/agent-templates');
        this.fs.copy(agentTemplates, this.destinationPath('.agent'));
    },

    _copyMavenWrapper() {
        const axonTemplates = path.resolve(__dirname, '../../axon/app/templates');
        this.fs.copy(path.join(axonTemplates, '.mvn'), this.destinationPath('.mvn'));
        this.fs.copy(path.join(axonTemplates, 'root/mvnw'), this.destinationPath('mvnw'));
        this.fs.copy(path.join(axonTemplates, 'root/mvnw.cmd'), this.destinationPath('mvnw.cmd'));
    },

    _writeDevSeedScript() {
        this.fs.copy(this.templatePath('seed-dev-data.mjs'), this.destinationPath('scripts/seed-dev-data.mjs'));
    },

    _writeManualInfrastructureDirectories() {
        this.fs.write(this._manualInfrastructurePath('.gitkeep'), '');
        this.fs.write(this._manualTestInfrastructurePath('.gitkeep'), '');
        this._writeCreateOnly(this._manualDomainPath('.gitkeep'), '');
        this._writeCreateOnly(this._manualTestDomainPath('.gitkeep'), '');
        for (const directory of this._manualInfrastructurePortDirectories()) {
            this.fs.write(this._manualInfrastructurePath(`${directory}/.gitkeep`), '');
            this.fs.write(this._manualTestInfrastructurePath(`${directory}/.gitkeep`), '');
        }
    },

    _writeCreateOnly(targetPath, contents) {
        if (this.fs.exists(targetPath)) return;
        this.fs.write(targetPath, contents);
    },

    _manualInfrastructurePortDirectories() {
        const directories = new Set();
        for (const slice of this.model.slices ?? []) {
            for (const command of slice.commands ?? []) {
                const directory = manualInfrastructurePortPathForCommand(slice, command);
                if (directory) {
                    directories.add(directory);
                }
            }
        }
        return [...directories].sort();
    },

    _kotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/context/${relative}`));
    },

    _rootKotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`));
    },

    _sharedKernelKotlinPath(relative) {
        const base = `src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`;
        return this.destinationPath((this.writingSharedKernel || this._usesSharedKernelModule()) ? `${SHARED_KERNEL_MODULE}/${base}` : this._modulePath(base));
    },

    _testKotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/context/${relative}`));
    },

    _rootTestKotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`));
    },

    _manualInfrastructurePath(relative) {
        return this.destinationPath(this._modulePath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/infrastructure/${relative}`));
    },

    _manualTestInfrastructurePath(relative) {
        return this.destinationPath(this._modulePath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/infrastructure/${relative}`));
    },

    _manualDomainPath(relative) {
        return this.destinationPath(this._modulePath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/domain/${relative}`));
    },

    _manualTestDomainPath(relative) {
        return this.destinationPath(this._modulePath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/domain/${relative}`));
    },

    _modulePath(relative) {
        return this.modulePrefix ? `${this.modulePrefix}/${relative}` : relative;
    },

    _destPath(relative) {
        return this.destinationPath(this._modulePath(relative));
    }
};

module.exports = {applicationWriterMethods};
