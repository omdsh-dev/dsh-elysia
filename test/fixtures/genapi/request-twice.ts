import { defineWebServer } from 'dsh-elysia'

export const server = defineWebServer(app => app.get('/api/query-twice', context => ({ first: context.query.a, second: context.query.b })))
