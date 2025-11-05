export function ensureSandboxRelativePath(targetPath: string): string {
  if (!targetPath) {
    throw new Error("Path is required");
  }

  const normalized = targetPath.replace(/\\/g, "/");
  const trimmed = normalized.replace(/^\/+/, "");
  const parts: string[] = [];

  for (const segment of trimmed.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new Error("Path escapes sandbox root");
    }
    parts.push(segment);
  }

  if (parts.length === 0) {
    return ".";
  }

  return parts.join("/");
}
