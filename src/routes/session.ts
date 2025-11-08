//import { Hono } from 'hono';
//import { type Env } from '../types';
import { getSandbox, SessionOptions } from '@cloudflare/sandbox';
import { createRoute, z } from '@hono/zod-openapi'; 
import { createApp } from '../app';

// const app = new Hono<{ Bindings: Env }>();

// app.post('/:identity/session', async (c) => {
//   const identity = c.req.param('identity');
// 	const options = await c.req.json<SessionOptions>();
// 	const sandbox = getSandbox(c.env.Sandbox, identity);
//   const session = await sandbox.createSession(options);
// 	return c.json({ id: session.id });
// });

// app.delete('/:identity/session/:id', async (c) => {
// 	const identity = c.req.param('identity');
//   const id = c.req.param('id');
// 	const sandbox = getSandbox(c.env.Sandbox, identity);
// 	await sandbox.deleteSession(id);
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

const IdentityAndIdParamsSchema = z.object({
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
	id: z
    .string()
    .min(3)
    .openapi({
      param: {
        name: 'id',
        in: 'path',
      },
      example: '1212121',
    }),
})

const SessionIdSchema = z
	.object({
		id: z.string().openapi({
			example: '1212121',
		})
	})
	.openapi('SessionId')


const createSession = createRoute({
  method: 'post',
  path: '/sandbox/{identity}/session',
  request: {
    params: IdentityParamsSchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SessionIdSchema,
        },
      },
      description: 'start the session',
    },
  },
})

const deleteSession = createRoute({
  method: 'delete',
  path: '/sandbox/{identity}/session/{id}',
  request: {
    params: IdentityAndIdParamsSchema,
  },
  responses: {
    200: {
      description: 'delete the session',
    },
  },
})


app.openapi(createSession, async (c) => {
	const { identity } = c.req.valid('param')
	const options = await c.req.json<SessionOptions>()
	const sandbox = getSandbox(c.env.Sandbox, identity)
  const session = await sandbox.createSession(options)
	return c.json({ id: session.id })
})


app.openapi(deleteSession, async (c) => {
	const { identity, id } = c.req.valid('param')
	const sandbox = getSandbox(c.env.Sandbox, identity)
	await sandbox.deleteSession(id)
	return c.body(null)
});

export default app