# Backups, recovery, retention and deletion

**Back up PostgreSQL**: conversations, runs, memory, audit, usage, approvals, workflow
checkpoints, knowledge chunks and embeddings, control-plane configuration and encrypted
secrets. Use managed point-in-time recovery or regular `pg_dump`/base backups plus WAL
archiving, and test restores. The SDK does not perform backups.

**Also protect**: `AICOPILOT_SECRET_KEY` and older key versions, without which stored platform
secrets cannot be decrypted. Your secret manager's backup covers it; never store it next to
the database backup. Redis needs no backup for correctness (rate windows and queued jobs are
transient). Re-enqueue maintenance and reindex jobs after a Redis loss.

**Recovery assumptions**: after a restore, run `aicopilot db status` (migrations must match
the deployed code), start API and workers, and let paused workflows resume from checkpoints.
Pending approvals keep their expiry. Knowledge can be rebuilt from sources with "Reindex" if
embeddings are lost. RPO/RTO are your database's.

**Retention** (worker `maintenance.retention`, per data class):

| Data | Setting | Default |
| --- | --- | --- |
| Conversations (threads, messages, runs) | `AICOPILOT_RETENTION_CONVERSATION_DAYS` | keep |
| Audit | `AICOPILOT_RETENTION_AUDIT_DAYS` (only path allowed by the audit trigger) | keep |
| Usage events | `AICOPILOT_RETENTION_USAGE_DAYS` | keep |
| Memory | per-type TTLs; expired records purged daily | TTL |
| Traces | in-memory recording (bounded); your OTel backend's retention | n/a |
| Knowledge | lives until the source is removed or reindexed | keep |

**Deletion**: a user's conversations (`deleteSubjectData(subject)` per tenant) and memory
(`delete({ owner })`) can be removed on request. Audit records are kept for their retention
period, so the log of what happened survives data deletion by design. Tenant offboarding:
suspend in the platform, export if required, then delete that tenant's rows, table by
`tenant_id`, in a maintenance window.
