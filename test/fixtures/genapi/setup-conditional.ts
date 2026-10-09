import { defineWebServer } from 'dsh-elysia'

declare const flag: boolean

const handler = (): { ok: boolean } => ({ ok: true })

export const server = defineWebServer((app) => {
  if (flag) {
    app.get('/api/conditional', handler)
  }
})
