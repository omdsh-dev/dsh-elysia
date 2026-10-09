import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer(app => app.get('/api/function', () => ({ ok: true }), { body: t.Object({ value: t.Function([], t.String()) }) }))
