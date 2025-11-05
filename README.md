# tribble-troubles

An API façade for the Cloudflare Sandbox service. The project exposes an HTTP
interface that forwards command execution, file management, and lifecycle
controls to Cloudflare's managed Sandbox endpoints so that you can build and
test integrations against the real service from your local environment.

## Features

- Provision and destroy Cloudflare sandboxes on demand using your account credentials.
- Execute commands inside each sandbox with timeouts and custom environment variables.
- Read, write, and list files while preventing path traversal attacks.
- Delegate TTL enforcement to Cloudflare and manually trigger remote pruning when needed.
- Ship with a TypeScript SDK (`Sandbox`, `SandboxManager`) for embedding the behaviour
  in other applications.

## Getting started

```bash
npm install
npm run build
npm start
```

The server listens on port `8787` by default. Set the following environment
variables (or provide the equivalent options programmatically) to authenticate
with Cloudflare:

- `CLOUDFLARE_ACCOUNT_ID` – your Cloudflare account identifier (required)
- `CLOUDFLARE_API_TOKEN` – an API token with Sandbox permissions (required)
- `CLOUDFLARE_API_BASE_URL` – optional alternative origin for the Cloudflare API

Use the `PORT` variable to change the listening port.

For rapid iteration you can run the TypeScript sources directly:

```bash
npm run dev
```

## API endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/` | Returns metadata about the running service. |
| `GET` | `/sandboxes` | List active sandboxes. |
| `POST` | `/sandboxes` | Create a sandbox. Accepts `id`, `metadata`, and `ttlSeconds`. |
| `GET` | `/sandboxes/:id` | Retrieve sandbox metadata. |
| `DELETE` | `/sandboxes/:id` | Destroy a sandbox and remove its files. |
| `POST` | `/sandboxes/:id/exec` | Execute a command inside the sandbox. |
| `PUT` | `/sandboxes/:id/files` | Write a file (optionally creating parent directories). |
| `GET` | `/sandboxes/:id/files` | Read a file or list a directory. |
| `DELETE` | `/sandboxes/:id/files` | Delete a file or directory. |
| `POST` | `/sandboxes/:id/directories` | Ensure a directory exists and list its contents. |
| `POST` | `/sandboxes/prune` | Manually trigger TTL-based cleanup. |

### Example usage

```bash
# Create a sandbox
curl -X POST http://localhost:8787/sandboxes -H 'content-type: application/json' \
  -d '{"metadata":{"name":"demo"},"ttlSeconds":30}'

# Execute a command
curl -X POST http://localhost:8787/sandboxes/{id}/exec -H 'content-type: application/json' \
  -d '{"command":"python3","args":["-c","print(2 + 2)"]}'

# Manage files
curl -X PUT http://localhost:8787/sandboxes/{id}/files -H 'content-type: application/json' \
  -d '{"path":"workspace/hello.txt","content":"Hello Sandbox!","createDirectories":true}'
```

## Testing

The project uses the built-in Node.js test runner. Run the suite with:

```bash
npm test
```

## License

This project is licensed under the terms of the MIT license. See the [LICENSE](LICENSE)
file for details.
