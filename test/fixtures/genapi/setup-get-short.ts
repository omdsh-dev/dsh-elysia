import { defineWebServer } from 'dsh-elysia'

const handler = (): { ok: boolean } => ({ ok: true })
const getArguments: [string, typeof handler] = ['/api/get-short', handler]

export const server = defineWebServer((app) => {
  app.get(...getArguments)
})
