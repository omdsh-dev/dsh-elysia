import { defineWebServer } from 'dsh-elysia'

export const server = defineWebServer(app => app.get('/api/hook', () => ({ ok: true }), {
  mapResponse: () => new Response('not JSON', { headers: { 'content-type': 'text/plain' } }),
}))
