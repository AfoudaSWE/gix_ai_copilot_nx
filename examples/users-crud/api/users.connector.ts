import { z } from 'zod';
import { defineHttpApi } from '@gixcopilot/connectors';
import type { HttpApi } from '@gixcopilot/connectors';

const role = z.enum(['Admin', 'Member', 'Viewer']);

/**
 * The users REST API as copilot tools (`users.list`, `users.get`, `users.create`,
 * `users.update`, `users.delete`). Each tool calls the NestJS API over HTTP, so the API's own
 * validation, 404 and duplicate-email checks apply to the copilot exactly as to the browser.
 * Every tool requires the `api.users` permission; writes and deletes need the user's
 * confirmation in the chat before they run.
 */
export function createUsersApi(baseUrl: string): HttpApi {
  return defineHttpApi({
    id: 'users',
    baseUrl,
    endpoints: {
      list: {
        method: 'get',
        path: '/api/users',
        description: 'List every user in the directory',
        input: z.object({}),
      },
      get: {
        method: 'get',
        path: '/api/users/{id}',
        description: 'Get one user by id',
        input: z.object({ id: z.string() }),
      },
      create: {
        method: 'post',
        path: '/api/users',
        description: 'Add a user. Role is Admin, Member or Viewer',
        input: z.object({ name: z.string(), email: z.string(), role }),
      },
      update: {
        method: 'patch',
        path: '/api/users/{id}',
        description: "Change a user's name, email or role; send only the fields that change",
        input: z.object({
          id: z.string(),
          name: z.string().optional(),
          email: z.string().optional(),
          role: role.optional(),
        }),
      },
      delete: {
        method: 'delete',
        path: '/api/users/{id}',
        description: 'Delete a user by id',
        input: z.object({ id: z.string() }),
        // The default policy wants a separate admin for destructive tools; this single-user
        // directory asks the requester to confirm instead, like the web form's delete button.
        approval: 'user-confirmation',
      },
    },
  });
}
