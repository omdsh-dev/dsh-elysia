import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })
const prefix = '/api'

export const server = defineWebServer((app) => {
  app.get(`${prefix}/dynamic`, handler)
})
