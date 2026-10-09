import type { AnyElysia } from 'elysia'
import { defineWebServer } from 'dsh-elysia'

function plugin(app: AnyElysia): AnyElysia {
  if (app)
    throw new Error('plugin was executed')
  return app
}
export const server = defineWebServer((app) => {
  app.use(plugin)
})
