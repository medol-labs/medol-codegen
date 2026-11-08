ALTER TABLE medol_schedule_delivery ADD COLUMN scheduled_at TIMESTAMP WITH TIME ZONE;
UPDATE medol_schedule_delivery SET scheduled_at = (payload_json::jsonb ->> 'scheduledAt')::timestamptz;
ALTER TABLE medol_schedule_delivery ALTER COLUMN scheduled_at SET NOT NULL;
CREATE INDEX medol_schedule_delivery_time ON medol_schedule_delivery(schedule_id, scheduled_at DESC);
ALTER TABLE IF EXISTS schedule_catalog ALTER COLUMN arguments_json TYPE TEXT;
ALTER TABLE IF EXISTS schedule_catalog ADD COLUMN IF NOT EXISTS last_scheduled_at VARCHAR(255);
