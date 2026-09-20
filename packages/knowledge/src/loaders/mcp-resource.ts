import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeDocument } from '../document.js';
import type { KnowledgeDocument } from '../document.js';
import { throwIfAborted, type DocumentLoader, type LoaderContext } from '../loader.js';
import { normalizeText } from '../normalize.js';
import type { KnowledgeSource, McpResourceSourceConfig } from '../source.js';

/**
 * MCP resource loader (Section 24) - reuses Phase 8's MCP client/integration
 * (`listResources`/`readResource`) rather than a second MCP client. Per @gixcopilot/mcp's own
 * documented boundary, a resource's content is untrusted data, exactly like a tool result -
 * nothing here elevates it to a trusted instruction. Text resources only: binary/blob MCP
 * resources are not supported this phase, matching @gixcopilot/mcp's own current limitation.
 */
export const mcpResourceLoader: DocumentLoader<McpResourceSourceConfig> = {
  async *load(
    source: KnowledgeSource<McpResourceSourceConfig>,
    context?: LoaderContext,
  ): AsyncIterable<KnowledgeDocument> {
    throwIfAborted(context?.signal);
    const { client } = source.config;
    let uris = source.config.uris;
    if (!uris) {
      try {
        const resources = await client.listResources();
        uris = resources.map((resource) => resource.uri);
      } catch (error) {
        throw CopilotError.sourceLoadFailed(`Failed to list MCP resources: ${String(error)}`, {
          sourceId: source.id,
        });
      }
    }

    for (const uri of uris) {
      throwIfAborted(context?.signal);
      let resourceContent;
      try {
        resourceContent = await client.readResource(uri);
      } catch (error) {
        throw CopilotError.sourceLoadFailed(`Failed to read MCP resource "${uri}": ${String(error)}`, {
          sourceId: source.id,
          uri,
        });
      }
      if (resourceContent.text === undefined) {
        continue; // binary resource content is not supported this phase
      }
      const content = normalizeText(resourceContent.text);
      if (content.length === 0) continue;
      yield createKnowledgeDocument({
        sourceId: source.id,
        discriminator: uri,
        content,
        metadata: {
          uri,
          mimeType: resourceContent.mimeType,
          tenantId: source.tenantId,
          acl: source.acl,
        },
      });
    }
  },
};
