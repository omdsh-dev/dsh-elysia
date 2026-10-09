import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })
let rebound = handler
rebound = handler

export const server = defineWebServer((app) => {
  app.get('/api/not-const', rebound)
})
