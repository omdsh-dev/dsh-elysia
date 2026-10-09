import { defineWebServer } from 'dsh-elysia'

export const server = defineWebServer((app) => {
  app.onRequest(() => ({ intercepted: true }))
  app.get('/api/health', () => ({ ok: true }))
})
