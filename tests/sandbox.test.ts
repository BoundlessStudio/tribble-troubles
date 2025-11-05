import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { SandboxManager } from "../src/sandboxManager";

async function withManager(
  fn: (manager: SandboxManager, basePath: string) => Promise<void>
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-api-"));
  const manager = new SandboxManager(tmpDir, { cleanupIntervalMs: 0 });

  try {
    await fn(manager, tmpDir);
  } finally {
    await manager.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test("creates sandboxes and lists them", async () => {
  await withManager(async (manager, basePath) => {
    const sandbox = await manager.createSandbox({ metadata: { project: "demo" } });
    const info = sandbox.toInfo();

    assert.equal(info.metadata?.project, "demo");
    assert.equal(manager.listSandboxes().length, 1);

    const entries = await fs.readdir(basePath);
    assert(entries.includes(sandbox.id));
  });
});

test("performs file operations", async () => {
  await withManager(async (manager) => {
    const sandbox = await manager.createSandbox();

    const written = await sandbox.writeFile({
      path: "src/hello.txt",
      content: "Hello Sandbox",
      createDirectories: true,
    });

    assert.equal(written.content, "Hello Sandbox");

    const file = await sandbox.readFile({ path: "src/hello.txt" });
    assert.equal(file.content, "Hello Sandbox");

    const directory = await sandbox.listDirectory("src");
    assert.equal(directory.entries.length, 1);
    assert.equal(directory.entries[0].name, "hello.txt");
  });
});

test("executes commands inside sandbox", async () => {
  await withManager(async (manager) => {
    const sandbox = await manager.createSandbox();

    const result = await sandbox.exec({
      command: process.execPath,
      args: ["-e", "console.log(2 + 2)"],
      env: { FORCE_COLOR: "0" },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "4");
    assert.equal(result.success, true);
  });
});

test("prunes expired sandboxes", async () => {
  await withManager(async (manager) => {
    const sandbox = await manager.createSandbox({ ttlSeconds: 0.001 });
    sandbox.touch();

    await delay(20);
    const removed = await manager.pruneExpired();
    assert.equal(removed, 1);
    assert.equal(manager.listSandboxes().length, 0);
  });
});

test("rejects paths that escape the sandbox root", async () => {
  await withManager(async (manager) => {
    const sandbox = await manager.createSandbox();

    await assert.rejects(
      sandbox.writeFile({ path: "../outside.txt", content: "nope" }),
      /Path escapes sandbox root/
    );
  });
});
