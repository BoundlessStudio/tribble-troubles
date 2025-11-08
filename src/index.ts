import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors';
import { type Env } from './types';
import sandboxRoutes from './routes/sandbox';
import sessionRoutes from './routes/session';


const app = new OpenAPIHono<{ Bindings: Env }>()

// CORS should be called before any route
app.use('/api/*', cors());

// Routes
app.route('/api', sandboxRoutes);
app.route('/api', sessionRoutes);

// The OpenAPI documentation 
app.doc('/api/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'tribble-troubles',
  },
})

export default app;
export { Sandbox } from '@cloudflare/sandbox';