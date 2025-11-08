import { getSandbox, SandboxOptions } from '@cloudflare/sandbox';
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

const SandboxCreationSchema = z
  .object({
    identity: z
      .string()
      .min(3)
      .openapi({
        example: 'sandbox-123',
      }),
    ttl: z
      .string()
      .optional()
      .openapi({
        description: 'Duration before the sandbox sleeps (e.g. 30s, 3m, 1h)',
        example: '5m',
      }),
  })
  .openapi('SandboxCreation');

const SandboxIdentitySchema = z
  .object({
    identity: z
      .string()
      .min(3)
      .openapi({
        example: 'sandbox-123',
      }),
  })
  .openapi('SandboxIdentity');

const createSandbox = createRoute({
  method: 'post',
  path: '/sandbox',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SandboxCreationSchema,
        },
      },
      description: 'Options to start the sandbox',
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SandboxIdentitySchema,
        },
      },
      description: 'Start the sandbox',
    },
  },
});

const destroySandbox = createRoute({
  method: 'delete',
  path: '/sandbox/{identity}',
  request: {
    params: IdentityParamsSchema,
  },
  responses: {
    204: {
      description: 'Destroy the sandbox',
    },
  },
});

app.openapi(createSandbox, async (c) => {
  const { identity, ttl } = c.req.valid('json');
  const options: SandboxOptions = {
    keepAlive: ttl === undefined,
    sleepAfter: ttl,
  };
  getSandbox(c.env.Sandbox, identity, options);
  return c.json({ identity });
});

app.openapi(destroySandbox, async (c) => {
  const { identity } = c.req.valid('param');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  await sandbox.destroy();
  return c.body(null, 204);
});

export default app;
