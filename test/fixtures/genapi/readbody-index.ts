import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

const handler = ({ body }: { body: Record<string, string> }): { value: number } => ({ value: Object.keys(body).length })
export const server = defineWebServer(app => app.post('/api/readbody-index', handler, { body: t.Record(t.String(), t.String()) }))
