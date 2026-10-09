import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'
import { querySchema } from './native-shared'

const bodySchema = t.Object({
  message: t.String(),
  tags: t.Optional(t.Array(t.String())),
  metadata: t.Optional(t.Record(t.String(), t.String())),
  kind: t.Union([t.Literal('a'), t.Literal('b')]),
})

export const server = defineWebServer((app) => {
  app.route('GET', '/api/native/:id', ({ query }) => ({ limit: query.limit, enabled: query.enabled }), { query: querySchema })
  app.post('/api/native', async ({ body }) => ({ message: body.message, tags: body.tags }), { body: bodySchema })
  app.get('/api/object', { ok: true, nested: { value: 1 } })
  app.get('/api/schema-response', () => ({ ok: true }), { response: t.Object({ ok: t.Boolean() }) })
})
