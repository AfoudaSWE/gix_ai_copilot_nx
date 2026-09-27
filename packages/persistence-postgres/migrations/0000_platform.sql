CREATE TABLE "audit_records" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"tenant_id" text,
	"timestamp" timestamp with time zone NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_subject" text,
	"action" text NOT NULL,
	"tool" text,
	"run_id" text,
	"tool_call_id" text,
	"decision" text NOT NULL,
	"approval" jsonb,
	"result_status" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "memory_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"provenance" text,
	"derived" boolean,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"thread_id" text,
	"project_id" text,
	"environment" text,
	"subject" text,
	"status" text NOT NULL,
	"model_provider" text,
	"model_name" text,
	"usage" jsonb,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"project_id" text,
	"environment" text,
	"subject" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"project_id" text,
	"environment" text,
	"subject" text,
	"run_id" text,
	"kind" text NOT NULL,
	"provider" text,
	"model" text,
	"agent_id" text,
	"tool" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer,
	"estimated_cost_micros" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_id_uq" ON "audit_records" USING btree ("id");--> statement-breakpoint
CREATE INDEX "audit_tenant_time_idx" ON "audit_records" USING btree ("tenant_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_tenant_actor_idx" ON "audit_records" USING btree ("tenant_id","actor_subject","timestamp");--> statement-breakpoint
CREATE INDEX "audit_tenant_action_idx" ON "audit_records" USING btree ("tenant_id","action","timestamp");--> statement-breakpoint
CREATE INDEX "audit_tenant_run_idx" ON "audit_records" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "memory_tenant_owner_idx" ON "memory_records" USING btree ("tenant_id","owner_type","owner_id","type","updated_at");--> statement-breakpoint
CREATE INDEX "memory_expires_idx" ON "memory_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_id_uq" ON "messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "messages_tenant_thread_idx" ON "messages" USING btree ("tenant_id","thread_id","seq");--> statement-breakpoint
CREATE INDEX "runs_tenant_started_idx" ON "runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_tenant_thread_idx" ON "runs" USING btree ("tenant_id","thread_id");--> statement-breakpoint
CREATE INDEX "runs_tenant_status_idx" ON "runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "threads_tenant_subject_idx" ON "threads" USING btree ("tenant_id","subject","updated_at");--> statement-breakpoint
CREATE INDEX "threads_tenant_project_idx" ON "threads" USING btree ("tenant_id","project_id","environment","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_tenant_id_uq" ON "usage_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "usage_tenant_time_idx" ON "usage_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_tenant_project_time_idx" ON "usage_events" USING btree ("tenant_id","project_id","environment","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_tenant_model_time_idx" ON "usage_events" USING btree ("tenant_id","model","occurred_at");--> statement-breakpoint
-- Hand-written (not expressible in the drizzle schema): messages belong to a thread of the
-- same tenant and are deleted with it (data-lifecycle requests).
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_fk" FOREIGN KEY ("tenant_id", "thread_id") REFERENCES "threads" ("tenant_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
-- Audit is append-only (Phase 7 design, Phase 12 Section 100). UPDATE is always rejected;
-- DELETE is rejected unless the transaction opted into the documented retention purge with
-- SET LOCAL aicopilot.audit_retention_purge = 'on'.
CREATE OR REPLACE FUNCTION aicopilot_audit_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aicopilot.audit_retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_records is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_records_immutable BEFORE UPDATE OR DELETE ON "audit_records" FOR EACH ROW EXECUTE FUNCTION aicopilot_audit_immutable();
