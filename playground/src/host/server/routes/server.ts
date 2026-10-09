import type { HostServiceInstance } from 'dsh-elysia'
import type { ServerOptions } from '..'
import { getServerContext } from 'dsh-elysia/utils'

export default function serverInfo(context: { __host_instance: HostServiceInstance<ServerOptions> }): { port: number } {
  const ctx = getServerContext(context)
  return { port: ctx.webServer.port }
}
