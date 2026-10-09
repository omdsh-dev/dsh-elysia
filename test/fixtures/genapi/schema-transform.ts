import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer(app => app.get('/api/transform', () => ({ ok: true }), {
  query: t.Object({ value: t.Transform(t.String()).Decode(value => value.length).Encode(value => String(value)) }),
}))
