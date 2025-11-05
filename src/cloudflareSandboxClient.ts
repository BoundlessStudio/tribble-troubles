import { Buffer } from "node:buffer";

import { fetch } from "undici";

import {
  DirectoryEntry,
  ExecRequest,
  ExecResult,
  FileContent,
  FileEncoding,
  ListDirectoryResult,
  SandboxInfo,
  SandboxMetadata,
  WriteFileOptions,
} from "./types";
import { ensureSandboxRelativePath } from "./utils/path";

export interface CloudflareSandboxClientOptions {
  accountId?: string;
  apiToken: string;
  baseUrl?: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code?: number; message: string }>;
  result: T;
}

function isCloudflareEnvelope(value: unknown): value is CloudflareApiResponse<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    "result" in value
  );
}

function firstErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (isCloudflareEnvelope(value)) {
    const errors = value.errors ?? [];
    if (errors.length > 0) {
      return errors[0]?.message;
    }
  }

  if ("error" in value && typeof (value as { error?: unknown }).error === "string") {
    return (value as { error: string }).error;
  }

  if ("message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }

  return undefined;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function unwrapSandbox(value: unknown): CloudflareSandboxRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if ("sandbox" in value) {
    const sandbox = (value as { sandbox?: unknown }).sandbox;
    if (sandbox && typeof sandbox === "object") {
      return sandbox as CloudflareSandboxRecord;
    }
  }

  if ("id" in value) {
    return value as CloudflareSandboxRecord;
  }

  return undefined;
}

function unwrapFile(value: unknown): CloudflareFileContent | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if ("file" in value) {
    const file = (value as { file?: unknown }).file;
    if (file && typeof file === "object") {
      return file as CloudflareFileContent;
    }
  }

  if ("content" in value && "encoding" in value) {
    return value as CloudflareFileContent;
  }

  return undefined;
}

function unwrapDirectory(value: unknown): CloudflareDirectoryResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if ("directory" in value) {
    const directory = (value as { directory?: unknown }).directory;
    if (directory && typeof directory === "object") {
      return directory as CloudflareDirectoryResult;
    }
  }

  if ("entries" in value && "path" in value) {
    return value as CloudflareDirectoryResult;
  }

  return undefined;
}

interface CloudflareSandboxRecord {
  id: string;
  created_at?: string;
  createdAt?: string;
  last_used_at?: string;
  lastActive?: string;
  last_active?: string;
  ttl_seconds?: number | null;
  ttlSeconds?: number | null;
  metadata?: SandboxMetadata;
  jurisdiction?: string | null;
  keep_alive?: boolean;
  keepAlive?: boolean;
  status?: string | null;
}

interface CloudflareExecResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exit_code?: number | null;
  exitCode?: number | null;
  success: boolean;
  duration_ms?: number;
  durationMs?: number;
  timed_out?: boolean;
  timedOut?: boolean;
  started_at?: string;
  startedAt?: string;
  finished_at?: string;
  finishedAt?: string;
}

interface CloudflareFileContent {
  path: string;
  encoding: FileEncoding;
  content: string;
  size: number;
  modified_at?: string;
  modifiedAt?: string;
}

interface CloudflareDirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  modified_at?: string;
  modifiedAt?: string;
}

interface CloudflareDirectoryResult {
  path: string;
  entries: CloudflareDirectoryEntry[];
}

interface SandboxExecResponse {
  sandbox: CloudflareSandboxRecord;
  exec: CloudflareExecResult;
}

interface SandboxFileResponse {
  sandbox: CloudflareSandboxRecord;
  file: CloudflareFileContent;
}

interface SandboxDirectoryResponse {
  sandbox: CloudflareSandboxRecord;
  directory: CloudflareDirectoryResult;
}

interface SandboxDeleteResponse {
  sandbox: CloudflareSandboxRecord;
}

interface SandboxPruneResponse {
  removed: number;
}

function mapSandbox(record: CloudflareSandboxRecord): SandboxInfo {
  const createdAt = record.created_at ?? record.createdAt ?? new Date().toISOString();
  const lastUsedAt =
    record.last_used_at ?? record.lastActive ?? record.last_active ?? createdAt;
  return {
    id: record.id,
    createdAt,
    lastUsedAt,
    ttlSeconds: record.ttl_seconds ?? record.ttlSeconds ?? null,
    metadata: record.metadata,
    jurisdiction: record.jurisdiction ?? null,
    keepAlive: record.keep_alive ?? record.keepAlive,
    status: record.status ?? null,
  };
}

function mapExecResult(result: CloudflareExecResult): ExecResult {
  return {
    command: result.command,
    args: result.args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exit_code ?? result.exitCode ?? null,
    success: result.success,
    durationMs: result.duration_ms ?? result.durationMs ?? 0,
    timedOut: result.timed_out ?? result.timedOut ?? false,
    startedAt: result.started_at ?? result.startedAt ?? new Date().toISOString(),
    finishedAt: result.finished_at ?? result.finishedAt ?? new Date().toISOString(),
  };
}

function mapFileContent(content: CloudflareFileContent): FileContent {
  return {
    path: content.path,
    encoding: content.encoding,
    content: content.content,
    size: content.size,
    modifiedAt: content.modified_at ?? content.modifiedAt ?? new Date().toISOString(),
  };
}

function mapDirectoryEntry(entry: CloudflareDirectoryEntry): DirectoryEntry {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: entry.size,
    modifiedAt: entry.modified_at ?? entry.modifiedAt,
  };
}

function mapDirectoryResult(result: CloudflareDirectoryResult): ListDirectoryResult {
  return {
    path: result.path,
    entries: result.entries.map(mapDirectoryEntry),
  };
}

export class CloudflareSandboxClient {
  private readonly accountId?: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(options: CloudflareSandboxClientOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    } else {
      this.baseUrl = this.accountId
        ? "https://api.cloudflare.com/client/v4"
        : "https://api.cloudflare.com/sandbox/v1";
    }
  }

  private get sandboxesPath(): string {
    if (this.accountId) {
      return `/accounts/${this.accountId}/workers/sandboxes`;
    }
    return `/sandboxes`;
  }

  private buildUrl(path: string): string {
    const trimmed = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${trimmed}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>
  ): Promise<T> {
    const url = new URL(this.buildUrl(path));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiToken}`,
      "content-type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const parsed = text.length > 0 ? safeJsonParse(text) : undefined;

    if (!response.ok) {
      const message =
        firstErrorMessage(parsed) ??
        (text.length > 0 ? text : `HTTP ${response.status} ${response.statusText}`);
      throw new Error(
        `Cloudflare Sandbox API request failed with status ${response.status}: ${message}`
      );
    }

    if (!parsed) {
      return undefined as T;
    }

    if (isCloudflareEnvelope(parsed)) {
      if (!parsed.success) {
        const message =
          parsed.errors?.[0]?.message ?? "Unknown Cloudflare Sandbox API error";
        throw new Error(message);
      }
      return parsed.result as T;
    }

    return parsed as T;
  }

  public async createSandbox(options: {
    id?: string;
    metadata?: SandboxMetadata;
    ttlSeconds?: number;
  }): Promise<SandboxInfo> {
    const payload = await this.request<unknown>("POST", this.sandboxesPath, {
      id: options.id,
      metadata: options.metadata,
      ttl_seconds: options.ttlSeconds,
    });
    const record = unwrapSandbox(payload);
    if (!record) {
      throw new Error("Cloudflare Sandbox API did not return sandbox metadata");
    }
    return mapSandbox(record);
  }

  public async getSandbox(id: string): Promise<SandboxInfo> {
    const payload = await this.request<unknown>(
      "GET",
      `${this.sandboxesPath}/${encodeURIComponent(id)}`
    );
    const record = unwrapSandbox(payload);
    if (!record) {
      throw new Error(`Sandbox ${id} not found`);
    }
    return mapSandbox(record);
  }

  public async listSandboxes(): Promise<SandboxInfo[]> {
    const result = await this.request<unknown>("GET", this.sandboxesPath);
    if (Array.isArray(result)) {
      return result.map((record) => mapSandbox(record as CloudflareSandboxRecord));
    }

    const record = unwrapSandbox(result);
    if (record) {
      return [mapSandbox(record)];
    }

    return [];
  }

  public async deleteSandbox(id: string): Promise<SandboxInfo> {
    const payload = await this.request<unknown>(
      "DELETE",
      `${this.sandboxesPath}/${encodeURIComponent(id)}`
    );
    const record = unwrapSandbox(payload);
    if (!record) {
      return {
        id,
        createdAt: new Date(0).toISOString(),
        lastUsedAt: new Date(0).toISOString(),
        ttlSeconds: null,
      };
    }
    return mapSandbox(record);
  }

  public async pruneSandboxes(): Promise<number> {
    const result = await this.request<unknown>(
      "POST",
      `${this.sandboxesPath}/prune`
    );
    if (typeof result === "number") {
      return result;
    }
    if (result && typeof result === "object" && "removed" in result) {
      const removed = (result as { removed?: unknown }).removed;
      if (typeof removed === "number") {
        return removed;
      }
    }
    return 0;
  }

  public async touchSandbox(id: string): Promise<SandboxInfo> {
    const payload = await this.request<unknown>(
      "POST",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/touch`
    );
    const record = unwrapSandbox(payload);
    if (!record) {
      return {
        id,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        ttlSeconds: null,
      };
    }
    return mapSandbox(record);
  }

  public async execSandbox(
    id: string,
    request: ExecRequest
  ): Promise<{ result: ExecResult; sandbox?: SandboxInfo }> {
    const payload = await this.request<unknown>(
      "POST",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/exec`,
      {
        command: request.command,
        args: request.args,
        stdin: request.stdin,
        timeout_ms: request.timeoutMs,
        timeout: request.timeoutMs,
        env: request.env,
        use_shell: request.useShell ?? false,
      }
    );

    let exec: CloudflareExecResult | undefined;
    if (payload && typeof payload === "object") {
      if ("exec" in payload) {
        exec = (payload as { exec?: CloudflareExecResult }).exec;
      } else if ("result" in payload) {
        const value = (payload as { result?: unknown }).result;
        if (value && typeof value === "object") {
          exec = value as CloudflareExecResult;
        }
      }
    }

    if (!exec && payload && typeof payload === "object") {
      exec = payload as CloudflareExecResult;
    }

    if (!exec) {
      throw new Error("Cloudflare Sandbox API did not return execution results");
    }

    const sandboxRecord = unwrapSandbox(payload);

    return {
      result: mapExecResult(exec),
      sandbox: sandboxRecord ? mapSandbox(sandboxRecord) : undefined,
    };
  }

  public async writeFile(
    id: string,
    options: WriteFileOptions
  ): Promise<{ file: FileContent; sandbox?: SandboxInfo }> {
    const safePath = ensureSandboxRelativePath(options.path);
    const encoding = options.encoding ?? "utf8";
    const accountScoped = Boolean(this.accountId);
    const method = accountScoped ? "PUT" : "POST";
    const endpoint = accountScoped
      ? `${this.sandboxesPath}/${encodeURIComponent(id)}/files`
      : `${this.sandboxesPath}/${encodeURIComponent(id)}/files/write-file`;
    const payload = await this.request<unknown>(method, endpoint, {
      path: safePath,
      content: options.content,
      encoding,
      create_directories: accountScoped ? Boolean(options.createDirectories) : undefined,
      recursive: accountScoped ? undefined : Boolean(options.createDirectories),
    });

    const filePayload = unwrapFile(payload);
    const file = filePayload
      ? mapFileContent(filePayload)
      : {
          path: safePath,
          encoding,
          content: options.content,
          size:
            encoding === "base64"
              ? Buffer.from(options.content, "base64").length
              : Buffer.byteLength(options.content, "utf8"),
          modifiedAt: new Date().toISOString(),
        };

    const sandboxRecord = unwrapSandbox(payload);

    return {
      file,
      sandbox: sandboxRecord ? mapSandbox(sandboxRecord) : undefined,
    };
  }

  public async readFile(
    id: string,
    path: string,
    encoding: FileEncoding
  ): Promise<{ file: FileContent; sandbox?: SandboxInfo }> {
    const safePath = ensureSandboxRelativePath(path);
    const accountScoped = Boolean(this.accountId);
    const endpoint = accountScoped
      ? `${this.sandboxesPath}/${encodeURIComponent(id)}/files`
      : `${this.sandboxesPath}/${encodeURIComponent(id)}/files/read-file`;
    const payload = await this.request<unknown>(
      "GET",
      endpoint,
      undefined,
      {
        path: safePath,
        encoding,
      }
    );

    const filePayload = unwrapFile(payload);
    if (!filePayload) {
      throw new Error("Requested path is not a file");
    }

    const sandboxRecord = unwrapSandbox(payload);

    return {
      file: mapFileContent(filePayload),
      sandbox: sandboxRecord ? mapSandbox(sandboxRecord) : undefined,
    };
  }

  public async deletePath(id: string, targetPath: string): Promise<SandboxInfo | undefined> {
    const path = ensureSandboxRelativePath(targetPath);
    const accountScoped = Boolean(this.accountId);
    const method = accountScoped ? "DELETE" : "POST";
    const endpoint = accountScoped
      ? `${this.sandboxesPath}/${encodeURIComponent(id)}/files`
      : `${this.sandboxesPath}/${encodeURIComponent(id)}/files/delete-file`;
    const payload = await this.request<unknown>(method, endpoint, {
      path,
    });
    const record = unwrapSandbox(payload);
    return record ? mapSandbox(record) : undefined;
  }

  public async ensureDirectory(
    id: string,
    directoryPath: string
  ): Promise<{ directory: ListDirectoryResult; sandbox?: SandboxInfo }> {
    const path = ensureSandboxRelativePath(directoryPath);
    const accountScoped = Boolean(this.accountId);
    const endpoint = accountScoped
      ? `${this.sandboxesPath}/${encodeURIComponent(id)}/directories`
      : `${this.sandboxesPath}/${encodeURIComponent(id)}/files/mkdir`;
    const payload = await this.request<unknown>(
      "POST",
      endpoint,
      accountScoped ? { path } : { path, recursive: false }
    );

    const directory = unwrapDirectory(payload);
    const sandboxRecord = unwrapSandbox(payload);

    return {
      directory: directory ? mapDirectoryResult(directory) : { path, entries: [] },
      sandbox: sandboxRecord ? mapSandbox(sandboxRecord) : undefined,
    };
  }

  public async listDirectory(
    id: string,
    directoryPath: string
  ): Promise<{ directory: ListDirectoryResult; sandbox?: SandboxInfo }> {
    const path = ensureSandboxRelativePath(directoryPath);
    const accountScoped = Boolean(this.accountId);
    const endpoint = accountScoped
      ? `${this.sandboxesPath}/${encodeURIComponent(id)}/directories`
      : `${this.sandboxesPath}/${encodeURIComponent(id)}/files/read-file`;
    const payload = await this.request<unknown>(
      "GET",
      endpoint,
      undefined,
      accountScoped ? { path } : { path, encoding: "utf8" }
    );

    const directory = unwrapDirectory(payload);
    if (!directory) {
      throw new Error("Requested path is not a directory");
    }

    const sandboxRecord = unwrapSandbox(payload);

    return {
      directory: mapDirectoryResult(directory),
      sandbox: sandboxRecord ? mapSandbox(sandboxRecord) : undefined,
    };
  }
}
