INSERT INTO medol_management_locks(capability) VALUES ('reporting') ON CONFLICT DO NOTHING;
CREATE TABLE medol_report_executions (
 id UUID PRIMARY KEY, report_version_id UUID NOT NULL, actor_id VARCHAR(160) NOT NULL,
 parameters_json TEXT NOT NULL, definition_json TEXT NOT NULL, fingerprint VARCHAR(200) NOT NULL,
 state VARCHAR(30) NOT NULL, attempt_token UUID, lease_until TIMESTAMP WITH TIME ZONE,
 source_json TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX medol_report_pending ON medol_report_executions(state,created_at,id);
CREATE INDEX medol_report_owner ON medol_report_executions(actor_id,report_version_id,created_at,id);
