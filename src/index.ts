/// <reference types="@deepseek-ai/dsh-host-webserver" preserve="true" />

import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { AnyElysia } from 'elysia'
import type { RequestListener } from 'node:http'
import { ServerResponse } from 'node:http'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import { toNodeHandler } from 'srvx/node'

/** Cordis service and options belonging to one activation. */
export interface HostServiceInstance<Options = undefined> {
  context: Context
  options: Options
}

export interface HostContext<Options = undefined> {
  __host_instance: HostServiceInstance<Options>
}

export type HostApp<Options = undefined> = Elysia<'', {
  decorator: { __host_instance: HostServiceInstance<Options> }
  store: Record<never, never>
  derive: Record<never, never>
  resolve: Record<never, never>
}>

export type HostService<Options = undefined> = (undefined extends Options
  ? (ctx: Context, options?: Options) => () => void
  : (ctx: Context, options: Options) => () => void) & {
    __host_instance?: HostServiceInstance<Options>
  }

const DYNAMIC_ROUTE_RE = /\/[^/]*[:*]/

/** Register native Elysia routes on the existing host, without listening. */
export function defineWebServer<Options = undefined>(setup: (app: HostApp<Options>) => void | AnyElysia): HostService<Options> {
  if (typeof setup !== 'function')
    throw new TypeError('dsh-elysia: defineWebServer requires a setup callback')

  const server = function (ctx: Context, options?: Options): () => void {
    const webServer = ctx?.webServer
    if (typeof webServer?.register !== 'function')
      throw new TypeError('dsh-elysia: server(ctx) requires the webServer service')

    const instance: HostServiceInstance<Options> = { context: ctx, options: options as Options }
    const app = new Elysia({ adapter: node() }).decorate('__host_instance', instance)
    const result = setup(app)
    if (result !== undefined && result !== app)
      throw new TypeError('dsh-elysia: setup must be synchronous and return nothing or the app')
    if (app.modules.size)
      throw new TypeError('dsh-elysia: asynchronous plugins are not supported; register native plugins synchronously')

    const groups = new Map<string, { route: Omit<WebRoute, 'handler'>, routes: typeof app.routes }>()
    for (const nativeRoute of app.routes) {
      const route = hostRouteOf(nativeRoute.path)
      const key = `${route.kind}\0${route.path}`
      let group = groups.get(key)
      if (!group) {
        group = { route, routes: [] }
        groups.set(key, group)
      }
      group.routes.push(nativeRoute)
    }

    const disposers: Array<() => void> = []
    const dispose = (): void => {
      for (const unregister of disposers.splice(0).reverse())
        unregister()
      if (server.__host_instance === instance)
        delete server.__host_instance
    }

    try {
      for (const { route, routes } of groups.values()) {
        // Elysia 1.4's WebStandard dynamic HEAD fallback precedes explicit HEAD.
        // We register HEAD per pattern below; Node itself suppresses its body.
        const routedApp = new Elysia({ ...app.config, prefix: '', adapter: { ...node(), isWebStandard: false } })
        // ponytail: Elysia 1.4 internal resource sharing; replace with a native
        // scoped-router export if upstream provides one. Never share routers.
        // Route hooks already include inherited lifecycle and validators.
        // eslint-disable-next-line dot-notation -- protected Elysia activation resources
        routedApp['singleton'] = app['singleton']
        // eslint-disable-next-line dot-notation -- protected Elysia activation resources
        routedApp['definitions'] = app['definitions']
        // eslint-disable-next-line dot-notation -- protected Elysia activation resources
        routedApp['extender'] = app['extender']
        routedApp['~parser'] = app['~parser']
        // eslint-disable-next-line dot-notation -- protected Elysia activation resources
        routedApp.headers(app['setHeaders'])
        const methods = new Set(routes.map(route => route.method))
        for (const nativeRoute of routes) {
          routedApp.route(nativeRoute.method, nativeRoute.path, nativeRoute.handler, nativeRoute.hooks)
          if (nativeRoute.method === 'GET' && !routes.some(route => route.method === 'HEAD' && route.path === nativeRoute.path))
            routedApp.route('HEAD', nativeRoute.path, nativeRoute.handler, nativeRoute.hooks)
        }
        routedApp.event = app.event
        const handler = toNodeHandler(routedApp.fetch) as RequestListener
        disposers.push(webServer.register({
          ...route,
          handler: async (req, res) => {
            const method = req.method ?? 'GET'
            if (!methods.has('ALL') && !methods.has(method) && !(method === 'HEAD' && methods.has('GET'))) {
              const allowed = new Set(methods)
              if (allowed.has('GET'))
                allowed.add('HEAD')
              res.writeHead(405, { allow: [...allowed].join(', ') })
              res.end()
              return
            }
            patchResponseEnd(res)
            await handler(req, res)
          },
        }))
      }
    }
    catch (error) {
      dispose()
      throw error
    }
    server.__host_instance = instance
    return dispose
  } as HostService<Options>
  return server
}

/** compression's res.end drops callbacks and treats end(callback) as a body. */
function patchResponseEnd(res: ServerResponse): void {
  const originalEnd = res.end
  res.end = function (chunk?: string | Uint8Array | (() => void), encoding?: BufferEncoding | (() => void), callback?: () => void) {
    const done = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : callback
    const data = typeof chunk === 'function' ? undefined : chunk
    const charset = typeof encoding === 'string' ? encoding : 'utf8'
    if (this.writableEnded)
      return ServerResponse.prototype.end.call(this, data, charset, done)
    if (done)
      this.once('finish', done)
    return originalEnd.call(this, data, charset)
  }
}

function hostRouteOf(pattern: string): Omit<WebRoute, 'handler'> {
  const dynamicIndex = pattern.search(DYNAMIC_ROUTE_RE)
  if (dynamicIndex === 0)
    throw new TypeError('dsh-elysia: root-level patterns need a WebServer fallback; use a static prefix for named routes')
  const kind = dynamicIndex < 0 ? 'exact' : 'prefix'
  const path = dynamicIndex < 0
    ? pattern === '/' ? pattern : pattern.replace(/\/$/, '')
    : pattern.slice(0, dynamicIndex)
  if (!path.startsWith('/') || path.startsWith('//') || (path !== '/' && path.endsWith('/')) || /[?#\\]/.test(path) || new URL(path, 'http://localhost').pathname !== encodeURI(path).replace(/%25([\dA-F]{2})/gi, '%$1'))
    throw new TypeError('dsh-elysia: route path must be an absolute pathname without a trailing slash')
  return { kind, path: new URL(path, 'http://localhost').pathname }
}
