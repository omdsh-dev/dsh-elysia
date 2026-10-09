import { defineWebServer } from 'dsh-elysia'

const handler = (): { onClick: () => number } => ({ onClick: () => 1 })

export const server = defineWebServer((app) => {
  app.get('/api/function-contract', handler)
})
