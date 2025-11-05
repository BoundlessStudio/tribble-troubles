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
  accountId: string;
  apiToken: string;
  baseUrl?: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code?: number; message: string }>;
  result: T;
}

interface CloudflareSandboxRecord {
  id: string;
  created_at: string;
  last_used_at: string;
  ttl_seconds?: number | null;
  metadata?: SandboxMetadata;
  jurisdiction?: string | null;
}

interface CloudflareExecResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exit_code: number | null;
  success: boolean;
  duration_ms: number;
  timed_out: boolean;
  started_at: string;
  finished_at: string;
}

interface CloudflareFileContent {
  path: string;
  encoding: FileEncoding;
  content: string;
  size: number;
  modified_at: string;
}

interface CloudflareDirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  modified_at?: string;
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
  return {
    id: record.id,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    ttlSeconds: record.ttl_seconds ?? null,
    metadata: record.metadata,
    jurisdiction: record.jurisdiction ?? null,
  };
}

function mapExecResult(result: CloudflareExecResult): ExecResult {
  return {
    command: result.command,
    args: result.args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exit_code,
    success: result.success,
    durationMs: result.duration_ms,
    timedOut: result.timed_out,
    startedAt: result.started_at,
    finishedAt: result.finished_at,
  };
}

function mapFileContent(content: CloudflareFileContent): FileContent {
  return {
    path: content.path,
    encoding: content.encoding,
    content: content.content,
    size: content.size,
    modifiedAt: content.modified_at,
  };
}

function mapDirectoryEntry(entry: CloudflareDirectoryEntry): DirectoryEntry {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: entry.size,
    modifiedAt: entry.modified_at,
  };
}

function mapDirectoryResult(result: CloudflareDirectoryResult): ListDirectoryResult {
  return {
    path: result.path,
    entries: result.entries.map(mapDirectoryEntry),
  };
}

export class CloudflareSandboxClient {
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(options: CloudflareSandboxClientOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.baseUrl = options.baseUrl ?? "https://api.cloudflare.com/client/v4";
  }

  private get sandboxesPath(): string {
    return `/accounts/${this.accountId}/workers/sandboxes`;
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

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Cloudflare Sandbox API request failed with status ${response.status}: ${text}`
      );
    }

    const data = (await response.json()) as CloudflareApiResponse<T>;

    if (!data.success) {
      const message = data.errors?.[0]?.message ?? "Unknown Cloudflare Sandbox API error";
      throw new Error(message);
    }

    return data.result;
  }

  public async createSandbox(options: {
    id?: string;
    metadata?: SandboxMetadata;
    ttlSeconds?: number;
  }): Promise<SandboxInfo> {
    const result = await this.request<CloudflareSandboxRecord>("POST", this.sandboxesPath, {
      id: options.id,
      metadata: options.metadata,
      ttl_seconds: options.ttlSeconds,
    });
    return mapSandbox(result);
  }

  public async getSandbox(id: string): Promise<SandboxInfo> {
    const result = await this.request<CloudflareSandboxRecord>(
      "GET",
      `${this.sandboxesPath}/${encodeURIComponent(id)}`
    );
    return mapSandbox(result);
  }

  public async listSandboxes(): Promise<SandboxInfo[]> {
    const result = await this.request<CloudflareSandboxRecord[]>("GET", this.sandboxesPath);
    return result.map(mapSandbox);
  }

  public async deleteSandbox(id: string): Promise<SandboxInfo> {
    const result = await this.request<CloudflareSandboxRecord>(
      "DELETE",
      `${this.sandboxesPath}/${encodeURIComponent(id)}`
    );
    return mapSandbox(result);
  }

  public async pruneSandboxes(): Promise<number> {
    const result = await this.request<SandboxPruneResponse>(
      "POST",
      `${this.sandboxesPath}/prune`
    );
    return result.removed;
  }

  public async touchSandbox(id: string): Promise<SandboxInfo> {
    const result = await this.request<CloudflareSandboxRecord>(
      "POST",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/touch`
    );
    return mapSandbox(result);
  }

  public async execSandbox(
    id: string,
    request: ExecRequest
  ): Promise<{ result: ExecResult; sandbox: SandboxInfo }> {
    const payload = await this.request<SandboxExecResponse>(
      "POST",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/exec`,
      {
        command: request.command,
        args: request.args,
        stdin: request.stdin,
        timeout_ms: request.timeoutMs,
        env: request.env,
        use_shell: request.useShell ?? false,
      }
    );

    return {
      result: mapExecResult(payload.exec),
      sandbox: mapSandbox(payload.sandbox),
    };
  }

  public async writeFile(
    id: string,
    options: WriteFileOptions
  ): Promise<{ file: FileContent; sandbox: SandboxInfo }> {
    const path = ensureSandboxRelativePath(options.path);
    const payload = await this.request<SandboxFileResponse>(
      "PUT",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/files`,
      {
        path,
        content: options.content,
        encoding: options.encoding ?? "utf8",
        create_directories: Boolean(options.createDirectories),
      }
    );

    return {
      file: mapFileContent(payload.file),
      sandbox: mapSandbox(payload.sandbox),
    };
  }

  public async readFile(
    id: string,
    path: string,
    encoding: FileEncoding
  ): Promise<{ file: FileContent; sandbox: SandboxInfo }> {
    const safePath = ensureSandboxRelativePath(path);
    const payload = await this.request<SandboxFileResponse>(
      "GET",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/files`,
      undefined,
      {
        path: safePath,
        encoding,
      }
    );

    return {
      file: mapFileContent(payload.file),
      sandbox: mapSandbox(payload.sandbox),
    };
  }

  public async deletePath(id: string, targetPath: string): Promise<SandboxInfo> {
    const path = ensureSandboxRelativePath(targetPath);
    const payload = await this.request<SandboxDeleteResponse>(
      "DELETE",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/files`,
      {
        path,
      }
    );
    return mapSandbox(payload.sandbox);
  }

  public async ensureDirectory(
    id: string,
    directoryPath: string
  ): Promise<{ directory: ListDirectoryResult; sandbox: SandboxInfo }> {
    const path = ensureSandboxRelativePath(directoryPath);
    const payload = await this.request<SandboxDirectoryResponse>(
      "POST",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/directories`,
      {
        path,
      }
    );

    return {
      directory: mapDirectoryResult(payload.directory),
      sandbox: mapSandbox(payload.sandbox),
    };
  }

  public async listDirectory(
    id: string,
    directoryPath: string
  ): Promise<{ directory: ListDirectoryResult; sandbox: SandboxInfo }> {
    const path = ensureSandboxRelativePath(directoryPath);
    const payload = await this.request<SandboxDirectoryResponse>(
      "GET",
      `${this.sandboxesPath}/${encodeURIComponent(id)}/directories`,
      undefined,
      { path }
    );

    return {
      directory: mapDirectoryResult(payload.directory),
      sandbox: mapSandbox(payload.sandbox),
    };
  }
}
