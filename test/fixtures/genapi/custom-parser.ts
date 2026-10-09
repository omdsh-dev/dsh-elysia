import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer(app => app.post('/api/parser', ({ body }) => body, {
  parse: async ({ request }) => ({ message: await request.text() }),
  body: t.Object({ message: t.String() }),
}))
