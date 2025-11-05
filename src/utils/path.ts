import path from "node:path";

export function resolveSandboxPath(rootPath: string, targetPath: string): string {
  if (!targetPath) {
    throw new Error("Path is required");
  }

  const sanitized = targetPath.replace(/\\/g, "/");
  const trimmed = sanitized.replace(/^\/+/, "");
  const resolved = path.resolve(rootPath, trimmed);
  const relative = path.relative(rootPath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes sandbox root");
  }

  return resolved;
}

export function relativeSandboxPath(rootPath: string, absolutePath: string): string {
  const relative = path.relative(rootPath, absolutePath) || ".";
  return relative.split(path.sep).join("/");
}
