import { defineWebServer } from 'dsh-elysia'

const handler = (): { total: bigint } => ({ total: 1n })

export const server = defineWebServer((app) => {
  app.get('/api/bigint', handler)
})
