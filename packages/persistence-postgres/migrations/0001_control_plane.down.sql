-- Rollback for 0001_control_plane. DESTRUCTIVE: drops control-plane configuration and the
-- encrypted secrets. Restore from backup after real use.
DROP TABLE IF EXISTS "resource_versions";
DROP TABLE IF EXISTS "resources";
DROP TABLE IF EXISTS "environments";
DROP TABLE IF EXISTS "projects";
DROP TABLE IF EXISTS "memberships";
DROP TABLE IF EXISTS "secrets";
