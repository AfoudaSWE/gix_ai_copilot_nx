-- Rollback for 0002_approvals. DESTRUCTIVE: pending approvals are lost; their runs will not resume.
DROP TABLE IF EXISTS "approvals";
