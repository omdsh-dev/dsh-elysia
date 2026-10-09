import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })

export const server = defineWebServer((app) => {
  app.get('/api/duplicate', handler)
  app.get('/api/duplicate', handler)
})
