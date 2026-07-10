const FIELD_OPTION_DEFINITIONS = [
    {
        fields: ['organizationType'],
        enumName: 'OrganizationType',
        values: [
            ['HOSPITAL', 'Hospital'],
            ['CLINIC', 'Clinic'],
            ['REHABILITATION_CENTER', 'Rehabilitation Center'],
            ['RESEARCH_INSTITUTE', 'Research Institute'],
            ['UNIVERSITY_MEDICAL_CENTER', 'University Medical Center'],
            ['PUBLIC_HEALTH_AGENCY', 'Public Health Agency'],
            ['LABORATORY', 'Laboratory'],
            ['HEALTH_TECH_VENDOR', 'Health Tech Vendor'],
            ['INSURANCE_PAYER', 'Insurance Payer'],
            ['OTHER', 'Other']
        ]
    },
    {
        fields: ['connectivityMode'],
        enumName: 'ConnectivityMode',
        values: [
            ['PUBLIC_ENDPOINT', 'Public Endpoint'],
            ['VPN', 'VPN'],
            ['PRIVATE_LINK', 'Private Link'],
            ['BASTION', 'Bastion'],
            ['INTRANET_RELAY', 'Intranet Relay']
        ]
    },
    {
        fields: ['infrastructureType'],
        enumName: 'InfrastructureType',
        values: [
            ['CLUSTER', 'Cluster'],
            ['SINGLE_NODE', 'Single Node'],
            ['VM', 'Virtual Machine'],
            ['BARE_METAL', 'Bare Metal']
        ]
    },
    {
        fields: ['orchestratorType'],
        enumName: 'OrchestratorType',
        values: [
            ['K3S', 'K3s'],
            ['KUBERNETES', 'Kubernetes'],
            ['DOCKER', 'Docker'],
            ['VM', 'Virtual Machine'],
            ['BARE_METAL', 'Bare Metal']
        ]
    },
    {
        fields: ['installProfile'],
        enumName: 'InstallProfile',
        values: [
            ['QUICKSTART', 'Quickstart'],
            ['STANDARD', 'Standard'],
            ['HA', 'High Availability'],
            ['GPU', 'GPU'],
            ['EDGE', 'Edge'],
            ['AIR_GAPPED', 'Air Gapped']
        ]
    },
    {
        fields: ['nodeRole'],
        enumName: 'NodeRole',
        values: [
            ['CONTROL_PLANE', 'Control Plane'],
            ['WORKER', 'Worker']
        ]
    },
    {
        fields: ['nodeType'],
        enumName: 'NodeType',
        values: [
            ['CPU', 'CPU'],
            ['GPU', 'GPU'],
            ['MIXED', 'Mixed'],
            ['EDGE', 'Edge']
        ]
    },
    {
        fields: ['connectorType'],
        enumName: 'DataConnectorType',
        values: [
            ['JDBC', 'JDBC'],
            ['POSTGRESQL', 'PostgreSQL'],
            ['MYSQL', 'MySQL'],
            ['S3', 'S3'],
            ['NFS', 'NFS'],
            ['SFTP', 'SFTP'],
            ['FILE_SYSTEM', 'File System'],
            ['FHIR', 'FHIR'],
            ['DICOM', 'DICOM'],
            ['HL7', 'HL7'],
            ['HDFS', 'HDFS'],
            ['ICEBERG', 'Iceberg'],
            ['DELTA', 'Delta'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['secretRefType', 'localSecretRefType'],
        enumName: 'SecretRefType',
        values: [
            ['KUBERNETES_SECRET', 'Kubernetes Secret'],
            ['VAULT', 'Vault'],
            ['AWS_SECRETS_MANAGER', 'AWS Secrets Manager'],
            ['AZURE_KEY_VAULT', 'Azure Key Vault'],
            ['GCP_SECRET_MANAGER', 'GCP Secret Manager'],
            ['FILE', 'File'],
            ['ENV', 'Environment']
        ]
    },
    {
        fields: ['dataFormat', 'supportedDataFormats'],
        enumName: 'DataFormat',
        values: [
            ['CSV', 'CSV'],
            ['PARQUET', 'Parquet'],
            ['JSON', 'JSON'],
            ['AVRO', 'Avro'],
            ['ORC', 'ORC'],
            ['DICOM', 'DICOM'],
            ['FHIR', 'FHIR'],
            ['HL7', 'HL7'],
            ['IMAGE_FOLDER', 'Image Folder'],
            ['SQL_TABLE', 'SQL Table']
        ]
    },
    {
        fields: ['readerPlugin'],
        enumName: 'DatasetReaderPlugin',
        values: [
            ['PANDAS', 'Pandas'],
            ['SPARK', 'Spark'],
            ['FHIR_BULK', 'FHIR Bulk'],
            ['DICOM_SERIES', 'DICOM Series'],
            ['SQL', 'SQL'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['readMode'],
        enumName: 'DatasetReadMode',
        values: [
            ['BATCH', 'Batch'],
            ['STREAMING', 'Streaming'],
            ['SNAPSHOT', 'Snapshot'],
            ['INCREMENTAL', 'Incremental']
        ]
    },
    {
        fields: ['materializationMode'],
        enumName: 'DatasetMaterializationMode',
        values: [
            ['NONE', 'None'],
            ['EPHEMERAL', 'Ephemeral'],
            ['CACHED', 'Cached'],
            ['LOCAL_COPY', 'Local Copy']
        ]
    },
    {
        fields: ['validationMode'],
        enumName: 'ValidationMode',
        values: [
            ['CONNECTIVITY', 'Connectivity'],
            ['SCHEMA_ONLY', 'Schema Only'],
            ['SAMPLE_BATCH', 'Sample Batch'],
            ['FULL_PROFILE', 'Full Profile']
        ]
    },
    {
        fields: ['profilingProfile'],
        enumName: 'DatasetProfilingProfile',
        values: [
            ['BASIC', 'Basic'],
            ['QUALITY', 'Quality'],
            ['PRIVACY', 'Privacy'],
            ['FULL', 'Full']
        ]
    },
    {
        fields: ['sourceType'],
        enumName: 'ModelSourceType',
        values: [
            ['INITIAL', 'Initial'],
            ['ROUND_AGGREGATED', 'Round Aggregated'],
            ['IMPORTED', 'Imported'],
            ['BASELINE', 'Baseline'],
            ['EVALUATION', 'Evaluation']
        ]
    },
    {
        fields: ['modelFormat', 'initialModelFormat'],
        enumName: 'ModelFormat',
        values: [
            ['ONNX', 'ONNX'],
            ['PYTORCH_STATE_DICT', 'PyTorch State Dict'],
            ['TORCHSCRIPT', 'TorchScript'],
            ['TENSORFLOW_SAVED_MODEL', 'TensorFlow SavedModel'],
            ['SKLEARN_PICKLE', 'Scikit-learn Pickle'],
            ['XGBOOST_JSON', 'XGBoost JSON'],
            ['PMML', 'PMML'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['strategyName'],
        enumName: 'TrainingStrategyName',
        values: [
            ['FED_AVG', 'FedAvg'],
            ['FED_PROX', 'FedProx'],
            ['FED_OPT', 'FedOpt'],
            ['SCAFFOLD', 'SCAFFOLD'],
            ['FED_NOVA', 'FedNova'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['aggregationAlgorithm'],
        enumName: 'AggregationAlgorithm',
        values: [
            ['FED_AVG', 'FedAvg'],
            ['WEIGHTED_AVERAGE', 'Weighted Average'],
            ['SECURE_AGGREGATION', 'Secure Aggregation'],
            ['MEDIAN', 'Median'],
            ['TRIMMED_MEAN', 'Trimmed Mean'],
            ['KRUM', 'Krum'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['optimizer'],
        enumName: 'Optimizer',
        values: [
            ['SGD', 'SGD'],
            ['ADAM', 'Adam'],
            ['ADAMW', 'AdamW'],
            ['RMSPROP', 'RMSprop'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['lossFunction'],
        enumName: 'LossFunction',
        values: [
            ['CROSS_ENTROPY', 'Cross Entropy'],
            ['BINARY_CROSS_ENTROPY', 'Binary Cross Entropy'],
            ['MSE', 'MSE'],
            ['MAE', 'MAE'],
            ['DICE', 'Dice'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['aggregationProvider'],
        enumName: 'AggregationProvider',
        values: [
            ['PLATFORM_SECURE_AGGREGATION', 'Platform Secure Aggregation'],
            ['AGENT_LOCAL', 'Agent Local'],
            ['EXTERNAL_SERVICE', 'External Service'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['shareAlgorithm'],
        enumName: 'ShareAlgorithm',
        values: [
            ['SHAMIR_SECRET_SHARING', 'Shamir Secret Sharing'],
            ['ADDITIVE_SECRET_SHARING', 'Additive Secret Sharing'],
            ['PAILLIER_MASKING', 'Paillier Masking'],
            ['CUSTOM', 'Custom']
        ]
    },
    {
        fields: ['keyAlgorithm'],
        enumName: 'KeyAlgorithm',
        values: [
            ['RSA_2048', 'RSA 2048'],
            ['RSA_4096', 'RSA 4096'],
            ['ECDSA_P256', 'ECDSA P-256'],
            ['ED25519', 'Ed25519'],
            ['AES_256_GCM', 'AES-256-GCM'],
            ['PAILLIER', 'Paillier'],
            ['X25519', 'X25519']
        ]
    },
    {
        fields: ['keyPurpose'],
        enumName: 'KeyPurpose',
        values: [
            ['NODE_IDENTITY', 'Node Identity'],
            ['TRANSPORT_TLS', 'Transport TLS'],
            ['MODEL_SIGNATURE', 'Model Signature'],
            ['SECURE_AGGREGATION', 'Secure Aggregation'],
            ['ARTIFACT_ENCRYPTION', 'Artifact Encryption']
        ]
    },
    {
        fields: ['distributionChannel'],
        enumName: 'KeyDistributionChannel',
        values: [
            ['RUNTIME_CONTROL_PLANE', 'Runtime Control Plane'],
            ['KUBERNETES_SECRET', 'Kubernetes Secret'],
            ['VAULT_SECRET', 'Vault Secret'],
            ['OUT_OF_BAND', 'Out of Band'],
            ['MANUAL', 'Manual']
        ]
    },
    {
        fields: ['attestationType'],
        enumName: 'AttestationType',
        values: [
            ['TPM', 'TPM'],
            ['TEE', 'TEE'],
            ['SGX', 'Intel SGX'],
            ['SEV_SNP', 'AMD SEV-SNP'],
            ['K8S_NODE', 'Kubernetes Node'],
            ['SOFTWARE', 'Software'],
            ['MANUAL', 'Manual']
        ]
    },
    {
        fields: ['verificationOutcome'],
        enumName: 'VerificationOutcome',
        values: [
            ['VERIFIED', 'Verified'],
            ['REJECTED', 'Rejected'],
            ['EXPIRED', 'Expired'],
            ['NEEDS_REVIEW', 'Needs Review']
        ]
    },
    {
        fields: ['severity'],
        enumName: 'AlertSeverity',
        values: [
            ['INFO', 'Info'],
            ['WARNING', 'Warning'],
            ['CRITICAL', 'Critical']
        ]
    },
    {
        fields: ['pressureType'],
        enumName: 'ResourcePressureType',
        values: [
            ['CPU', 'CPU'],
            ['GPU', 'GPU'],
            ['MEMORY', 'Memory'],
            ['DISK', 'Disk'],
            ['NETWORK', 'Network'],
            ['POD_CAPACITY', 'Pod Capacity']
        ]
    },
    {
        fields: ['telemetryRetentionPolicy'],
        enumName: 'TelemetryRetentionPolicy',
        values: [
            ['LATEST_ONLY', 'Latest Only'],
            ['SHORT_TERM', 'Short Term'],
            ['AUDIT_SAMPLED', 'Audit Sampled']
        ]
    },
    {
        fields: ['runtimeStatus'],
        enumName: 'RuntimeStatus',
        values: [
            ['STARTING', 'Starting'],
            ['RUNNING', 'Running'],
            ['SUCCEEDED', 'Succeeded'],
            ['FAILED', 'Failed'],
            ['CANCELLED', 'Cancelled']
        ]
    },
    {
        fields: ['participantStatus'],
        enumName: 'ParticipantStatus',
        values: [
            ['INVITED', 'Invited'],
            ['JOINED', 'Joined'],
            ['SUSPENDED', 'Suspended'],
            ['REMOVED', 'Removed']
        ]
    },
    {
        fields: ['readinessStatus'],
        enumName: 'ReadinessStatus',
        values: [
            ['READY', 'Ready'],
            ['DEGRADED', 'Degraded'],
            ['BLOCKED', 'Blocked'],
            ['UNKNOWN', 'Unknown']
        ]
    },
    {
        fields: ['healthStatus'],
        enumName: 'HealthStatus',
        values: [
            ['HEALTHY', 'Healthy'],
            ['OFFLINE', 'Offline'],
            ['DEGRADED', 'Degraded'],
            ['PRESSURE', 'Pressure'],
            ['UNKNOWN', 'Unknown']
        ]
    }
];

const DEFINITIONS_BY_FIELD = new Map();
FIELD_OPTION_DEFINITIONS.forEach((definition) => {
    definition.fields.forEach((field) => DEFINITIONS_BY_FIELD.set(normalizeFieldName(field), normalizeDefinition(definition)));
});

function fieldOptionsFor(field) {
    if (!field || field.valueType || !isStringLike(field)) {
        return undefined;
    }
    const definition = DEFINITIONS_BY_FIELD.get(normalizeFieldName(field.name));
    if (!definition) {
        return undefined;
    }
    return {
        ...definition,
        fieldName: field.name
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

function normalizeDefinition(definition) {
    return {
        enumName: definition.enumName,
        values: definition.values.map(([value, label]) => ({
            value,
            label,
            enumConstant: constant(value)
        }))
    };
}

function isStringLike(field) {
    const type = String(field.type ?? 'String').toLowerCase();
    return type === 'string';
}

function normalizeFieldName(value) {
    return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function constant(value) {
    return String(value ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

module.exports = {
    fieldOptionsFor,
    collectFieldOptionEnums
};
