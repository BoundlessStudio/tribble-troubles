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

const GitCheckoutRequestSchema = z
  .object({
    repoUrl: z.string().url(),
    branch: z.string().optional(),
    targetDir: z.string().optional(),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('GitCheckoutRequest');

const GitCheckoutResultSchema = z
  .object({
    success: z.boolean(),
    repoUrl: z.string(),
    branch: z.string(),
    targetDir: z.string(),
    timestamp: z.string(),
  })
  .passthrough()
  .openapi('GitCheckoutResult');

const gitCheckoutRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/git/checkout',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: GitCheckoutRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GitCheckoutResultSchema,
        },
      },
      description: 'Clone or checkout a repository inside the sandbox',
    },
  },
});

app.openapi(gitCheckoutRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { repoUrl, branch, targetDir, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.gitCheckout(repoUrl, { branch, targetDir });
  return c.json(result);
});

export default app;
