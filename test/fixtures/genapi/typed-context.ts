import type { Context } from 'elysia'
import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

function read(context: Context<{ query: { term?: string, page?: string } }>): { term: string | undefined, page: string | undefined } {
  const { query: filters } = context
  const page = context.query.page
  return { term: filters.term, page }
}
const write = ({ body }: Context<{ body: { message: string } }>): { message: string } => ({ message: body.message })
export const server = defineWebServer((app) => {
  app.get('/api/typed', read)
  app.post('/api/typed', write, { body: t.Object({ message: t.String() }) })
})
