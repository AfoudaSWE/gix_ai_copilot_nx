import { generateOpenAPITools } from './tool-generator.js';
import type { GenerateOpenAPIToolsOptions, GenerateOpenAPIToolsResult } from './tool-generator.js';

export type InspectOpenAPIOptions = GenerateOpenAPIToolsOptions;
export type InspectOpenAPIResult = GenerateOpenAPIToolsResult;

/**
 * Previews what `registerOpenAPI` would generate - the same names, schemas, and exposure/
 * security decisions - without registering anything into a `ToolRegistry` (Section 106-107's
 * inspect-before-register separation). Lets a developer or a future Tool Studio (Section 64)
 * review a document's generated tool set before making it live.
 */
export function inspectOpenAPI(options: InspectOpenAPIOptions): Promise<InspectOpenAPIResult> {
  return generateOpenAPITools(options);
}
