CREATE TABLE IF NOT EXISTS medol_schedule_sync (
 id UUID PRIMARY KEY, plan_version BIGINT NOT NULL, snapshot_json TEXT NOT NULL,
 pending BOOLEAN NOT NULL, sync_state VARCHAR(255), registered_id UUID, registered_provider VARCHAR(255),
 attempts INTEGER NOT NULL, retry_at TIMESTAMP WITH TIME ZONE NOT NULL, error_type VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS medol_schedule_sync_pending ON medol_schedule_sync(pending,retry_at);
CREATE TABLE IF NOT EXISTS medol_schedule_delivery (
 id UUID PRIMARY KEY, schedule_id UUID NOT NULL, payload_json TEXT NOT NULL, delivery_state VARCHAR(255),
 attempts INTEGER NOT NULL, retry_at TIMESTAMP WITH TIME ZONE NOT NULL, error_type VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS medol_schedule_delivery_pending ON medol_schedule_delivery(delivery_state,retry_at);
CREATE INDEX IF NOT EXISTS medol_schedule_delivery_plan ON medol_schedule_delivery(schedule_id);
CREATE TABLE IF NOT EXISTS medol_schedule_registration (
 id UUID PRIMARY KEY, schedule_id UUID NOT NULL, provider_key VARCHAR(255) NOT NULL, cancelled BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS medol_schedule_registration_plan ON medol_schedule_registration(schedule_id,cancelled);
