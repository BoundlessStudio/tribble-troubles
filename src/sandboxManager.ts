import { CloudflareSandboxClient, CloudflareSandboxClientOptions } from "./cloudflareSandboxClient";
import { Sandbox } from "./sandbox";
import { SandboxInfo, SandboxMetadata } from "./types";

export interface SandboxManagerOptions extends CloudflareSandboxClientOptions {}

export interface CreateSandboxOptions {
  id?: string;
  metadata?: SandboxMetadata;
  ttlSeconds?: number;
}

export class SandboxManager {
  private readonly client: CloudflareSandboxClient;
  private readonly sandboxes = new Map<string, Sandbox>();

  constructor(options: SandboxManagerOptions) {
    this.client = new CloudflareSandboxClient(options);
  }

  private ensureCached(info: SandboxInfo): Sandbox {
    let sandbox = this.sandboxes.get(info.id);
    if (!sandbox) {
      sandbox = new Sandbox({
        id: info.id,
        client: this.client,
        ttlSeconds: info.ttlSeconds ?? undefined,
        metadata: info.metadata,
        info,
      });
      this.sandboxes.set(info.id, sandbox);
    } else {
      sandbox.applyInfo(info);
    }
    return sandbox;
  }

  public async createSandbox(options: CreateSandboxOptions = {}): Promise<Sandbox> {
    const info = await this.client.createSandbox({
      id: options.id,
      metadata: options.metadata,
      ttlSeconds: options.ttlSeconds,
    });
    return this.ensureCached(info);
  }

  public getSandbox(id: string): Sandbox | undefined {
    return this.sandboxes.get(id);
  }

  public async requireSandbox(id: string): Promise<Sandbox> {
    const cached = this.getSandbox(id);
    if (cached) {
      return cached;
    }

    const info = await this.client.getSandbox(id);
    return this.ensureCached(info);
  }

  public async listSandboxes(): Promise<SandboxInfo[]> {
    const sandboxes = await this.client.listSandboxes();
    sandboxes.forEach((info) => {
      this.ensureCached(info);
    });
    return sandboxes;
  }

  public async deleteSandbox(id: string): Promise<boolean> {
    try {
      await this.client.deleteSandbox(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        return false;
      }
      throw error;
    }
    this.sandboxes.delete(id);
    return true;
  }

  public async pruneExpired(): Promise<number> {
    return this.client.pruneSandboxes();
  }

  public async dispose(): Promise<void> {
    this.sandboxes.clear();
  }
}
