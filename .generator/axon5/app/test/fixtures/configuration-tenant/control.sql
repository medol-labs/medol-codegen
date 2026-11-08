CREATE TABLE system_configuration_configuration_set_catalog (
 configuration_set_id UUID PRIMARY KEY, group_key VARCHAR(255), scope_type VARCHAR(255), scope_id VARCHAR(255),
 values_json TEXT, definition_version VARCHAR(255), revision BIGINT, state VARCHAR(255),
 projection_updated_at TIMESTAMP, user_id VARCHAR(255), session_id VARCHAR(255), correlation_id VARCHAR(255),
 causation_id VARCHAR(255), trace_id VARCHAR(255), tenant_id VARCHAR(255)
);
