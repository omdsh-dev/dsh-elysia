import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer((app) => {
  app.get('/api/health', () => ({ status: 'ok' }))
  app.get('/api/userID/list', () => ({ users: [{ id: 1 }] }))
  app.get('/api/echo/:channel', ({ query }) => ({ query }), { query: t.Object({ pretty: t.Optional(t.Boolean()), limit: t.Optional(t.Number()) }) })
  app.post('/api/echo/:channel', async ({ body }) => ({ message: body.message }), { body: t.Object({ message: t.String() }) })
})
