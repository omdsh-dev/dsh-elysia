import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })

export const server = defineWebServer((app) => {
  app.get('/api/literal-exact/', handler)
  app.get('/api/literal-prefix/*', handler)
  app.get('/', handler)
})
