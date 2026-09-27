CREATE TABLE "environments" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"production" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"tenant_id" text NOT NULL,
	"subject" text NOT NULL,
	"role" text NOT NULL,
	"project_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_subject_pk" PRIMARY KEY("tenant_id","subject")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "resource_versions" (
	"tenant_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"stage" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_versions_tenant_id_resource_id_version_pk" PRIMARY KEY("tenant_id","resource_id","version")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"project_id" text,
	"environment" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"current_version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"key_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_tenant_id_name_pk" PRIMARY KEY("tenant_id","name")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_name_uq" ON "environments" USING btree ("tenant_id","project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_tenant_slug_uq" ON "projects" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "resources_tenant_kind_idx" ON "resources" USING btree ("tenant_id","kind");--> statement-breakpoint
-- Hand-written: one resource per (tenant, kind, name, project, environment), treating a
-- missing project/environment as a value (tenant-wide resources are unique too).
CREATE UNIQUE INDEX "resources_identity_uq" ON "resources" ("tenant_id", "kind", "name", COALESCE("project_id", ''), COALESCE("environment", ''));
--> statement-breakpoint
-- Versions belong to a resource of the same tenant and are immutable history.
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_resource_fk" FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "resources" ("tenant_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_fk" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects" ("tenant_id", "id") ON DELETE CASCADE;
