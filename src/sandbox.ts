import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import {
  DirectoryEntry,
  ExecRequest,
  ExecResult,
  FileContent,
  ListDirectoryResult,
  ReadFileOptions,
  SandboxInfo,
  SandboxMetadata,
  WriteFileOptions,
} from "./types";
import { relativeSandboxPath, resolveSandboxPath } from "./utils/path";

export interface SandboxOptions {
  id: string;
  rootPath: string;
  ttlSeconds?: number;
  metadata?: SandboxMetadata;
}

export class Sandbox {
  public readonly id: string;
  public readonly rootPath: string;
  public readonly createdAt: Date;
  public readonly metadata?: SandboxMetadata;
  private lastUsedAt: Date;
  private readonly ttlSeconds?: number;

  constructor(options: SandboxOptions) {
    this.id = options.id;
    this.rootPath = options.rootPath;
    this.metadata = options.metadata;
    this.createdAt = new Date();
    this.lastUsedAt = new Date();
    this.ttlSeconds = options.ttlSeconds;
  }

  public toInfo(): SandboxInfo {
    return {
      id: this.id,
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: this.lastUsedAt.toISOString(),
      rootPath: this.rootPath,
      ttlSeconds: this.ttlSeconds ?? null,
      metadata: this.metadata,
    };
  }

  public touch(): void {
    this.lastUsedAt = new Date();
  }

  public isExpired(referenceDate: Date = new Date()): boolean {
    if (this.ttlSeconds == null) {
      return false;
    }

    const expiresAt = new Date(this.lastUsedAt.getTime() + this.ttlSeconds * 1000);
    return referenceDate > expiresAt;
  }

  public async exec(request: ExecRequest): Promise<ExecResult> {
    if (!request.command) {
      throw new Error("Command is required");
    }

    const args = request.args ?? [];
    const startedAt = new Date();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const child = spawn(request.command, args, {
      cwd: this.rootPath,
      env: { ...process.env, ...request.env },
      stdio: "pipe",
      shell: request.useShell ?? false,
    });

    if (request.stdin) {
      child.stdin?.write(request.stdin);
    }
    child.stdin?.end();

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timeoutMs = request.timeoutMs ?? 30_000;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const result = await new Promise<ExecResult>((resolve, reject) => {
      child.once("error", (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(error);
      });

      child.once("close", (exitCode) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        const finishedAt = new Date();
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        resolve({
          command: request.command,
          args,
          stdout,
          stderr,
          exitCode,
          success: !timedOut && exitCode === 0,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          timedOut,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        });
      });

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);
      }
    });

    this.touch();
    return result;
  }

  public async writeFile(options: WriteFileOptions): Promise<FileContent> {
    if (!options.path) {
      throw new Error("Path is required");
    }

    const encoding = options.encoding ?? "utf8";
    const absolutePath = resolveSandboxPath(this.rootPath, options.path);

    if (options.createDirectories) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    const buffer = Buffer.from(options.content, encoding === "base64" ? "base64" : "utf8");
    await fs.writeFile(absolutePath, buffer);

    this.touch();
    return this.readFile({ path: options.path, encoding });
  }

  public async readFile(options: ReadFileOptions): Promise<FileContent> {
    if (!options.path) {
      throw new Error("Path is required");
    }

    const encoding = options.encoding ?? "utf8";
    const absolutePath = resolveSandboxPath(this.rootPath, options.path);
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const buffer = await fs.readFile(absolutePath);
    const content = encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf8");

    this.touch();
    return {
      path: relativeSandboxPath(this.rootPath, absolutePath),
      encoding,
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  public async deletePath(targetPath: string): Promise<void> {
    const absolutePath = resolveSandboxPath(this.rootPath, targetPath);
    await fs.rm(absolutePath, { recursive: true, force: true });
    this.touch();
  }

  public async ensureDirectory(targetPath: string): Promise<void> {
    const absolutePath = resolveSandboxPath(this.rootPath, targetPath);
    await fs.mkdir(absolutePath, { recursive: true });
    this.touch();
  }

  public async listDirectory(targetPath = "."): Promise<ListDirectoryResult> {
    const absolutePath = resolveSandboxPath(this.rootPath, targetPath);
    const stat = await fs.stat(absolutePath);

    if (!stat.isDirectory()) {
      throw new Error("Requested path is not a directory");
    }

    const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
    const entries: DirectoryEntry[] = await Promise.all(
      dirents.map(async (dirent) => {
        const entryPath = path.join(absolutePath, dirent.name);
        const entryStat = await fs.stat(entryPath);
        const relativePath = relativeSandboxPath(this.rootPath, entryPath);

        const type = dirent.isDirectory()
          ? "directory"
          : dirent.isSymbolicLink()
          ? "symlink"
          : "file";

        const entry: DirectoryEntry = {
          name: dirent.name,
          path: relativePath,
          type,
          modifiedAt: entryStat.mtime.toISOString(),
        };

        if (entryStat.isFile()) {
          entry.size = entryStat.size;
        }

        return entry;
      })
    );

    this.touch();
    return {
      path: relativeSandboxPath(this.rootPath, absolutePath),
      entries,
    };
  }

  public async dispose(): Promise<void> {
    await fs.rm(this.rootPath, { recursive: true, force: true });
  }
}
