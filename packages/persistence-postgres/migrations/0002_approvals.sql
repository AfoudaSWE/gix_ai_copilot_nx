CREATE TABLE "approvals" (
	"approval_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"run_id" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"request" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approvals_tenant_status_idx" ON "approvals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "approvals_run_idx" ON "approvals" USING btree ("run_id");