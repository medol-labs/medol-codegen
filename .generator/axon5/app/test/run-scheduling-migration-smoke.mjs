import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const migration = name => readFileSync(new URL(`../templates/scheduling/${name}`, import.meta.url),'utf8');
const initial=migration('V2026110701__scheduling.sql');
const upgrade=migration('V2026110801__schedule_delivery_time.sql');
const sql=`
CREATE SCHEMA fresh;
SET search_path TO fresh;
${initial}
${upgrade}
CREATE SCHEMA upgraded;
SET search_path TO upgraded;
${initial}
CREATE TABLE schedule_catalog (arguments_json VARCHAR(255));
INSERT INTO medol_schedule_delivery(id,schedule_id,payload_json,delivery_state,attempts,retry_at)
 VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
 '{"scheduledAt":"2026-11-07T10:00:30Z"}','Dispatched',0,'1970-01-01T00:00:00Z');
${upgrade}
INSERT INTO schedule_catalog(arguments_json) VALUES (repeat('x',2048));
DO $$ BEGIN
 IF (SELECT scheduled_at FROM medol_schedule_delivery LIMIT 1) <> '2026-11-07T10:00:30Z'::timestamptz THEN
  RAISE EXCEPTION 'Existing occurrence timestamp was not preserved';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='upgraded' AND table_name='medol_schedule_delivery' AND column_name='scheduled_at' AND is_nullable='NO') THEN
  RAISE EXCEPTION 'Timestamp must be required';
 END IF;
END $$;
`;
execFileSync('docker',['run','--rm','--network','none','-i','--tmpfs','/var/lib/postgresql/data',
 '-e','POSTGRES_HOST_AUTH_METHOD=trust',process.env.SCHEDULING_TEST_POSTGRES_IMAGE ?? 'postgres:16',
 'bash','-ceu',`docker-entrypoint.sh postgres >/tmp/postgres.log 2>&1 & database_pid=$!
trap 'kill "$database_pid" 2>/dev/null || true; wait "$database_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
 if pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.2
done
psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1`],{input:sql,stdio:['pipe','inherit','inherit'],timeout:60000});
console.log('Scheduling migrations: fresh schema and existing data upgrade passed.');
