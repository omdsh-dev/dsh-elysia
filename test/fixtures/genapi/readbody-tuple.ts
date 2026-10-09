import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

const handler = ({ body }: { body: [string, number] }): { value: string } => ({ value: body[0] })
export const server = defineWebServer(app => app.post('/api/readbody-tuple', handler, { body: t.Tuple([t.String(), t.Number()]) }))
