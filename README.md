# tribble-troubles

An API façade for the Cloudflare Sandbox service. The project exposes an HTTP
interface that forwards command execution, file management, and lifecycle
controls to Cloudflare's managed Sandbox endpoints so that you can build and
test integrations against the real service from your local environment.

## Features

- Provision and destroy Cloudflare sandboxes on demand using your account credentials
  (or token-only access when targeting the Sandbox v1 API).
- Execute commands inside each sandbox with timeouts and custom environment variables.
- Read, write, and list files while preventing path traversal attacks.
- Delegate TTL enforcement to Cloudflare and manually trigger remote pruning when needed.
- Ship with a TypeScript SDK (`Sandbox`, `SandboxManager`) for embedding the behaviour
  in other applications.

## Getting started

### Prerequisites

- Node.js 18+ (Wrangler requires 16.17.0 or later — a version manager such as
  [nvm](https://github.com/nvm-sh/nvm) or [Volta](https://volta.sh/) makes
  switching versions easy).
- Docker Desktop or an alternative such as Colima running locally. Confirm that
  Docker is available by running `docker info`.
- A Cloudflare account with a Sandbox-enabled API token. The account identifier is
  required when you point the proxy at the Workers `client/v4` endpoint.

### Local development

```bash
npm install
npm run build
npm start
```

The server listens on port `8787` by default. Set the following environment
variables (or provide the equivalent options programmatically) to authenticate
with Cloudflare:

- `CLOUDFLARE_ACCOUNT_ID` – your Cloudflare account identifier (required when
  using the Workers `client/v4` API)
- `CLOUDFLARE_API_TOKEN` – an API token with Sandbox permissions (required)
- `CLOUDFLARE_API_BASE_URL` – optional alternative origin for the Cloudflare API.
  Defaults to the Sandbox v1 host when no account ID is provided.

Use the `PORT` variable to change the listening port.

For rapid iteration you can run the TypeScript sources directly:

```bash
npm run dev
```

### Deploying your own Worker + sandbox container

If you would like to provision a Cloudflare Worker that talks to the Sandbox
service directly, the official `npm create cloudflare@latest --
<project-name> --template=cloudflare/sandbox-sdk/examples/minimal` template is a
helpful starting point. The generated project includes:

- `src/index.ts` — an example Worker script that demonstrates `getSandbox`,
  `exec`, `writeFile`, and `readFile` usage.
- `wrangler.jsonc` — the configuration that binds the Worker to the Sandbox
  Durable Object and container image.
- `Dockerfile` — the execution environment that runs inside each sandbox
  instance.

From the generated directory:

1. Install dependencies and explore the Worker code.
2. Run `npm run dev` (or `npx wrangler dev`) to test locally. The first run will
   build your Docker image, so expect a brief delay.
3. Exercise the `/run` and `/file` endpoints to execute Python and perform file
   I/O inside the sandbox.
4. Deploy globally with `npx wrangler deploy`. Use `npx wrangler containers
   list` to monitor provisioning status. Allow a few minutes after the first
   deploy for the container image to become available.

When exposing preview URLs through `sandbox.exposePort()` you will need to set
up a custom domain with wildcard DNS routing — `*.workers.dev` domains do not
support the required subdomain patterns.

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
