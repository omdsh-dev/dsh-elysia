import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer((app) => {
  app.post('/api/readbody-object', ({ body }) => ({ received: !!body }), { body: t.Object({ name: t.String(), tags: t.Optional(t.Array(t.String())) }) })
  app.get('/api/nested-query', (context) => {
    const inner = (): string => context.query.q ?? ''
    return { query: inner() }
  }, { query: t.Object({ q: t.Optional(t.String()) }) })
})
