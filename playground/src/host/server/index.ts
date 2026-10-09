import { defineWebServer } from 'dsh-elysia'
import { echoBody, echoQuery, readEcho, writeEcho } from './routes/echo'
import health from './routes/health'
import inspect, { inspectQuery } from './routes/inspect'
import serverInfo from './routes/server'

export interface ServerOptions {
  startedAt: number
}

export const server = defineWebServer<ServerOptions>((app) => {
  app.get('/api/health', health)
  app.get('/api/server', serverInfo)
  app.get('/api/inspect', inspect, { query: inspectQuery })
  app.get('/api/echo/:channel', readEcho, { query: echoQuery })
  app.post('/api/echo/:channel', writeEcho, { query: echoQuery, body: echoBody })
})
