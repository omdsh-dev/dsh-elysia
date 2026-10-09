import type { Context, Static } from 'elysia'
import { t } from 'elysia'

export const inspectQuery = t.Object({ query: t.Optional(t.String()) })

export default function inspect(context: Context<{ query: Static<typeof inspectQuery> }>): {
  method: string
  path: string
  query: Static<typeof inspectQuery>
} {
  return {
    method: context.request.method,
    path: context.path,
    query: context.query,
  }
}
