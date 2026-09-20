import { randomUUID } from 'node:crypto';
import type { KnowledgeACL } from './acl.js';
import type { DocumentMetadata } from './document.js';

/** The knowledge source types the architecture supports (Section 10). */
export type KnowledgeSourceType =
  | 'file'
  | 'text'
  | 'markdown'
  | 'pdf'
  | 'docx'
  | 'html'
  | 'web'
  | 'api'
  | 'database'
  | 'object-storage'
  | 'mcp-resource'
  | 'custom';

/** Framework-independent knowledge source contract (Section 9). Never coupled to a specific storage system. */
export interface KnowledgeSource<TConfig = unknown> {
  readonly id: string;
  readonly type: KnowledgeSourceType;
  readonly name?: string;
  readonly tenantId?: string;
  readonly acl?: KnowledgeACL;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly config: TConfig;
}

export interface KnowledgeSourceCommonInput {
  readonly id?: string;
  readonly name?: string;
  readonly tenantId?: string;
  /** Shorthand for `acl.permissions` - merged with an explicit `acl` if both are given. */
  readonly permissions?: readonly string[];
  readonly acl?: KnowledgeACL;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function resolveAcl(input: KnowledgeSourceCommonInput): KnowledgeACL | undefined {
  if (!input.permissions || input.permissions.length === 0) return input.acl;
  const merged = new Set([...(input.acl?.permissions ?? []), ...input.permissions]);
  return { ...input.acl, permissions: [...merged] };
}

function buildSource<TConfig>(
  type: KnowledgeSourceType,
  config: TConfig,
  input: KnowledgeSourceCommonInput,
): KnowledgeSource<TConfig> {
  return {
    id: input.id ?? randomUUID(),
    type,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    ...(resolveAcl(input) !== undefined ? { acl: resolveAcl(input) } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    config,
  };
}

export interface TextSourceConfig {
  readonly content: string;
}
export type TextSourceInput = KnowledgeSourceCommonInput & TextSourceConfig;
export function textSource(input: TextSourceInput): KnowledgeSource<TextSourceConfig> {
  return buildSource('text', { content: input.content }, input);
}

export type MarkdownSourceInput = KnowledgeSourceCommonInput & TextSourceConfig;
export function markdownSource(input: MarkdownSourceInput): KnowledgeSource<TextSourceConfig> {
  return buildSource('markdown', { content: input.content }, input);
}

/** Exactly one of `path`/`buffer` must be provided - validated by the corresponding loader. */
export interface BinarySourceConfig {
  readonly path?: string;
  readonly buffer?: Buffer;
}
export type PdfSourceInput = KnowledgeSourceCommonInput & BinarySourceConfig;
export function pdfSource(input: PdfSourceInput): KnowledgeSource<BinarySourceConfig> {
  return buildSource('pdf', { path: input.path, buffer: input.buffer }, input);
}

export type DocxSourceInput = KnowledgeSourceCommonInput & BinarySourceConfig;
export function docxSource(input: DocxSourceInput): KnowledgeSource<BinarySourceConfig> {
  return buildSource('docx', { path: input.path, buffer: input.buffer }, input);
}

/** Exactly one of `html`/`path` must be provided - validated by the loader. */
export interface HtmlSourceConfig {
  readonly html?: string;
  readonly path?: string;
}
export type HtmlSourceInput = KnowledgeSourceCommonInput & HtmlSourceConfig;
export function htmlSource(input: HtmlSourceInput): KnowledgeSource<HtmlSourceConfig> {
  return buildSource('html', { html: input.html, path: input.path }, input);
}

export interface WebSourceConfig {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxBytes?: number;
}
export type WebSourceInput = KnowledgeSourceCommonInput & WebSourceConfig;
export function webSource(input: WebSourceInput): KnowledgeSource<WebSourceConfig> {
  return buildSource(
    'web',
    { url: input.url, headers: input.headers, maxBytes: input.maxBytes },
    input,
  );
}

/** One document produced from a non-file source (API/database rows) - Section 21/22. */
export interface DerivedDocumentInput {
  readonly content: string;
  readonly discriminator?: string | number;
  readonly metadata?: Partial<Omit<DocumentMetadata, 'contentHash'>>;
}

/**
 * API knowledge source (Section 21) - deliberately distinct from a Phase 8 API *tool*: this
 * never executes an action, it only turns a response into documents. `request` is the caller's
 * own fetch/HTTP call (so this package never owns HTTP credentials/base-URL policy);
 * `toDocuments` maps the raw response into zero or more documents.
 */
export interface ApiSourceConfig {
  readonly request: () => Promise<unknown>;
  readonly toDocuments: (response: unknown) => readonly DerivedDocumentInput[];
}
export type ApiSourceInput = KnowledgeSourceCommonInput & ApiSourceConfig;
export function apiSource(input: ApiSourceInput): KnowledgeSource<ApiSourceConfig> {
  return buildSource('api', { request: input.request, toDocuments: input.toDocuments }, input);
}

/**
 * Database knowledge source (Section 22). `query` is a caller-supplied, already-parameterized
 * async function returning rows - this package never builds or executes SQL/query strings
 * itself, so "unrestricted natural-language-to-SQL access" is impossible by construction.
 */
export interface DatabaseSourceConfig<TRow = unknown> {
  readonly query: () => Promise<readonly TRow[]>;
  readonly toDocument: (row: TRow, index: number) => DerivedDocumentInput;
}
export type DatabaseSourceInput<TRow = unknown> = KnowledgeSourceCommonInput &
  DatabaseSourceConfig<TRow>;
export function createDatabaseKnowledgeSource<TRow = unknown>(
  input: DatabaseSourceInput<TRow>,
): KnowledgeSource<DatabaseSourceConfig<TRow>> {
  return buildSource('database', { query: input.query, toDocument: input.toDocument }, input);
}

/** Minimal object-storage boundary (Section 23) - no concrete cloud SDK dependency. */
export interface ObjectStorageObject {
  readonly key: string;
  readonly content: string;
  readonly metadata?: Partial<Omit<DocumentMetadata, 'contentHash'>>;
}
export interface ObjectStorageClient {
  list(prefix?: string): Promise<readonly string[]>;
  get(key: string): Promise<ObjectStorageObject>;
}
export interface ObjectStorageSourceConfig {
  readonly client: ObjectStorageClient;
  /** Explicit key list, or omit to list everything under `prefix` at load time. */
  readonly keys?: readonly string[];
  readonly prefix?: string;
}
export type ObjectStorageSourceInput = KnowledgeSourceCommonInput & ObjectStorageSourceConfig;
export function objectStorageSource(
  input: ObjectStorageSourceInput,
): KnowledgeSource<ObjectStorageSourceConfig> {
  return buildSource(
    'object-storage',
    { client: input.client, keys: input.keys, prefix: input.prefix },
    input,
  );
}

/** A structural subset of @gixcopilot/mcp's client/integration resource API (Section 24). */
export interface McpResourceReader {
  listResources(): Promise<readonly { readonly uri: string; readonly name: string; readonly description?: string; readonly mimeType?: string }[]>;
  readResource(
    uri: string,
  ): Promise<{ readonly uri: string; readonly mimeType?: string; readonly text?: string }>;
}
export interface McpResourceSourceConfig {
  readonly client: McpResourceReader;
  /** Explicit resource URIs, or omit to ingest every resource the server advertises. */
  readonly uris?: readonly string[];
}
export type McpResourceSourceInput = KnowledgeSourceCommonInput & McpResourceSourceConfig;
export function mcpResourceSource(
  input: McpResourceSourceInput,
): KnowledgeSource<McpResourceSourceConfig> {
  return buildSource('mcp-resource', { client: input.client, uris: input.uris }, input);
}

/** Generic local/remote file source that dispatches by extension (Section 10's 'file' type). */
export interface FileSourceConfig {
  readonly path: string;
}
export type FileSourceInput = KnowledgeSourceCommonInput & FileSourceConfig;
export function fileSource(input: FileSourceInput): KnowledgeSource<FileSourceConfig> {
  return buildSource('file', { path: input.path }, input);
}

/**
 * Escape hatch for a source type this package doesn't model - the caller supplies their own
 * `DocumentLoader` for it directly (Section 10). No default loader is registered for `custom`.
 */
export type CustomSourceInput = KnowledgeSourceCommonInput & { readonly config?: unknown };
export function customSource(input: CustomSourceInput): KnowledgeSource<unknown> {
  return buildSource('custom', input.config, input);
}
