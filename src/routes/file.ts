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

const WriteFileRequestSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
    encoding: z.string().optional(),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('WriteFileRequest');

const ReadFileRequestSchema = z
  .object({
    path: z.string().min(1),
    encoding: z.string().optional(),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('ReadFileRequest');

const DeleteFileRequestSchema = z
  .object({
    path: z.string().min(1),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('DeleteFileRequest');

const RenameFileRequestSchema = z
  .object({
    oldPath: z.string().min(1),
    newPath: z.string().min(1),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('RenameFileRequest');

const MoveFileRequestSchema = z
  .object({
    sourcePath: z.string().min(1),
    destinationPath: z.string().min(1),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('MoveFileRequest');

const MkdirRequestSchema = z
  .object({
    path: z.string().min(1),
    recursive: z.boolean().optional(),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('MkdirRequest');

const ListFilesRequestSchema = z
  .object({
    path: z.string().min(1),
    recursive: z.boolean().optional(),
    includeHidden: z.boolean().optional(),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('ListFilesRequest');

const FileExistsRequestSchema = z
  .object({
    path: z.string().min(1),
    sessionId: z.string().min(3).optional(),
  })
  .openapi('FileExistsRequest');

const FileOperationResultSchema = z
  .object({
    success: z.boolean(),
    path: z.string(),
    timestamp: z.string(),
  })
  .passthrough()
  .openapi('FileOperationResult');

const ReadFileResultSchema = FileOperationResultSchema.extend({
  content: z.string(),
  encoding: z.string().optional(),
  isBinary: z.boolean().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
}).openapi('ReadFileResult');

const ListFilesResultSchema = z
  .object({
    success: z.boolean(),
    path: z.string(),
    files: z
      .array(
        z
          .object({
            name: z.string(),
            absolutePath: z.string(),
            relativePath: z.string(),
            type: z.string(),
            size: z.number(),
            modifiedAt: z.string(),
            mode: z.string(),
            permissions: z
              .object({
                readable: z.boolean(),
                writable: z.boolean(),
                executable: z.boolean(),
              })
              .passthrough(),
          })
          .passthrough()
      )
      .default([]),
    count: z.number(),
    timestamp: z.string(),
  })
  .passthrough()
  .openapi('ListFilesResult');

const FileExistsResultSchema = z
  .object({
    success: z.boolean(),
    path: z.string(),
    exists: z.boolean(),
    timestamp: z.string(),
  })
  .passthrough()
  .openapi('FileExistsResult');

const writeFileRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/write',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: WriteFileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileOperationResultSchema,
        },
      },
      description: 'Write a file inside the sandbox',
    },
  },
});

const readFileRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/read',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: ReadFileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ReadFileResultSchema,
        },
      },
      description: 'Read a file from the sandbox',
    },
  },
});

const deleteFileRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/delete',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: DeleteFileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileOperationResultSchema,
        },
      },
      description: 'Delete a file from the sandbox',
    },
  },
});

const renameFileRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/rename',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: RenameFileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileOperationResultSchema,
        },
      },
      description: 'Rename a file inside the sandbox',
    },
  },
});

const moveFileRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/move',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: MoveFileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileOperationResultSchema,
        },
      },
      description: 'Move a file inside the sandbox',
    },
  },
});

const mkdirRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/mkdir',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: MkdirRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileOperationResultSchema,
        },
      },
      description: 'Create a directory inside the sandbox',
    },
  },
});

const listFilesRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/list',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: ListFilesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ListFilesResultSchema,
        },
      },
      description: 'List files within the sandbox',
    },
  },
});

const fileExistsRoute = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/files/exists',
  request: {
    params: IdentityParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: FileExistsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileExistsResultSchema,
        },
      },
      description: 'Check whether a path exists inside the sandbox',
    },
  },
});

app.openapi(writeFileRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { path, content, encoding, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.writeFile(path, content, { encoding });
  return c.json(result);
});

app.openapi(readFileRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { path, encoding, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.readFile(path, { encoding });
  return c.json(result);
});

app.openapi(deleteFileRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { path, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.deleteFile(path);
  return c.json(result);
});

app.openapi(renameFileRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { oldPath, newPath, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.renameFile(oldPath, newPath);
  return c.json(result);
});

app.openapi(moveFileRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { sourcePath, destinationPath, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.moveFile(sourcePath, destinationPath);
  return c.json(result);
});

app.openapi(mkdirRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { path, recursive, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.mkdir(path, { recursive });
  return c.json(result);
});

app.openapi(listFilesRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { path, recursive, includeHidden, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.listFiles(path, { recursive, includeHidden });
  return c.json(result);
});

app.openapi(fileExistsRoute, async (c) => {
  const { identity } = c.req.valid('param');
  const { path, sessionId } = c.req.valid('json');
  const sandbox = getSandbox(c.env.Sandbox, identity);
  const executor = sessionId ? await sandbox.getSession(sessionId) : sandbox;
  const result = await executor.exists(path);
  return c.json(result);
});

export default app;
