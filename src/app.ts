import { OpenAPIHono } from '@hono/zod-openapi'
import { type Env } from './types';

export function createApp() {
  return new OpenAPIHono<{ Bindings: Env }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            ok: false,
            error: JSON.parse(result.error.message),
            source: 'ZodError',
          },
          422
        )
      }
    },
  });
}