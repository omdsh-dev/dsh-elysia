import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

const handler = ({ body }: { body: string[] }): { value: number } => ({ value: body.length })
export const server = defineWebServer(app => app.post('/api/readbody-array', handler, { body: t.Array(t.String()) }))
