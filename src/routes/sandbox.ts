//import { Hono } from 'hono';
//import { getSandbox, SandboxOptions } from '@cloudflare/sandbox';
//import { type Env } from '../types';
import { getSandbox, SandboxOptions, SessionOptions } from '@cloudflare/sandbox';
import { createRoute, z } from '@hono/zod-openapi'; 
import { createApp } from '../app';

// const app = new Hono<{ Bindings: Env }>();

// app.post('/', async (c) => {
// 	const { id, ttl } = await c.req.json<{ id: string, ttl: string | undefined }>(); 
// 	// ttl: A string like "30s", "3m", "5m", "1h" (seconds, minutes, or hours)
// 	// default should be 10m
// 	// undefine means keep alive
// 	const options = { keepAlive : ttl == undefined, sleepAfter : ttl } as SandboxOptions;
// 	const _ = getSandbox(c.env.Sandbox, id, options);
// 	return c.json({ id });
// });

// app.delete('/:identity', async (c) => {
// 	const identity = c.req.param('identity');
// 	const sandbox = getSandbox(c.env.Sandbox, identity);
// 	await sandbox.destroy();
// });

// export default app;

const app = createApp()

const IdentityParamsSchema = z.object({
  identity: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'identity',
        in: 'path',
      },
      example: '1212121',
    }),
})

const SandboxCreationSchema = z
	.object({
		identity: z.string().openapi({
			example: '1212121',
		}),
		ttl: z.string()
					.optional()
					.default("10m")
					.openapi({
						example: 'A string like "30s", "3m", "5m", "1h"',
		}),
	})
	.openapi('SandboxCreation')

const SandboxIdentitySchema = z
	.object({
		identity: z.string().openapi({
			example: '1212121',
		})
	})
	.openapi('SandboxIdentity')

const createSandbox = createRoute({
	method: 'post',
	path: '/sandbox',
	request: {
		body: {
			content: {
				'application/json': {
					schema: SandboxCreationSchema
				}
			},
			description: "options to start the sandbox"
		},
	},
	responses: {
		200: {
			content: {
        'application/json': {
          schema: SandboxIdentitySchema,
        },
      },
			description: 'start the sandbox',
		},
	},
})

const destroySandbox = createRoute({
	method: 'delete',
	path: '/sandbox/{identity}',
	request: {
    params: IdentityParamsSchema,
  },
	responses: {
		200: {
			description: 'destroy the sandbox',
		},
	},
})

app.openapi(createSandbox, async (c) => {
	const { identity, ttl } = c.req.valid('json');
	const options = { keepAlive : ttl == undefined, sleepAfter : ttl } as SandboxOptions;
	const _ = getSandbox(c.env.Sandbox, identity, options);
	return c.json({ identity });
})

app.openapi(destroySandbox, async (c) => {
	const { identity } = c.req.valid('param')
	const sandbox = getSandbox(c.env.Sandbox, identity);
 	await sandbox.destroy();
	return c.body(null)
});

export default app