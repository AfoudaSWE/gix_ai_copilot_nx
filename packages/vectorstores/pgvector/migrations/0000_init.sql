-- Requires the pgvector extension. On managed Postgres this may need running once by an
-- account with sufficient privileges (some providers pre-install it or require an admin
-- console action instead) - see Phase 9 docs (Section 177) for provider-specific notes.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"chunk_id" text NOT NULL,
	"document_id" text NOT NULL,
	"source_id" text NOT NULL,
	"tenant_id" text,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"acl" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"chunk_id" text NOT NULL,
	"document_id" text NOT NULL,
	"source_id" text NOT NULL,
	"tenant_id" text,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"acl" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tenant_idx" ON "knowledge_chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_source_idx" ON "knowledge_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "memory_embeddings_tenant_idx" ON "memory_embeddings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "memory_embeddings_document_idx" ON "memory_embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "memory_embeddings_source_idx" ON "memory_embeddings" USING btree ("source_id");
--> statement-breakpoint
-- HNSW approximate-nearest-neighbor indexes for cosine similarity search (hand-written: pgvector
-- operator classes/index tuning aren't expressed through drizzle-kit's generic index builder).
-- A vector index is a performance optimization only - it does not replace the ACL filter stage
-- in @gixcopilot/rag's retriever (see the database/rag skills).
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "memory_embeddings_embedding_idx" ON "memory_embeddings" USING hnsw ("embedding" vector_cosine_ops);