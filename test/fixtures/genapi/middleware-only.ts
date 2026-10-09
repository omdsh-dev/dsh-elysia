import { defineWebServer } from 'dsh-elysia'

export const server = defineWebServer((app) => {
  app.onRequest(() => undefined)
})
