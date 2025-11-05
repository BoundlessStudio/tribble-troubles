import http from "node:http";
import path from "node:path";

import express, { Request, Response, NextFunction } from "express";

import { SandboxManager, SandboxManagerOptions } from "./sandboxManager";
import { ExecRequest, FileEncoding } from "./types";

class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export interface SandboxServerOptions extends SandboxManagerOptions {
  basePath?: string;
}

export interface SandboxServer {
  app: express.Express;
  manager: SandboxManager;
}

export interface StartServerOptions extends SandboxServerOptions {
  port?: number;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function wrapAsync(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function parseEncoding(value: unknown, defaultValue: FileEncoding = "utf8"): FileEncoding {
  if (value == null) {
    return defaultValue;
  }

  if (value === "utf8" || value === "base64") {
    return value;
  }

  throw new HttpError(400, "encoding must be either 'utf8' or 'base64'");
}

function normalizeArgs(value: unknown): string[] | undefined {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "args must be an array of strings");
  }

  return value.map((item) => {
    if (typeof item !== "string") {
      throw new HttpError(400, "args must contain only strings");
    }
    return item;
  });
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "env must be an object");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (typeof entryValue !== "string") {
      throw new HttpError(400, "env values must be strings");
    }
    normalized[key] = entryValue;
  }
  return normalized;
}

function normalizeTtl(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }

  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl < 0) {
    throw new HttpError(400, "ttlSeconds must be a positive number");
  }

  return ttl;
}

function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

function ensureSandbox(manager: SandboxManager, id: string) {
  const sandbox = manager.getSandbox(id);
  if (!sandbox) {
    throw notFound(`Sandbox with id \"${id}\" not found`);
  }
  return sandbox;
}

export function createSandboxServer(options: SandboxServerOptions = {}): SandboxServer {
  const basePath = path.resolve(
    options.basePath ?? process.env.SANDBOX_ROOT ?? path.join(process.cwd(), "sandboxes")
  );

  const manager = new SandboxManager(basePath, {
    cleanupIntervalMs: options.cleanupIntervalMs,
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get(
    "/",
    (_req, res) => {
      res.json({
        name: "Cloudflare Sandbox API (local)",
        version: "1.0.0",
        basePath,
        endpoints: {
          listSandboxes: "GET /sandboxes",
          createSandbox: "POST /sandboxes",
          getSandbox: "GET /sandboxes/:id",
          deleteSandbox: "DELETE /sandboxes/:id",
          exec: "POST /sandboxes/:id/exec",
          readFile: "GET /sandboxes/:id/files",
          writeFile: "PUT /sandboxes/:id/files",
          deleteFile: "DELETE /sandboxes/:id/files",
          ensureDirectory: "POST /sandboxes/:id/directories",
          pruneExpired: "POST /sandboxes/prune",
        },
      });
    }
  );

  app.get(
    "/sandboxes",
    wrapAsync(async (_req, res) => {
      res.json({ sandboxes: manager.listSandboxes() });
    })
  );

  app.post(
    "/sandboxes",
    wrapAsync(async (req, res) => {
      const { id, metadata, ttlSeconds } = req.body ?? {};

      if (metadata != null && (typeof metadata !== "object" || Array.isArray(metadata))) {
        throw badRequest("metadata must be an object");
      }

      const sandbox = await manager.createSandbox({
        id: id == null ? undefined : String(id),
        metadata: metadata ?? undefined,
        ttlSeconds: normalizeTtl(ttlSeconds),
      });

      res.status(201).json({ sandbox: sandbox.toInfo() });
    })
  );

  app.get(
    "/sandboxes/:id",
    wrapAsync(async (req, res) => {
      const sandbox = ensureSandbox(manager, req.params.id);
      res.json({ sandbox: sandbox.toInfo() });
    })
  );

  app.delete(
    "/sandboxes/:id",
    wrapAsync(async (req, res) => {
      const deleted = await manager.deleteSandbox(req.params.id);
      if (!deleted) {
        throw notFound(`Sandbox with id \"${req.params.id}\" not found`);
      }
      res.status(204).send();
    })
  );

  app.post(
    "/sandboxes/:id/exec",
    wrapAsync(async (req, res) => {
      const sandbox = ensureSandbox(manager, req.params.id);
      const body = req.body ?? {};

      if (typeof body.command !== "string" || body.command.trim().length === 0) {
        throw badRequest("command must be a non-empty string");
      }

      const args = normalizeArgs(body.args) ?? [];
      const env = normalizeEnv(body.env);
      const stdin = body.stdin == null ? undefined : String(body.stdin);
      const timeoutMs = body.timeoutMs == null ? undefined : Number(body.timeoutMs);

      if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        throw badRequest("timeoutMs must be a positive number");
      }

      const request: ExecRequest = {
        command: body.command,
        args,
        env,
        stdin,
        timeoutMs,
        useShell: Boolean(body.useShell),
      };

      const result = await sandbox.exec(request);
      res.json({ result });
    })
  );

  app.put(
    "/sandboxes/:id/files",
    wrapAsync(async (req, res) => {
      const sandbox = ensureSandbox(manager, req.params.id);
      const body = req.body ?? {};

      if (typeof body.path !== "string" || body.path.trim().length === 0) {
        throw badRequest("path must be a non-empty string");
      }

      if (typeof body.content !== "string") {
        throw badRequest("content must be a string");
      }

      const encoding = parseEncoding(body.encoding);
      const createDirectories = Boolean(body.createDirectories);

      const file = await sandbox.writeFile({
        path: body.path,
        content: body.content,
        encoding,
        createDirectories,
      });

      res.status(201).json({ file });
    })
  );

  app.get(
    "/sandboxes/:id/files",
    wrapAsync(async (req, res) => {
      const sandbox = ensureSandbox(manager, req.params.id);
      const targetPath = typeof req.query.path === "string" ? req.query.path : ".";
      const encoding = parseEncoding(req.query.encoding);

      try {
        const file = await sandbox.readFile({ path: targetPath, encoding });
        res.json({ type: "file", file });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errno = (error as NodeJS.ErrnoException).code;

        if (message === "Requested path is not a file") {
          const directory = await sandbox.listDirectory(targetPath);
          res.json({ type: "directory", directory });
          return;
        }

        if (errno === "ENOENT") {
          throw notFound(`Path \"${targetPath}\" was not found in sandbox`);
        }

        throw error;
      }
    })
  );

  app.delete(
    "/sandboxes/:id/files",
    wrapAsync(async (req, res) => {
      const sandbox = ensureSandbox(manager, req.params.id);
      const body = req.body ?? {};

      if (typeof body.path !== "string" || body.path.trim().length === 0) {
        throw badRequest("path must be a non-empty string");
      }

      await sandbox.deletePath(body.path);
      res.status(204).send();
    })
  );

  app.post(
    "/sandboxes/:id/directories",
    wrapAsync(async (req, res) => {
      const sandbox = ensureSandbox(manager, req.params.id);
      const body = req.body ?? {};

      if (typeof body.path !== "string" || body.path.trim().length === 0) {
        throw badRequest("path must be a non-empty string");
      }

      await sandbox.ensureDirectory(body.path);
      const directory = await sandbox.listDirectory(body.path);
      res.status(201).json({ directory });
    })
  );

  app.post(
    "/sandboxes/prune",
    wrapAsync(async (_req, res) => {
      const removed = await manager.pruneExpired();
      res.json({ removed });
    })
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    const errno = (err as NodeJS.ErrnoException).code;
    if (errno === "ENOENT") {
      res.status(404).json({ error: (err as Error).message });
      return;
    }

    if (err instanceof Error) {
      const { message } = err;
      if (
        message === "Requested path is not a directory" ||
        message === "Requested path is not a file" ||
        message === "Path escapes sandbox root" ||
        message === "Path is required"
      ) {
        res.status(400).json({ error: message });
        return;
      }
    }

    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return { app, manager };
}

export async function startSandboxServer(options: StartServerOptions = {}) {
  const { app, manager } = createSandboxServer(options);
  const port = options.port ?? Number(process.env.PORT ?? 8787);

  const server = app.listen(port);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  return { port, manager, app, server };
}
