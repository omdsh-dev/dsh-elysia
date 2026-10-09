import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })

export const server = defineWebServer((app) => {
  // eslint-disable-next-line prefer-const -- genapi must reject non-const route bindings
  let local = handler
  app.get('/api/local', local)
})
