import { getSandbox } from '@cloudflare/sandbox';
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

const PortParamSchema = IdentityParamsSchema.extend({
  port: z.coerce
    .number()
    .int()
    .openapi({
      param: {
        name: 'port',
        in: 'path',
      },
      example: 8080,
    }),
});

const ExposePortRequestSchema = z
  .object({
    port: z.number().int().min(1),
    hostname: z.string().min(1),
    name: z.string().optional(),
  })
  .openapi('ExposePortRequest');

const ExposePortResponseSchema = z
  .object({
    url: z.string().url(),
    port: z.number(),
    name: z.string().optional(),
  })
  .openapi('ExposePortResponse');

const ExposedPortsResponseSchema = z
  .array(
    z.object({
      url: z.string().url(),
      port: z.number(),
      status: z.enum(['active', 'inactive']),
      name: z.string().optional(),
    })
  )
  .openapi('ExposedPortsResponse');

const HostnameQuerySchema = z
  .object({
    hostname: z
      .string()
      .min(1)
      .openapi({
        description: 'Hostname returned from sandbox.exposePort',
        example: 'sandbox.dev.example.com',
      }),
  })
  .openapi('HostnameQuery');

const ValidateTokenRequestSchema = z
  .object({
    token: z.string().min(1),
  })
  .openapi('ValidatePortTokenRequest');

const exposePortRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/ports/expose',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: ExposePortRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ExposePortResponseSchema,
        },
      },
      description: 'Expose a sandbox port via a preview URL',
    },
  },
});

const unexposePortRoute = createRoute({
  method: 'delete',
  path: '/sandbox/{identity}/ports/{port}',
  request: {
    params: PortParamSchema,
  },
  responses: {
    204: {
      description: 'Unexpose the specified port',
    },
  },
});

const listPortsRoute = createRoute({
  method: 'get',
  path: '/sandbox/{identity}/ports',
  request: {
    params: IdentityParamsSchema,
    query: HostnameQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ExposedPortsResponseSchema,
        },
      },
      description: 'List exposed ports for the sandbox',
    },
  },
});

const portStatusRoute = createRoute({
  method: 'get',
  path: '/sandbox/{identity}/ports/{port}/status',
  request: {
    params: PortParamSchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              exposed: z.boolean(),
            })
            .openapi('PortStatusResponse'),
        },
      },
      description: 'Check whether a port is currently exposed',
    },
  },
});

const validateTokenRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/ports/{port}/validate',
  request: {
    params: PortParamSchema,
    body: {
      content: {
        'application/json': {
          schema: ValidateTokenRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              valid: z.boolean(),
            })
            .openapi('ValidatePortTokenResponse'),
        },
      },
      description: 'Validate that a token matches an exposed port',
    },
  },
});

app.openapi(exposePortRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { port, hostname, name } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const result = await sandbox.exposePort(port, { hostname, name });
  return c.json(result);
});

app.openapi(unexposePortRoute, async (c) => {
  const { identity, port } = c.req.valid('param');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  await sandbox.unexposePort(port);
  return c.body(null, 204);
});

app.openapi(listPortsRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { hostname } = c.req.valid('query');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const ports = await sandbox.getExposedPorts(hostname);
  return c.json(ports);
});

app.openapi(portStatusRoute, async (c) => {
  const { identity, port } = c.req.valid('param');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const exposed = await sandbox.isPortExposed(port);
  return c.json({ exposed });
});

app.openapi(validateTokenRoute, async (c) => {
  const { identity, port } = c.req.valid('param');
  const { token } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const valid = await sandbox.validatePortToken(port, token);
  return c.json({ valid });
});

export default app;
