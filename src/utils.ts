import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { HostContext, HostService, HostServiceInstance } from './index'

export function getServerContext<Context = CordisContext>(source: HostService<any> | HostContext<unknown>): Context {
  return instanceOf(source).context as Context
}

export function getServerOptions<Options>(source: HostService<Options> | HostContext<Options>): Options {
  return instanceOf(source).options
}

function instanceOf<Options>(source: HostService<Options> | HostContext<Options>): HostServiceInstance<Options> {
  const instance = source?.__host_instance
  if (!instance)
    throw new TypeError('dsh-elysia: service is not active or context does not belong to a host service')
  return instance
}
