import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

const handler = ({ body }: { body: string }): { value: number } => ({ value: body.length })
export const server = defineWebServer(app => app.post('/api/readbody-string', handler, { body: t.String() }))
