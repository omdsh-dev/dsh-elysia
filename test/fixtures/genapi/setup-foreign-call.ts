import { defineWebServer } from 'dsh-elysia'

const helper = { run: (...args: unknown[]) => args.length }
const handler = (): { ok: boolean } => ({ ok: true })

export const server = defineWebServer((_app) => {
  helper.run('/api/helper', handler)
})
