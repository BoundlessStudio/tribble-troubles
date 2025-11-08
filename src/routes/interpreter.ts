import { getSandbox, type RunCodeOptions } from '@cloudflare/sandbox';
import { createRoute, z } from '@hono/zod-openapi';
import { createApp } from '../app';
import type { Env } from '../types';

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

const IdentityAndContextParamsSchema = IdentityParamsSchema.extend({
  contextId: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'contextId',
        in: 'path',
      },
      example: 'ctx-123',
    }),
});

const SessionIdQuerySchema = z
  .object({
    sessionId: z.string().min(3).optional(),
  })
  .openapi('InterpreterSessionQuery');

const SessionIdBodySchema = z
  .object({
    sessionId: z.string().min(3).optional(),
  })
  .openapi('InterpreterSessionBody');

const CodeContextSchema = z
  .object({
    id: z.string(),
    language: z.string(),
    cwd: z.string(),
    createdAt: z.string(),
    lastUsed: z.string(),
  })
  .passthrough()
  .openapi('CodeContext');

const CodeContextListSchema = z
  .object({
    contexts: z.array(CodeContextSchema),
  })
  .openapi('CodeContextList');

const CreateCodeContextRequestSchema = SessionIdBodySchema.extend({
  language: z.enum(['python', 'javascript', 'typescript']).optional(),
  cwd: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  timeout: z.number().int().positive().optional(),
})
  .partial()
  .openapi('CreateCodeContextRequest');

const ExecutionResultSchema = z
  .object({
    code: z.string(),
    logs: z.object({
      stdout: z.array(z.string()),
      stderr: z.array(z.string()),
    }),
    error: z
      .object({
        name: z.string(),
        message: z.string(),
        traceback: z.array(z.string()),
        lineNumber: z.number().optional(),
      })
      .optional(),
    executionCount: z.number().optional(),
    results: z
      .array(
        z
          .object({})
          .catchall(z.any())
      )
      .optional(),
  })
  .passthrough()
  .openapi('ExecutionResult');

const RunCodeRequestSchema = z
  .object({
    code: z.string().min(1),
    sessionId: z.string().min(3).optional(),
    language: z.enum(['python', 'javascript', 'typescript']).optional(),
    contextId: z.string().optional(),
    envVars: z.record(z.string(), z.string()).optional(),
    timeout: z.number().int().positive().optional(),
  })
  .openapi('RunCodeRequest');

const createContextRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/interpreter/contexts',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateCodeContextRequestSchema.optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: CodeContextSchema,
        },
      },
      description: 'Create a new code execution context',
    },
  },
});

const listContextsRoute = createRoute({
  method: 'get',
  path: '/sandbox/{identity}/interpreter/contexts',
  request: {
    params: IdentityParamsSchema,
    query: SessionIdQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: CodeContextListSchema,
        },
      },
      description: 'List code execution contexts',
    },
  },
});

const deleteContextRoute = createRoute({
  method: 'delete',
  path: '/sandbox/{identity}/interpreter/contexts/{contextId}',
  request: {
    params: IdentityAndContextParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: SessionIdBodySchema.optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    204: {
      description: 'Delete the specified code execution context',
    },
  },
});

const runCodeRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/interpreter/run',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: RunCodeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ExecutionResultSchema,
        },
      },
      description: 'Execute code using the sandbox interpreter',
    },
    404: {
      description: 'Context not found',
    },
  },
});

async function getExecutor(env: Env, identity: string, sessionId?: string) {
  const sandbox = getSandbox(env.Sandbox, identity);
  return sessionId ? await sandbox.getSession(sessionId) : sandbox;
}

app.openapi(createContextRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const body = c.req.valid('json') ?? {};
  const executor = await getExecutor(c.env, identity, body.sessionId);
  const { sessionId: _, ...options } = body;
  const context = await executor.createCodeContext(options);
  return c.json(context);
});

app.openapi(listContextsRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { sessionId } = c.req.valid('query');
  const executor = await getExecutor(c.env, identity, sessionId);
  const contexts = await executor.listCodeContexts();
  return c.json({ contexts });
});

app.openapi(deleteContextRoute, async (c) => {
  const { identity, contextId } = c.req.valid('param');
  const body = c.req.valid('json');
  const executor = await getExecutor(c.env, identity, body?.sessionId);
  await executor.deleteCodeContext(contextId);
  return c.body(null, 204);
});

app.openapi(runCodeRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { code, sessionId, language, contextId, envVars, timeout } =
    c.req.valid('json');
  const executor = await getExecutor(c.env, identity, sessionId);

  const options: RunCodeOptions = {};
  if (language) {
    options.language = language;
  }
  if (envVars) {
    options.envVars = envVars;
  }
  if (timeout) {
    options.timeout = timeout;
  }

  if (contextId) {
    const contexts = await executor.listCodeContexts();
    const context = contexts.find((ctx) => ctx.id === contextId);
    if (!context) {
      return c.json({ error: 'Context not found' }, 404);
    }
    options.context = context;
  }

  const result = await executor.runCode(code, options);
  return c.json(result);
});

export default app;
