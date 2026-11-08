# Archiving

Disabled by default. Explicitly configure a separate PostgreSQL archive database and manually apply archive-store.sql there. Primary Flyway migration installs journals, registry and completion outbox. Tenant-enabled generation is unsupported. The archive URL must include positive connectTimeout and socketTimeout parameters (for example connectTimeout=5&socketTimeout=30) (PostgreSQL JDBC seconds). Primary and cold databases must be different databases; separate credentials/permissions and backups are required. The runtime never accepts table names or SQL from commands.

Register ArchiveTargetAdapter beans with unique targetKey and explicit projectionBindings (context to readModel). candidates and freeze must both enforce business retention; cutoffAt is only a candidate snapshot upper bound. freeze must lock authoritative business state, recheck eligibility/version and return a durable token plus complete versioned JSON and durable attachment references. Attachment bytes are not copied by this runtime. cleanup must match the token and delete only that frozen version. restore must reject live conflicts and be idempotent by restoreId. All mutations must join the primary Spring transaction, including rollback; remote business adapters are unsupported. Do not delete aggregate events.

The registry object lock must be acquired by ALL business writers and command gates before modifying protected objects, and its state must be checked to reject FROZEN/ARCHIVED objects; acquiring a lock alone does not authorize a write. Generated projector hooks acquire the same lock before checking and writing. This hook does not automatically guard aggregate command execution. projectionObjectId must identify every event of each declared binding, including deletes. An empty binding set explicitly declares a target without projections. Disabling archiving does not disable projection guards; removing an adapter with protected rows fails closed.

requestBatch/requestRestore enqueue durable idempotent requests. runPending processes bounded batches with five attempts and persistent failure class/retry timestamp. Failed exhausted jobs require operator diagnosis and explicit retryFailed(jobId, kind); do not change the request arguments. The five-minute lease can expire during a slow job; object locks and journals make duplicate delivery safe. Primary lock waits are bounded to five seconds. Cold writes commit separately, are read back and SHA256 checked before primary cleanup. A crash rolls back cleanup and its journal together; the next attempt verifies the existing cold copy. Completed items clear frozen_json in the primary database. Outbox completion records contain identities and state only. Publisher delivery is at least once; consumers deduplicate by event ID.

History list uses ascending UUID cursor: pass the last returned archiveId as after. Each read verifies payload plus archiveId/targetKey checksum and identity/version columns. Checksums detect accidental corruption, not malicious changes by an administrator able to rewrite both payload and checksum. Restore only accepts the registry's current active archiveId.

Executable adapter examples and fault-injection tests are in the generator's archiving runtime smoke harness. Implement adapter methods using primary JdbcTemplate and registry.lock; business-specific schemas and retention policy belong in handwritten infrastructure, not generated templates.

Minimal adapter example (handwritten; its schema and retention policy are application-owned):

```kotlin
// Table example_record(id text primary key, version bigint, closed_at timestamptz,
// payload text). This target has no event-driven projection bindings.
class ExampleAdapter(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper) : ArchiveTargetAdapter {
 override val targetKey = "example-record"
 override val projectionBindings = emptySet<Pair<String,String>>()
 private fun retentionCutoff(cutoff: Instant) = minOf(cutoff, Instant.now().minusSeconds(90L*86400))
 override fun candidates(cutoffAt: Instant, limit: Int) = jdbc.query(
  "select id from example_record where closed_at < ? order by id limit ?",
  { r, _ -> r.getString(1) }, java.sql.Timestamp.from(retentionCutoff(cutoffAt)), limit)
 override fun freeze(objectId: String, cutoffAt: Instant): FrozenArchive? {
  val row = jdbc.queryForList("select * from example_record where id=? for update", objectId).firstOrNull() ?: return null
  val closed = (row["closed_at"] as? java.sql.Timestamp)?.toInstant() ?: return null
  if (!closed.isBefore(retentionCutoff(cutoffAt))) return null
  val version = row["version"].toString()
  return FrozenArchive(version, ArchiveSnapshot(objectId, version, 1,
   mapper.createObjectNode().put("closedAt", closed.toString()).set<com.fasterxml.jackson.databind.node.ObjectNode>("value", mapper.readTree(row["payload"] as String))))
 }
 override fun cleanup(objectId: String, frozenToken: String) {
  val current=jdbc.queryForList("select version from example_record where id=? for update",objectId).firstOrNull() ?: return
  check(current["version"].toString()==frozenToken)
  check(jdbc.update("delete from example_record where id=? and version=?",objectId,frozenToken.toLong())==1)
 }
 override fun restore(restoreId: UUID, snapshot: ArchiveSnapshot) {
  require(snapshot.schemaVersion==1)
  // Runtime's restore job and this INSERT commit atomically, so repeated restoreId is skipped.
  // A conflicting existing row fails the primary-key constraint rather than overwriting it.
  jdbc.update("insert into example_record(id,version,closed_at,payload) values (?,?,?,?)",
   snapshot.objectId,snapshot.businessVersion.toLong(),
   java.sql.Timestamp.from(Instant.parse(snapshot.payload["closedAt"].asText())),
   mapper.writeValueAsString(snapshot.payload["value"]))
 }
}
```

Example command writers must take `registry.lock(targetKey,id)` in their primary transaction and reject states other than LIVE/RESTORED before writing. The sample deliberately does not invent a generic retention policy for other targets.

In-memory H2 URLs are accepted for smoke tests with a dialect-specific lock timeout. These tests do not substitute for PostgreSQL concurrency/crash validation.

Projection bindings are validated against the generated guarded projections in this deployment. Special-purpose notification summaries, synchronized copies and custom write paths need their own integration and are not automatically made archive-safe. Persisted binding declarations prevent changing a target mapping while protected objects exist. Do not remove the capability import while protected data remains; use enabled=false to pause execution while retaining guards and configured historical reads. History lists return summaries, and details verify the full snapshot. Frozen snapshots are limited to 4 MiB.

Resumed cleanup and restore revalidate persisted projection bindings before mutation. Cleanup verifies that its archive ID still owns the FROZEN registry entry. Restore commands reject non-current or already-restored archives before emitting a request; execution rechecks under lock, while completed request retries are acknowledged from the journal.
