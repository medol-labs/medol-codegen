CREATE TABLE medol_management_locks (capability VARCHAR(80) PRIMARY KEY);
INSERT INTO medol_management_locks(capability) VALUES ('organization'), ('configuration');
CREATE TABLE medol_management_records (
 capability VARCHAR(80) NOT NULL, id UUID NOT NULL, kind VARCHAR(80) NOT NULL,
 revision BIGINT NOT NULL, payload_json TEXT NOT NULL,
 PRIMARY KEY(capability,id)
);
CREATE INDEX medol_management_records_kind ON medol_management_records(capability,kind);
CREATE TABLE medol_management_history (
 capability VARCHAR(80) NOT NULL, id UUID NOT NULL, revision BIGINT NOT NULL,
 event_id UUID NOT NULL UNIQUE, event_kind VARCHAR(120) NOT NULL, payload_json TEXT NOT NULL,
 actor_id VARCHAR(160) NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 PRIMARY KEY(capability,id,revision)
);
CREATE TABLE medol_management_outbox (
 event_id UUID PRIMARY KEY, capability VARCHAR(80) NOT NULL, event_kind VARCHAR(120) NOT NULL,
 payload_json TEXT NOT NULL, actor_id VARCHAR(160) NOT NULL, correlation_id VARCHAR(160) NOT NULL,
 created_at TIMESTAMP WITH TIME ZONE NOT NULL, delivered BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX medol_management_outbox_pending ON medol_management_outbox(delivered,created_at,event_id);
