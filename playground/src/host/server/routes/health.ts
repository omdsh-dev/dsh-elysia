import type { HostServiceInstance } from 'dsh-elysia'
import type { ServerOptions } from '..'
import { getServerOptions } from 'dsh-elysia/utils'

export default function health(context: { __host_instance: HostServiceInstance<ServerOptions> }): { status: string, uptimeMs: number } {
  const { startedAt } = getServerOptions(context)
  return { status: 'ok', uptimeMs: Date.now() - startedAt }
}
