import { type Sandbox } from '@cloudflare/sandbox';

export interface Env {
	Sandbox: DurableObjectNamespace<Sandbox>;
	ANTHROPIC_API_KEY: string;
}
