import { getSandbox, SessionOptions } from '@cloudflare/sandbox';
import { createRoute, z } from '@hono/zod-openapi';
import { createApp } from '../app';

const app = createApp();

const IdentityParamsSchema = z.object({
  identity: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'identity',
        in: 'path',
      },
      example: 'sandbox-123',
    }),
});

const IdentityAndIdParamsSchema = z.object({
  identity: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'identity',
        in: 'path',
      },
      example: 'sandbox-123',
    }),
  id: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'id',
        in: 'path',
      },
      example: 'session-123',
    }),
});

const SessionIdSchema = z
  .object({
    id: z
      .string()
      .min(3)
      .openapi({
        example: 'session-123',
      }),
  })
  .openapi('SessionId');

const createSession = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/session',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              options: z
                .object({
                  id: z.string().optional(),
                  name: z.string().optional(),
                  env: z.record(z.string(), z.string()).optional(),
                  cwd: z.string().optional(),
                })
                .partial()
                .passthrough()
                .optional(),
            })
            .partial()
            .optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SessionIdSchema,
        },
      },
      description: 'Start a new execution session',
    },
  },
});

const deleteSession = createRoute({
  method: 'delete',
  path: '/sandbox/{identity}/session/{id}',
  request: {
    params: IdentityAndIdParamsSchema,
  },
  responses: {
    204: {
      description: 'Delete the specified session',
    },
  },
});

app.openapi(createSession, async (c) => {
  const { identity } = c.req.valid('param');
  const body = c.req.valid('json') ?? {};
  const options = (body?.options ?? {}) as SessionOptions;
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const session = await sandbox.createSession(options);
  return c.json({ id: session.id });
});

app.openapi(deleteSession, async (c) => {
  const { identity, id } = c.req.valid('param');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  await sandbox.deleteSession(id);
  return c.body(null, 204);
});

export default app;
