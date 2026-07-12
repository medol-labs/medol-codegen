/*
 * Copyright (c) 2025 Nebulit GmbH
 * Licensed under the MIT License.
 */

const path = require('path');
const {configureValueTypes} = require('../../common/util/generator');
const {pascal, kebab, safeDatabaseName, filterModelByDeployment} = require('./model-helpers');
const {writeMetadataSupport} = require('./metadata-support');

const applicationWriterMethods = {
    _isMonoMode() {
        return !process.env.CODEGEN_DEPLOYMENT && (this.model.deployments ?? []).length > 1;
    },

    _writeMonoSkeleton() {
        const deployments = this.model.deployments ?? [];
        this.fs.copyTpl(this.templatePath('mono-pom.xml.tpl'), this.destinationPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName: kebab(this.model.domain) || 'medol-application',
            modules: deployments.map((deployment) => this._deploymentModuleName(deployment))
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this.destinationPath('README.md'), {
            appName: kebab(this.model.domain) || 'medol-application',
            domain: this.model.domain,
            rootPackage: this.model.rootPackage,
            appPort: 8080,
            dbPort: 5432,
            dbName: safeDatabaseName(kebab(this.model.domain) || 'medol-application'),
            modulePrefix: ''
        });
        this.fs.copyTpl(this.templatePath('mono-docker-compose.yml.tpl'), this.destinationPath('docker-compose.yml'), {
            deployments: deployments.map((deployment, index) => {
                const serviceName = this._deploymentModuleName(deployment);
                return {
                    serviceName,
                    envPrefix: serviceName.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
                    dbPort: 5432 + index,
                    dbName: safeDatabaseName(serviceName)
                };
            })
        });
        this.fs.copy(this.templatePath('gitignore'), this.destinationPath('.gitignore'));
        this._copyMavenWrapper();
        this._writeDevSeedScript();
        this._writeAgentSkills();
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

    _writeSkeleton() {
        const appName = kebab(this.model.domain) || 'medol-application';
        const applicationClass = `${pascal(this.model.domain)}Application`;
        const runtime = this._runtimeConfig(appName);
        this.fs.copyTpl(this.templatePath('pom.xml.tpl'), this._destPath('pom.xml'), {
            rootPackage: this.model.rootPackage,
            appName,
            appPort: runtime.appPort
        });
        this.fs.copyTpl(this.templatePath('Application.kt.tpl'), this._kotlinPath('Application.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        this.fs.copyTpl(this.templatePath('README.md.tpl'), this._destPath('README.md'), {
            appName,
            domain: this.model.domain,
            rootPackage: this.model.rootPackage,
            modulePrefix: this.modulePrefix,
            appPort: runtime.appPort,
            dbPort: runtime.dbPort,
            dbName: runtime.dbName
        });
        this.fs.copyTpl(this.templatePath('ApplicationTest.kt.tpl'), this._testKotlinPath('ApplicationTest.kt'), {
            rootPackage: this.model.rootPackage,
            applicationClass
        });
        this.fs.copyTpl(this.templatePath('OpenApiConfig.kt.tpl'), this._kotlinPath('support/OpenApiConfig.kt'), {
            rootPackage: this.model.rootPackage,
            domain: this.model.domain
        });
        this.fs.copyTpl(this.templatePath('ApiExceptionHandler.kt.tpl'), this._kotlinPath('support/ApiExceptionHandler.kt'), {
            rootPackage: this.model.rootPackage
        });
        this._writeMetadataSupport();
        this.fs.copyTpl(this.templatePath('AxonEventStorageConfig.kt.tpl'), this._kotlinPath('support/AxonEventStorageConfig.kt'), {
            rootPackage: this.model.rootPackage
        });
        this.fs.copyTpl(this.templatePath('application.yml'), this._destPath('src/main/resources/application.yml'), runtime);
        this.fs.copy(this.templatePath('application-inmemory.yml'), this._destPath('src/main/resources/application-inmemory.yml'));
        this.fs.copyTpl(this.templatePath('docker-compose.yml'), this._destPath('docker-compose.yml'), runtime);
        this.fs.copy(this.templatePath('V1__baseline.sql'), this._destPath('src/main/resources/db/migration/V1__baseline.sql'));
        this.fs.copy(this.templatePath('gitignore'), this._destPath('.gitignore'));
        if (!this.modulePrefix) {
            this._copyMavenWrapper();
            this._writeDevSeedScript();
        }
        this._writeValueTypes();
        this._writeFieldOptionEnums();
        this._writeConceptStates();
        this._writeConceptCatalog();
        if (!this.modulePrefix) {
            this._writeAgentSkills();
        }
    },

    _writeMetadataSupport() {
        writeMetadataSupport(this);
    },

    _runtimeConfig(appName) {
        const index = this.currentDeployment ? this.currentDeploymentIndex : 0;
        return {
            appName,
            appPort: 8080 + index,
            dbPort: 5432 + index,
            dbName: safeDatabaseName(appName),
            composeFile: this.modulePrefix ? '../docker-compose.yml' : 'docker-compose.yml'
        };
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

    _kotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/main/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`));
    },

    _testKotlinPath(relative) {
        return this.destinationPath(this._modulePath(`src/test/kotlin/${this.model.rootPackage.split('.').join('/')}/${relative}`));
    },

    _modulePath(relative) {
        return this.modulePrefix ? `${this.modulePrefix}/${relative}` : relative;
    },

    _destPath(relative) {
        return this.destinationPath(this._modulePath(relative));
    }
};

module.exports = {applicationWriterMethods};
