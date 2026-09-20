/**
 * The OpenAPI 3.1 document describing `test-api-server.ts` (Section 65). Kept as a plain
 * inline object rather than a `.yaml` file so this example has zero extra file-loading
 * surface beyond what `@gixcopilot/openapi`'s own loader/validator tests already cover -
 * `registerOpenAPI`/`inspectOpenAPI` accept a `{ kind: 'object', document }` source exactly
 * like they would a parsed YAML file.
 */
export function createOpenApiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'VAS-like Master Data API (example)', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/applications/{id}': {
        get: {
          operationId: 'getApplication',
          summary: 'Get an application by id.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
        patch: {
          operationId: 'updateApplication',
          summary: "Update an application's status.",
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] } },
                },
              },
            },
          },
        },
        delete: {
          operationId: 'deleteApplication',
          summary: 'Permanently delete an application.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/applications': {
        get: {
          operationId: 'searchApplications',
          summary: 'Search applications, optionally filtered by status.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
            },
          ],
        },
      },
      '/applications/{id}/assign': {
        post: {
          operationId: 'assignApplication',
          summary: 'Assign an application to an officer.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { officerId: { type: 'string' } },
                  required: ['officerId'],
                },
              },
            },
          },
        },
      },
    },
  };
}
