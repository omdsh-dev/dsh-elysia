import type { Context } from '@deepseek-ai/cordis'
import { server } from './host/server'

export const name = 'elysia-basic'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => server(ctx, { startedAt: Date.now() }), 'elysia-basic:routes')
}
