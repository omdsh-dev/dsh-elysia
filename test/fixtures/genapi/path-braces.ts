import { defineWebServer } from 'dsh-elysia'

export const server = defineWebServer((app) => {
  app.get('/api/{id}', () => ({ ok: true }))
})
