export type { KnowledgeACL } from './acl.js';
export { isUnrestrictedAcl } from './acl.js';

export type { DocumentMetadata, KnowledgeDocument, CreateKnowledgeDocumentInput } from './document.js';
export { hashContent, deriveDocumentId, createKnowledgeDocument } from './document.js';

export type {
  KnowledgeSourceType,
  KnowledgeSource,
  KnowledgeSourceCommonInput,
  TextSourceConfig,
  TextSourceInput,
  MarkdownSourceInput,
  BinarySourceConfig,
  PdfSourceInput,
  DocxSourceInput,
  HtmlSourceConfig,
  HtmlSourceInput,
  WebSourceConfig,
  WebSourceInput,
  DerivedDocumentInput,
  ApiSourceConfig,
  ApiSourceInput,
  DatabaseSourceConfig,
  DatabaseSourceInput,
  ObjectStorageObject,
  ObjectStorageClient,
  ObjectStorageSourceConfig,
  ObjectStorageSourceInput,
  McpResourceReader,
  McpResourceSourceConfig,
  McpResourceSourceInput,
  FileSourceConfig,
  FileSourceInput,
  CustomSourceInput,
} from './source.js';
export {
  textSource,
  markdownSource,
  pdfSource,
  docxSource,
  htmlSource,
  webSource,
  apiSource,
  createDatabaseKnowledgeSource,
  objectStorageSource,
  mcpResourceSource,
  fileSource,
  customSource,
} from './source.js';

export type { KnowledgeSourceRegistry } from './registry.js';
export { createKnowledgeSourceRegistry } from './registry.js';

export { normalizeText } from './normalize.js';

export type { DocumentLoader, LoaderContext } from './loader.js';
export { throwIfAborted } from './loader.js';

export { textLoader } from './loaders/text.js';
export { markdownLoader, extractMarkdownTitle } from './loaders/markdown.js';
export { pdfLoader } from './loaders/pdf.js';
export { docxLoader } from './loaders/docx.js';
export { htmlLoader } from './loaders/html.js';
export { fileLoader } from './loaders/file.js';
export { webLoader } from './loaders/web.js';
export { apiLoader } from './loaders/api.js';
export { databaseLoader, createDatabaseLoader } from './loaders/database.js';
export { objectStorageLoader } from './loaders/object-storage.js';
export { mcpResourceLoader } from './loaders/mcp-resource.js';
export { extractHtmlStructure, serializeTable } from './loaders/html-structure.js';

export { assertSafeWebUrl, SsrfGuardError } from './net/ssrf-guard.js';

/**
 * Default loader lookup by KnowledgeSourceType - `custom` has no default (Section 10: the
 * caller supplies their own `DocumentLoader` for it).
 */
import type { DocumentLoader } from './loader.js';
import type { KnowledgeSourceType } from './source.js';
import { textLoader as _text } from './loaders/text.js';
import { markdownLoader as _markdown } from './loaders/markdown.js';
import { pdfLoader as _pdf } from './loaders/pdf.js';
import { docxLoader as _docx } from './loaders/docx.js';
import { htmlLoader as _html } from './loaders/html.js';
import { fileLoader as _file } from './loaders/file.js';
import { webLoader as _web } from './loaders/web.js';
import { apiLoader as _api } from './loaders/api.js';
import { databaseLoader as _database } from './loaders/database.js';
import { objectStorageLoader as _objectStorage } from './loaders/object-storage.js';
import { mcpResourceLoader as _mcpResource } from './loaders/mcp-resource.js';

export const defaultKnowledgeLoaders: Readonly<
  Partial<Record<KnowledgeSourceType, DocumentLoader<never>>>
> = {
  text: _text,
  markdown: _markdown,
  pdf: _pdf,
  docx: _docx,
  html: _html,
  file: _file,
  web: _web,
  api: _api,
  database: _database,
  'object-storage': _objectStorage,
  'mcp-resource': _mcpResource,
};
