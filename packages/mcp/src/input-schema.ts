import { jsonSchemaToZod } from '@gixcopilot/tools';
import type { JsonSchemaConversionIssue, JsonSchemaLike } from '@gixcopilot/tools';
import type { z } from 'zod';

export type McpInputSchemaResult =
  | { readonly ok: true; readonly schema: z.ZodType }
  | { readonly ok: false; readonly issues: readonly JsonSchemaConversionIssue[] };

/**
 * Converts an MCP tool's declared `inputSchema` into the SDK's canonical Zod validation
 * (Section 75) - reuses `@gixcopilot/tools`' shared `jsonSchemaToZod` rather than duplicating
 * conversion logic (Section 29's rule applies to MCP exactly as it does to OpenAPI). "Do not
 * trust MCP schemas blindly" (Section 75) is enforced the same way `@gixcopilot/openapi` does:
 * a schema shape this converter cannot represent safely is rejected with a diagnostic, and the
 * caller skips generating a tool for it, rather than registering a tool whose validation
 * silently does not match the server's real input contract.
 */
export function buildMcpInputSchema(inputSchema: JsonSchemaLike | undefined): McpInputSchemaResult {
  const result = jsonSchemaToZod(inputSchema ?? { type: 'object' });
  if (!result.ok) return { ok: false, issues: result.issues };
  return { ok: true, schema: result.schema };
}
