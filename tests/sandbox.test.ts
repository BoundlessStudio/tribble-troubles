import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";

import { SandboxManager } from "../src/sandboxManager";

const ACCOUNT_ID = "acct-123";
const API_TOKEN = "token-xyz";
const ORIGIN = "https://api.cloudflare.test";

function successResponse<T>(result: T) {
  return {
    success: true,
    errors: [],
    messages: [],
    result,
  };
}

function sandboxRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sandbox-1",
    created_at: "2024-01-01T00:00:00.000Z",
    last_used_at: "2024-01-01T00:00:00.000Z",
    ttl_seconds: 120,
    metadata: {},
    jurisdiction: "us-east-1",
    ...overrides,
  };
}

type TestMockPool = ReturnType<MockAgent["get"]>;

async function withMockedManager(
  fn: (manager: SandboxManager, pool: TestMockPool) => Promise<void>
): Promise<void> {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  const pool = mockAgent.get(ORIGIN);
  const previous = getGlobalDispatcher();
  setGlobalDispatcher(mockAgent);

  const manager = new SandboxManager({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    baseUrl: `${ORIGIN}/client/v4`,
  });

  try {
    await fn(manager, pool);
  } finally {
    await manager.dispose();
    setGlobalDispatcher(previous);
    await mockAgent.close();
  }
}

test("creates sandboxes and lists them", async () => {
  await withMockedManager(async (manager, pool) => {
    const record = sandboxRecord({ metadata: { project: "demo" } });

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes`,
        method: "POST",
      })
      .reply(200, successResponse(record));

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes`,
        method: "GET",
      })
      .reply(200, successResponse([record]));

    const sandbox = await manager.createSandbox({ metadata: { project: "demo" } });
    const info = sandbox.toInfo();
    assert.equal(info.metadata?.project, "demo");

    const sandboxes = await manager.listSandboxes();
    assert.equal(sandboxes.length, 1);
    assert.equal(sandboxes[0].id, record.id);
  });
});

test("performs file operations", async () => {
  await withMockedManager(async (manager, pool) => {
    const record = sandboxRecord();
    const updatedRecord = sandboxRecord({ last_used_at: "2024-01-01T00:00:10.000Z" });

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes`,
        method: "POST",
      })
      .reply(200, successResponse(record));

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes/${record.id}/files`,
        method: "PUT",
      })
      .reply(
        200,
        successResponse({
          sandbox: updatedRecord,
          file: {
            path: "src/hello.txt",
            encoding: "utf8",
            content: "Hello Sandbox",
            size: 13,
            modified_at: "2024-01-01T00:00:10.000Z",
          },
        })
      );

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes/${record.id}/files?path=src%2Fhello.txt&encoding=utf8`,
        method: "GET",
      })
      .reply(
        200,
        successResponse({
          sandbox: updatedRecord,
          file: {
            path: "src/hello.txt",
            encoding: "utf8",
            content: "Hello Sandbox",
            size: 13,
            modified_at: "2024-01-01T00:00:10.000Z",
          },
        })
      );

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes/${record.id}/directories?path=src`,
        method: "GET",
      })
      .reply(
        200,
        successResponse({
          sandbox: updatedRecord,
          directory: {
            path: "src",
            entries: [
              {
                name: "hello.txt",
                path: "src/hello.txt",
                type: "file",
                size: 13,
                modified_at: "2024-01-01T00:00:10.000Z",
              },
            ],
          },
        })
      );

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
  await withMockedManager(async (manager, pool) => {
    const record = sandboxRecord();
    const afterExec = sandboxRecord({ last_used_at: "2024-01-01T00:00:20.000Z" });

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes`,
        method: "POST",
      })
      .reply(200, successResponse(record));

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes/${record.id}/exec`,
        method: "POST",
      })
      .reply(
        200,
        successResponse({
          sandbox: afterExec,
          exec: {
            command: "node",
            args: ["-e", "console.log(4)"],
            stdout: "4\n",
            stderr: "",
            exit_code: 0,
            success: true,
            duration_ms: 12,
            timed_out: false,
            started_at: "2024-01-01T00:00:20.000Z",
            finished_at: "2024-01-01T00:00:20.012Z",
          },
        })
      );

    const sandbox = await manager.createSandbox();
    const result = await sandbox.exec({
      command: "node",
      args: ["-e", "console.log(4)"],
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "4");
    assert.equal(result.success, true);
  });
});

test("touch updates expiration tracking", async () => {
  await withMockedManager(async (manager, pool) => {
    const record = sandboxRecord({ ttl_seconds: 1 });
    const touched = sandboxRecord({ ttl_seconds: 1, last_used_at: "2024-01-01T00:00:05.000Z" });

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes`,
        method: "POST",
      })
      .reply(200, successResponse(record));

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes/${record.id}/touch`,
        method: "POST",
      })
      .reply(200, successResponse(touched));

    const sandbox = await manager.createSandbox({ ttlSeconds: 1 });
    assert.equal(sandbox.isExpired(new Date("2024-01-01T00:00:01.000Z")), false);

    await sandbox.touch();
    assert.equal(sandbox.isExpired(new Date("2024-01-01T00:00:05.500Z")), false);
  });
});

test("prunes expired sandboxes via API", async () => {
  await withMockedManager(async (manager, pool) => {
    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes/prune`,
        method: "POST",
      })
      .reply(200, successResponse({ removed: 2 }));

    const removed = await manager.pruneExpired();
    assert.equal(removed, 2);
  });
});

test("rejects paths that escape the sandbox root", async () => {
  await withMockedManager(async (manager, pool) => {
    const record = sandboxRecord();

    pool
      .intercept({
        path: `/client/v4/accounts/${ACCOUNT_ID}/workers/sandboxes`,
        method: "POST",
      })
      .reply(200, successResponse(record));

    const sandbox = await manager.createSandbox();

    await assert.rejects(
      sandbox.writeFile({ path: "../outside.txt", content: "nope" }),
      /Path escapes sandbox root/
    );
  });
});
