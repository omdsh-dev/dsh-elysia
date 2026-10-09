import { defineWebServer } from 'dsh-elysia'

declare const enabled: boolean

const handler = (): { ok: boolean } => ({ ok: true })

if (enabled) {
  const nested = defineWebServer((app) => {
    app.get('/api/nested-module', handler)
  })
  void nested
}
