import { CloudflareSandboxClient } from "./cloudflareSandboxClient";
import {
  ExecRequest,
  ExecResult,
  FileContent,
  ListDirectoryResult,
  ReadFileOptions,
  SandboxInfo,
  SandboxMetadata,
  WriteFileOptions,
} from "./types";
import { ensureSandboxRelativePath } from "./utils/path";

export interface SandboxOptions {
  id: string;
  client: CloudflareSandboxClient;
  ttlSeconds?: number;
  metadata?: SandboxMetadata;
  info?: SandboxInfo;
}

export class Sandbox {
  public readonly id: string;
  public readonly metadata?: SandboxMetadata;
  private readonly client: CloudflareSandboxClient;
  private ttlSeconds?: number;
  private info?: SandboxInfo;

  constructor(options: SandboxOptions) {
    this.id = options.id;
    this.client = options.client;
    this.ttlSeconds = options.ttlSeconds;
    this.metadata = options.metadata;
    this.info = options.info;
  }

  private assertInfo(): SandboxInfo {
    if (!this.info) {
      throw new Error("Sandbox metadata has not been loaded yet");
    }
    return this.info;
  }

  private updateInfo(info: SandboxInfo): void {
    const previous = this.info;
    const ttl = info.ttlSeconds ?? previous?.ttlSeconds ?? this.ttlSeconds ?? null;
    this.info = {
      id: info.id ?? this.id,
      createdAt: info.createdAt ?? previous?.createdAt ?? new Date().toISOString(),
      lastUsedAt: info.lastUsedAt ?? previous?.lastUsedAt ?? info.createdAt ?? new Date().toISOString(),
      ttlSeconds: ttl,
      metadata: info.metadata ?? previous?.metadata ?? this.metadata,
      jurisdiction: info.jurisdiction ?? previous?.jurisdiction ?? null,
      keepAlive: info.keepAlive ?? previous?.keepAlive,
      status: info.status ?? previous?.status ?? null,
    };
    if (ttl != null) {
      this.ttlSeconds = ttl;
    }
  }

  private markUsed(date: Date = new Date()): void {
    const timestamp = date.toISOString();
    if (this.info) {
      this.info = { ...this.info, lastUsedAt: timestamp };
      return;
    }

    this.info = {
      id: this.id,
      createdAt: timestamp,
      lastUsedAt: timestamp,
      ttlSeconds: this.ttlSeconds ?? null,
      metadata: this.metadata,
      jurisdiction: null,
      status: null,
    };
  }

  public applyInfo(info: SandboxInfo): void {
    this.updateInfo(info);
  }

  public toInfo(): SandboxInfo {
    return this.assertInfo();
  }

  public async refresh(): Promise<SandboxInfo> {
    const info = await this.client.getSandbox(this.id);
    this.updateInfo(info);
    return info;
  }

  public async touch(): Promise<void> {
    const info = await this.client.touchSandbox(this.id);
    if (info) {
      this.updateInfo(info);
    } else {
      this.markUsed();
    }
  }

  public isExpired(referenceDate: Date = new Date()): boolean {
    const info = this.info;
    const ttlSeconds = info?.ttlSeconds ?? this.ttlSeconds;
    if (!info || ttlSeconds == null) {
      return false;
    }

    const lastUsed = new Date(info.lastUsedAt);
    const expiresAt = new Date(lastUsed.getTime() + ttlSeconds * 1000);
    return referenceDate > expiresAt;
  }

  public async exec(request: ExecRequest): Promise<ExecResult> {
    if (!request.command) {
      throw new Error("Command is required");
    }

    const { result, sandbox } = await this.client.execSandbox(this.id, request);
    if (sandbox) {
      this.updateInfo(sandbox);
    } else {
      this.markUsed();
    }
    return result;
  }

  public async writeFile(options: WriteFileOptions): Promise<FileContent> {
    if (!options.path) {
      throw new Error("Path is required");
    }

    ensureSandboxRelativePath(options.path);

    const { file, sandbox } = await this.client.writeFile(this.id, options);
    if (sandbox) {
      this.updateInfo(sandbox);
    } else {
      this.markUsed();
    }
    return file;
  }

  public async readFile(options: ReadFileOptions): Promise<FileContent> {
    if (!options.path) {
      throw new Error("Path is required");
    }

    const encoding = options.encoding ?? "utf8";
    ensureSandboxRelativePath(options.path);

    const { file, sandbox } = await this.client.readFile(this.id, options.path, encoding);
    if (sandbox) {
      this.updateInfo(sandbox);
    } else {
      this.markUsed();
    }
    return file;
  }

  public async deletePath(targetPath: string): Promise<void> {
    const info = await this.client.deletePath(this.id, targetPath);
    if (info) {
      this.updateInfo(info);
    } else {
      this.markUsed();
    }
  }

  public async ensureDirectory(targetPath: string): Promise<void> {
    const { sandbox } = await this.client.ensureDirectory(this.id, targetPath);
    if (sandbox) {
      this.updateInfo(sandbox);
    } else {
      this.markUsed();
    }
  }

  public async listDirectory(targetPath = "."): Promise<ListDirectoryResult> {
    const { directory, sandbox } = await this.client.listDirectory(this.id, targetPath);
    if (sandbox) {
      this.updateInfo(sandbox);
    } else {
      this.markUsed();
    }
    return directory;
  }

  public async dispose(): Promise<void> {
    const info = await this.client.deleteSandbox(this.id);
    this.updateInfo(info);
  }
}
