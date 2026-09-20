import { generateMcpTools } from './tool-generator.js';
import type { GenerateMcpToolsOptions, GenerateMcpToolsResult } from './tool-generator.js';

export type InspectMCPOptions = GenerateMcpToolsOptions;
export type InspectMCPResult = GenerateMcpToolsResult;

/**
 * Previews what `registerMCP` would generate - the same names, schemas, and exposure/security
 * decisions - without registering anything into a `ToolRegistry` (mirrors
 * `@gixcopilot/openapi`'s `inspectOpenAPI`). Connects the given client if it is not already
 * connected.
 */
export function inspectMCP(options: InspectMCPOptions): Promise<InspectMCPResult> {
  return generateMcpTools(options);
}
