import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })
const routeArguments: ['/api/route-short', typeof handler] = ['/api/route-short', handler]
export const server = defineWebServer(app => app.route('GET', ...routeArguments))
