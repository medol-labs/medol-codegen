CREATE TABLE medol_document_templates (
 id UUID PRIMARY KEY, template_key VARCHAR(160) NOT NULL, version_label VARCHAR(100) NOT NULL,
 provider_key VARCHAR(160) NOT NULL, contract_version VARCHAR(100) NOT NULL, contract_json TEXT NOT NULL,
 renderer_key VARCHAR(160) NOT NULL, template_json TEXT NOT NULL, revision BIGINT NOT NULL,
 state VARCHAR(32) NOT NULL, template_hash VARCHAR(64) NOT NULL, UNIQUE(template_key,version_label)
);
CREATE TABLE medol_document_jobs (
 id UUID PRIMARY KEY, template_id UUID NOT NULL, request_hash VARCHAR(64) NOT NULL,
 object_ref TEXT NOT NULL, locale VARCHAR(80) NOT NULL, time_zone VARCHAR(100) NOT NULL, requested_by VARCHAR(160) NOT NULL,
 provider_key VARCHAR(160) NOT NULL, source_version TEXT NOT NULL,
 contract_json TEXT NOT NULL, template_json TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 template_hash VARCHAR(64) NOT NULL, snapshot_hash VARCHAR(64) NOT NULL, input_hash VARCHAR(64) NOT NULL,
 renderer_key VARCHAR(160) NOT NULL, renderer_version TEXT NOT NULL,
 revision BIGINT NOT NULL, state VARCHAR(32) NOT NULL, attempts INTEGER NOT NULL,
 lease_token UUID, retry_at TIMESTAMP WITH TIME ZONE NOT NULL,
 file_ref TEXT, file_hash VARCHAR(64), error_code VARCHAR(100), created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX medol_document_jobs_pending ON medol_document_jobs(state,retry_at);
CREATE TABLE medol_document_outbox (
 id UUID PRIMARY KEY, event_kind VARCHAR(100) NOT NULL, payload_json TEXT NOT NULL,
 actor_id VARCHAR(160) NOT NULL, correlation_id VARCHAR(160) NOT NULL,
 created_at TIMESTAMP WITH TIME ZONE NOT NULL, delivered BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX medol_document_outbox_pending ON medol_document_outbox(delivered,created_at,id);

CREATE TABLE medol_document_request_keys(id UUID PRIMARY KEY,request_hash VARCHAR(64) NOT NULL);
