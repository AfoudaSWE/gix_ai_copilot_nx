CREATE TABLE "workflow_runs" (
	"workflow_run_id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version" text NOT NULL,
	"tenant_id" text,
	"status" text NOT NULL,
	"state" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_approval" jsonb,
	"error" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_idx" ON "workflow_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status");