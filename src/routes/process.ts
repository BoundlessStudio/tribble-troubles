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

const IdentityAndProcessParamsSchema = IdentityParamsSchema.extend({
  processId: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'processId',
        in: 'path',
      },
      example: 'process-123',
    }),
});

const ProcessSchema = z
  .object({
    id: z.string(),
    pid: z.number().optional(),
    command: z.string(),
    status: z.string(),
    startTime: z.string(),
    endTime: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough()
  .openapi('Process');

const ProcessListSchema = z.array(ProcessSchema).openapi('ProcessList');

const ProcessLogsSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    processId: z.string(),
  })
  .openapi('ProcessLogs');

const SessionIdQuerySchema = z
  .object({
    sessionId: z
      .string()
      .min(3)
      .optional()
      .openapi({
        description: 'Optional session identifier',
        example: 'session-123',
      }),
  })
  .openapi('SessionIdQuery');

const StartProcessRequestSchema = z
  .object({
    command: z.string().min(1),
    sessionId: z.string().min(3).optional(),
    options: z
      .object({
        timeout: z.number().int().positive().optional(),
        cwd: z.string().optional(),
        encoding: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        processId: z.string().optional(),
        autoCleanup: z.boolean().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .openapi('StartProcessRequest');

const KillProcessRequestSchema = z
  .object({
    signal: z.string().optional(),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('KillProcessRequest');

const SessionOnlyRequestSchema = z
  .object({
    sessionId: z.string().min(3).optional(),
  })
  .openapi('SessionOnlyRequest');

const startProcessRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/processes',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: StartProcessRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ProcessSchema,
        },
      },
      description: 'Start a background process',
    },
  },
});

const listProcessesRoute = createRoute({
  method: 'get',
  path: '/sandbox/{identity}/processes',
  request: {
    params: IdentityParamsSchema,
    query: SessionIdQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ProcessListSchema,
        },
      },
      description: 'List processes in the sandbox',
    },
  },
});

const getProcessRoute = createRoute({
  method: 'get',
  path: '/sandbox/{identity}/processes/{processId}',
  request: {
    params: IdentityAndProcessParamsSchema,
    query: SessionIdQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ProcessSchema,
        },
      },
      description: 'Get details about a specific process',
    },
    404: {
      description: 'Process not found',
    },
  },
});

const killProcessRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/processes/{processId}/kill',
  request: {
    params: IdentityAndProcessParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: KillProcessRequestSchema.optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    204: {
      description: 'Kill the specified process',
    },
  },
});

const killAllProcessesRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/processes/kill',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: SessionOnlyRequestSchema.optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              terminated: z.number(),
            })
            .openapi('KillAllProcessesResponse'),
        },
      },
      description: 'Terminate all running processes',
    },
  },
});

const cleanupProcessesRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/processes/cleanup',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: SessionOnlyRequestSchema.optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              cleaned: z.number(),
            })
            .openapi('CleanupProcessesResponse'),
        },
      },
      description: 'Cleanup completed processes',
    },
  },
});

const processLogsRoute = createRoute({
  method: 'get',
  path: '/sandbox/{identity}/processes/{processId}/logs',
  request: {
    params: IdentityAndProcessParamsSchema,
    query: SessionIdQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ProcessLogsSchema,
        },
      },
      description: 'Retrieve aggregated logs for a process',
    },
  },
});

app.openapi(startProcessRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { command, options, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const process = await executor.startProcess(command, options);
  return c.json(process);
});

app.openapi(listProcessesRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { sessionId } = c.req.valid('query');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const processes = await executor.listProcesses();
  return c.json(processes);
});

app.openapi(getProcessRoute, async (c) => {
  const { identity, processId } = c.req.valid('param');
  const { sessionId } = c.req.valid('query');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const process = await executor.getProcess(processId);
  if (!process) {
    return c.json({ error: 'Process not found' }, 404);
  }
  return c.json(process);
});

app.openapi(killProcessRoute, async (c) => {
  const { identity, processId } = c.req.valid('param');
  const body = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = body?.sessionId
    ? await sandbox.getSession(body.sessionId)
    : sandbox;
  await executor.killProcess(processId, body?.signal);
  return c.body(null, 204);
});

app.openapi(killAllProcessesRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const body = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = body?.sessionId
    ? await sandbox.getSession(body.sessionId)
    : sandbox;
  const terminated = await executor.killAllProcesses();
  return c.json({ terminated });
});

app.openapi(cleanupProcessesRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const body = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = body?.sessionId
    ? await sandbox.getSession(body.sessionId)
    : sandbox;
  const cleaned = await executor.cleanupCompletedProcesses();
  return c.json({ cleaned });
});

app.openapi(processLogsRoute, async (c) => {
  const { identity, processId } = c.req.valid('param');
  const { sessionId } = c.req.valid('query');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const logs = await executor.getProcessLogs(processId);
  return c.json(logs);
});

export default app;
