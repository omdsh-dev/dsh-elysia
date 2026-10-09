import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer(app => app.get('/api/unknown', () => ({ ok: true }), { query: t.Object({ value: t.Unknown() }) }))
