import { defineWebServer } from 'dsh-elysia'

interface Tree {
  child: Tree | null
}

const handler = (): Tree => ({ child: null })

export const server = defineWebServer((app) => {
  app.get('/api/tree', handler)
})
