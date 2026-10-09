import type { Context, Static } from 'elysia'
import { t } from 'elysia'

export const echoQuery = t.Object({
  pretty: t.Optional(t.Boolean()),
  limit: t.Optional(t.Number()),
})

export const echoBody = t.Object({
  message: t.String(),
  tags: t.Optional(t.Array(t.String())),
  metadata: t.Optional(t.Record(t.String(), t.String())),
})

type EchoContext = Context<{
  query: Static<typeof echoQuery>
  body: Static<typeof echoBody>
  params: { channel: string }
}>

export function readEcho(context: Omit<EchoContext, 'body'>): {
  channel: string
  method: string
  pretty: boolean
  limit: number
  query: Static<typeof echoQuery>
} {
  return {
    channel: context.params.channel,
    method: context.request.method,
    pretty: context.query.pretty ?? false,
    limit: context.query.limit ?? 10,
    query: context.query,
  }
}

export function writeEcho(context: EchoContext): ReturnType<typeof readEcho> & { body: Static<typeof echoBody> } {
  return {
    channel: context.params.channel,
    method: context.request.method,
    pretty: context.query.pretty ?? false,
    limit: context.query.limit ?? 10,
    body: context.body,
    query: context.query,
  }
}
