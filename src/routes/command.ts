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

const ExecRequestSchema = z
  .object({
    command: z.string().min(1),
    sessionId: z
      .string()
      .min(3)
      .optional()
      .openapi({
        description: 'Optional session identifier to run the command within',
        example: 'session-123',
      }),
    options: z
      .object({
        timeout: z.number().int().positive().optional(),
        cwd: z.string().optional(),
        encoding: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .openapi('ExecRequest');

const ExecResponseSchema = z
  .object({
    success: z.boolean(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    command: z.string(),
    duration: z.number(),
    timestamp: z.string(),
    sessionId: z.string().optional(),
  })
  .passthrough()
  .openapi('ExecResponse');

const execCommand = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/commands/exec',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: ExecRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ExecResponseSchema,
        },
      },
      description: 'Execute a command inside the sandbox',
    },
  },
});

app.openapi(execCommand, async (c) => {
  const { identity } = c.req.valid('param');
  const { command, options, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.exec(command, options);
  return c.json(result);
});

export default app;
