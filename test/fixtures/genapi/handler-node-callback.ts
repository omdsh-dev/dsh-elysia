import { defineWebServer } from 'dsh-elysia'

const factory = () => (_context: unknown) => ({ ok: true })
export const server = defineWebServer(app => app.get('/api/node-callback', factory()))
