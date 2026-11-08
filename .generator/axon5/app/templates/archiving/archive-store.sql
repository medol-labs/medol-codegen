-- Apply manually to the independent PostgreSQL archive database, never the primary database.
CREATE TABLE medol_archive_documents (
 archive_id uuid PRIMARY KEY, target_key text NOT NULL, object_id text NOT NULL,
 business_version text NOT NULL, schema_version integer NOT NULL,
 payload_json text NOT NULL, sha256 text NOT NULL
);
CREATE INDEX medol_archive_documents_target ON medol_archive_documents(target_key,archive_id);
