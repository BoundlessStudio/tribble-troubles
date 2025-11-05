import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Sandbox } from "./sandbox";
import { SandboxInfo, SandboxMetadata } from "./types";

export interface SandboxManagerOptions {
  cleanupIntervalMs?: number;
}

export interface CreateSandboxOptions {
  id?: string;
  metadata?: SandboxMetadata;
  ttlSeconds?: number;
}

export class SandboxManager {
  private readonly basePath: string;
  private readonly sandboxes = new Map<string, Sandbox>();
  private readonly cleanupInterval?: NodeJS.Timeout;

  constructor(basePath: string, options: SandboxManagerOptions = {}) {
    this.basePath = path.resolve(basePath);
    fs.mkdirSync(this.basePath, { recursive: true });

    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        void this.pruneExpired();
      }, cleanupIntervalMs);
      this.cleanupInterval.unref();
    }
  }

  public getBasePath(): string {
    return this.basePath;
  }

  public async createSandbox(options: CreateSandboxOptions = {}): Promise<Sandbox> {
    const id = options.id ?? randomUUID();
    if (this.sandboxes.has(id)) {
      throw new Error(`Sandbox with id \"${id}\" already exists`);
    }

    const rootPath = path.join(this.basePath, id);
    await fsPromises.mkdir(rootPath, { recursive: true });

    const sandbox = new Sandbox({
      id,
      rootPath,
      metadata: options.metadata,
      ttlSeconds: options.ttlSeconds,
    });

    this.sandboxes.set(id, sandbox);
    return sandbox;
  }

  public getSandbox(id: string): Sandbox | undefined {
    return this.sandboxes.get(id);
  }

  public requireSandbox(id: string): Sandbox {
    const sandbox = this.getSandbox(id);
    if (!sandbox) {
      throw new Error(`Sandbox with id \"${id}\" not found`);
    }
    return sandbox;
  }

  public listSandboxes(): SandboxInfo[] {
    return Array.from(this.sandboxes.values()).map((sandbox) => sandbox.toInfo());
  }

  public async deleteSandbox(id: string): Promise<boolean> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) {
      return false;
    }

    this.sandboxes.delete(id);
    await sandbox.dispose();
    return true;
  }

  public async pruneExpired(referenceDate: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [id, sandbox] of this.sandboxes.entries()) {
      if (sandbox.isExpired(referenceDate)) {
        await this.deleteSandbox(id);
        removed += 1;
      }
    }
    return removed;
  }

  public async dispose(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const disposeOperations = Array.from(this.sandboxes.entries()).map(async ([id, sandbox]) => {
      this.sandboxes.delete(id);
      await sandbox.dispose();
    });

    await Promise.all(disposeOperations);
  }
}
