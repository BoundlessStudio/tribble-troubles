export type SandboxMetadata = Record<string, unknown>;

export interface SandboxInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  rootPath: string;
  ttlSeconds?: number | null;
  metadata?: SandboxMetadata;
}

export interface ExecRequest {
  command: string;
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  useShell?: boolean;
}

export interface ExecResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
  durationMs: number;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string;
}

export type FileEncoding = "utf8" | "base64";

export interface WriteFileOptions {
  path: string;
  content: string;
  encoding?: FileEncoding;
  createDirectories?: boolean;
}

export interface ReadFileOptions {
  path: string;
  encoding?: FileEncoding;
}

export interface FileContent {
  path: string;
  encoding: FileEncoding;
  content: string;
  size: number;
  modifiedAt: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  modifiedAt?: string;
}

export interface ListDirectoryResult {
  path: string;
  entries: DirectoryEntry[];
}
