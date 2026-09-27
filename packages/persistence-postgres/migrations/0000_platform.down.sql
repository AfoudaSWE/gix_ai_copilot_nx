-- Rollback for 0000_platform. DESTRUCTIVE: drops every Phase 12 data-plane table and its data.
-- Only for a failed first deployment; after real data exists, restore from backup instead
-- (docs/production/DATABASE.md).
DROP TRIGGER IF EXISTS audit_records_immutable ON "audit_records";
DROP FUNCTION IF EXISTS aicopilot_audit_immutable();
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "runs";
DROP TABLE IF EXISTS "threads";
DROP TABLE IF EXISTS "memory_records";
DROP TABLE IF EXISTS "audit_records";
DROP TABLE IF EXISTS "usage_events";
DROP TABLE IF EXISTS "tenants";
