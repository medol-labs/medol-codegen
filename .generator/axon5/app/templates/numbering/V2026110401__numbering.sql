CREATE TABLE IF NOT EXISTS medol_numbering_rule (
 id UUID PRIMARY KEY, rule_code VARCHAR(100) NOT NULL UNIQUE, rule_version BIGINT NOT NULL,
 status VARCHAR(255) NOT NULL, ever_activated BOOLEAN NOT NULL, configuration_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS medol_numbering_revision (
 id UUID PRIMARY KEY, rule_id UUID, rule_version BIGINT NOT NULL, status VARCHAR(255), configuration_json TEXT
);
CREATE TABLE IF NOT EXISTS medol_numbering_counter (id UUID PRIMARY KEY, last_value BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS medol_numbering_receipt (id UUID PRIMARY KEY, fingerprint VARCHAR(64) NOT NULL, result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS medol_numbering_code (id UUID PRIMARY KEY, number_namespace VARCHAR(100) NOT NULL, scope_key VARCHAR(120) NOT NULL, code VARCHAR(255) NOT NULL, allocation_id UUID, UNIQUE(number_namespace, scope_key, code));
CREATE TABLE IF NOT EXISTS medol_numbering_outbox (
 id UUID PRIMARY KEY, created_at TIMESTAMP WITH TIME ZONE, delivered BOOLEAN NOT NULL,
 event_kind VARCHAR(255) NOT NULL, payload_json TEXT NOT NULL, metadata_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS medol_numbering_outbox_pending ON medol_numbering_outbox(delivered, created_at);
