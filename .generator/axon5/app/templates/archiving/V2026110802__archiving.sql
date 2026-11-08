CREATE TABLE medol_archive_registry(target_key text NOT NULL, object_id text NOT NULL, state text NOT NULL, archive_id uuid, PRIMARY KEY(target_key,object_id));
CREATE TABLE medol_archive_jobs(id uuid PRIMARY KEY, kind text NOT NULL, args text NOT NULL, state text NOT NULL);
CREATE TABLE medol_archive_items(archive_id uuid PRIMARY KEY,batch_id uuid NOT NULL,target_key text NOT NULL,object_id text NOT NULL,frozen_json text NOT NULL,state text NOT NULL);
CREATE TABLE medol_archive_outbox(id uuid PRIMARY KEY,kind text NOT NULL,payload_json text NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,delivered boolean NOT NULL DEFAULT false);
CREATE INDEX medol_archive_items_batch ON medol_archive_items(batch_id);

CREATE TABLE medol_archive_queue(id uuid PRIMARY KEY,kind text NOT NULL,args text NOT NULL,state text NOT NULL DEFAULT 'PENDING',attempts integer NOT NULL DEFAULT 0,retry_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,error text, lease_token uuid);

CREATE INDEX medol_archive_queue_pending ON medol_archive_queue(state,retry_at);
CREATE INDEX medol_archive_outbox_pending ON medol_archive_outbox(delivered,created_at,id);
CREATE INDEX medol_archive_registry_protected ON medol_archive_registry(state,target_key);

CREATE TABLE medol_archive_bindings(target_key text PRIMARY KEY,bindings_json text NOT NULL);
