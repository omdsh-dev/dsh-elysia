import type { ServerResponse } from 'node:http'
import type { ServerRequest } from 'srvx'
import type { HostApp, HostContext } from '../src'
import { Buffer } from 'node:buffer'
import { request } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { Elysia, t } from 'elysia'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineWebServer } from '../src'
import { getServerContext, getServerOptions } from '../src/utils'

describe('host service', () => {
  const ctx = new Context()
  const disposers: Array<() => void | Promise<void>> = []
  let base: string
  beforeAll(async () => {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'gzip', compressionThresholdBytes: 1024 })
    base = `http://127.0.0.1:${ctx.webServer.port}`
  })
  afterEach(async () => {
    for (const dispose of disposers.splice(0).reverse())
      await dispose()
  })
  afterAll(async () => {
    await ctx.fiber.dispose()
  })

  it('runs native API, middleware, JSON validation and a labeled Cordis effect', async () => {
    const service = defineWebServer((app) => {
      expect(app).toBeInstanceOf(Elysia)
      expectTypeOf(app).toEqualTypeOf<HostApp>()
      expect(app.get).toBe(Elysia.prototype.get)
      app.onBeforeHandle(({ set }) => {
        set.headers['x-middleware'] = 'seen'
      })
      app.post('/hello', () => 'posted')
      app.get('/hello', ({ request }) => ({ method: request.method }))
      app.post('/aaa', ({ body }) => ({ body, middleware: 'seen' }), { body: t.Object({ value: t.Number() }) })
      app.post('/bbb/*', ({ request }) => new URL(request.url).pathname + new URL(request.url).search)
    })
    const register = vi.spyOn(ctx.webServer, 'register')
    const dispose = ctx.effect(() => service(ctx), 'custom-label')
    disposers.push(dispose)
    expect(register).toHaveBeenCalledTimes(3)
    register.mockRestore()
    const hello = await fetch(`${base}/hello`)
    expect(hello.headers.get('x-middleware')).toBe('seen')
    expect(await hello.json()).toEqual({ method: 'GET' })
    expect(await (await fetch(`${base}/hello`, { method: 'POST' })).text()).toBe('posted')
    expect(await (await fetch(`${base}/aaa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 42 }) })).json()).toEqual({ body: { value: 42 }, middleware: 'seen' })
    expect((await fetch(`${base}/aaa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(422)
    expect(await (await fetch(`${base}/bbb/child?query=1`, { method: 'POST' })).text()).toBe('/bbb/child?query=1')
    expect((await fetch(`${base}/bbb`, { method: 'POST' })).status).toBe(404)
    expect(await (await fetch(`${base}/bbb/`, { method: 'POST' })).text()).toBe('/bbb/')
    expect((await fetch(`${base}/bbbb`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/aaa/child`, { method: 'POST' })).status).toBe(404)
    const head = await fetch(`${base}/hello`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const wrongMethod = await fetch(`${base}/hello`, { method: 'PUT' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST, GET, HEAD')
    await dispose()
    expect((await fetch(`${base}/hello`)).status).toBe(404)
    disposers.push(defineWebServer(app => app.get('/hello', () => 'replacement'))(ctx))
    await dispose()
    expect(await (await fetch(`${base}/hello`)).text()).toBe('replacement')
  })

  it('binds native context/options per activation and clears disposed instances', async () => {
    interface Options { name: string }
    const first = { name: 'first' }
    const second = { name: 'second' }
    const capturedContexts: Context[] = []
    const capturedOptions: Options[] = []
    const service = defineWebServer<Options>((app) => {
      app.onBeforeHandle((event) => {
        capturedContexts.push(getServerContext(event))
      })
      app.get('/instance', (event) => {
        const options = getServerOptions(event)
        capturedOptions.push(options)
        return { name: options.name, port: getServerContext(event).webServer.port }
      })
    })
    expect(() => getServerContext(service)).toThrow('service is not active')
    expect(() => getServerOptions(service)).toThrow('service is not active')
    const foreign = {} as HostContext<Options>
    expect(() => getServerContext(foreign)).toThrow('context does not belong')
    expect(() => getServerOptions(foreign)).toThrow('context does not belong')
    const disposeFirst = service(ctx, first)
    disposers.push(disposeFirst)
    const firstInstance = service.__host_instance
    expect(getServerContext(service)).toBe(ctx)
    expectTypeOf(getServerContext(service)).toEqualTypeOf<Context>()
    expectTypeOf(getServerContext<Context & { custom: string }>(service)).toEqualTypeOf<Context & { custom: string }>()
    expect(getServerContext<Context & { custom: string }>(service)).toBe(ctx)
    expect(getServerOptions(service)).toBe(first)
    expectTypeOf(getServerOptions(service)).toEqualTypeOf<Options>()
    expect(() => service(ctx, second)).toThrow('duplicate exact route')
    expect(service.__host_instance).toBe(firstInstance)
    const other = new Context()
    disposers.push(() => other.fiber.dispose())
    await other.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const disposeSecond = service(other, second)
    disposers.push(disposeSecond)
    expect(getServerContext(service)).toBe(other)
    expect(getServerOptions(service)).toBe(second)
    expect(await (await fetch(`${base}/instance`)).json()).toEqual({ name: 'first', port: ctx.webServer.port })
    expect(await (await fetch(`http://127.0.0.1:${other.webServer.port}/instance`)).json()).toEqual({ name: 'second', port: other.webServer.port })
    expect(capturedContexts).toEqual([ctx, other])
    expect(capturedOptions[0]).toBe(first)
    expect(capturedOptions[1]).toBe(second)
    disposeFirst()
    expect(getServerContext(service)).toBe(other)
    disposeSecond()
    expect(service.__host_instance).toBeUndefined()
    expect(() => getServerOptions(service)).toThrow('service is not active')
    disposers.push(service(ctx, first))
    expect(getServerContext(service)).toBe(ctx)
  })

  it('supports services without options', async () => {
    const service = defineWebServer(app => app.get('/no-options', (event) => {
      expect(getServerOptions(event)).toBeUndefined()
      expect(getServerContext(event)).toBe(ctx)
      expectTypeOf(getServerContext<Context & { custom: string }>(event)).toEqualTypeOf<Context & { custom: string }>()
      return { ok: true }
    }))
    disposers.push(service(ctx))
    expect(getServerOptions(service)).toBeUndefined()
    expectTypeOf(getServerOptions(service)).toEqualTypeOf<undefined>()
    expect(await (await fetch(`${base}/no-options`)).json()).toEqual({ ok: true })
  })

  it('keeps exact and longest-prefix method ownership', async () => {
    disposers.push(defineWebServer((app) => {
      app.post('/scope/*', () => 'outer')
      app.get('/scope/nested/*', () => 'inner')
      app.get('/scope/exact', () => 'exact')
    })(ctx))
    expect(await (await fetch(`${base}/scope/nested/child`)).text()).toBe('inner')
    expect((await fetch(`${base}/scope/nested/child`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/scope/exact`, { method: 'POST' })).status).toBe(405)
  })

  it('keeps HEAD and all fallbacks within the selected host group', async () => {
    const outer = vi.fn(() => 'outer')
    const exact = vi.fn(() => 'exact')
    disposers.push(defineWebServer((app) => {
      app.head('/ownership/*', outer)
      app.get('/ownership/exact', exact)
      app.get('/ownership/nested/*', exact)
      app.all('/all-methods/*', outer)
      app.get('/all-methods/exact', exact)
      app.get('/', () => 'root')
    })(ctx))
    for (const path of ['/ownership/exact', '/ownership/nested/child'])
      expect((await fetch(`${base}${path}`, { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(`${base}/all-methods/exact`, { method: 'POST' })).status).toBe(405)
    expect(await (await fetch(`${base}/`)).text()).toBe('root')
    expect(exact).toHaveBeenCalledTimes(2)
    expect(outer).not.toHaveBeenCalled()
    expect(await (await fetch(`${base}/all-methods/child`, { method: 'POST' })).text()).toBe('outer')
  })

  it('preserves explicit and implicit HEAD per pattern within a shared prefix', async () => {
    const get = vi.fn(() => 'get')
    const head = vi.fn(() => 'head')
    disposers.push(defineWebServer((app) => {
      app.get('/mixed/:id/detail', get)
      app.get('/mixed/:id', get)
      app.head('/mixed/:id', head)
    })(ctx))
    expect((await fetch(`${base}/mixed/123/detail`, { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(`${base}/mixed/123`, { method: 'HEAD' })).status).toBe(200)
    expect(get).toHaveBeenCalledOnce()
    expect(head).toHaveBeenCalledOnce()
  })

  it('preserves native plugins, state, models, parsers, scoped hooks and chaining', async () => {
    let captured: HostApp | undefined
    const child = new Elysia({ prefix: '/mounted' }).get('/', () => 'child root').get('/child', () => ({ marker: 'native' }))
    disposers.push(defineWebServer((app) => {
      captured = app
      app.headers({ 'x-default': 'default' })
      app.onRequest(({ set }) => {
        set.headers['x-request'] = 'request'
      })
      const native = app.state('count', 42).model('query', t.Object({ name: t.String() })).parser('custom', ({ request }) => request.text()).derive(() => ({ marker: 'derived' }))
      native.use(child)
      expect(native.get('/users/:id', event => ({ id: event.params.id, middleware: event.marker, count: event.store.count }), { beforeHandle: ({ set }) => {
        set.headers['x-local'] = 'true'
      } })).toBe(app)
      native.get('/files/*', ({ params }) => params['*'])
      native.get('/inline/:id', ({ params }) => params.id)
      native.route('GET', '/trailing/', () => 'trailing')
      native.get('/路径', () => 'unicode')
      native.get('/encoded/a%20b', () => 'encoded')
      native.get('/model', ({ query }) => query.name, { query: 'query' })
      native.post('/parse', ({ body }) => body, { parse: 'custom' })
    })(ctx))
    expect(await (await fetch(`${base}/mounted`)).text()).toBe('child root')
    expect(await (await fetch(`${base}/mounted/child`)).json()).toEqual({ marker: 'native' })
    expect(await (await fetch(`${base}/inline/456`)).text()).toBe('456')
    const user = await fetch(`${base}/users/123`)
    expect(user.headers.get('x-local')).toBe('true')
    expect(user.headers.get('x-request')).toBe('request')
    expect(user.headers.get('x-default')).toBe('default')
    expect(await user.json()).toEqual({ id: '123', middleware: 'derived', count: 42 })
    expect(await (await fetch(`${base}/files/a/b`)).text()).toBe('a/b')
    expect(await (await fetch(`${base}/trailing`)).text()).toBe('trailing')
    expect(await (await fetch(`${base}/路径`)).text()).toBe('unicode')
    expect(await (await fetch(`${base}/encoded/a%20b`)).text()).toBe('encoded')
    expect(await (await fetch(`${base}/model?name=hello`)).text()).toBe('hello')
    expect(await (await fetch(`${base}/parse`, { method: 'POST', body: 'custom' })).text()).toBe('custom')
    expect(await (await captured!.handle(new Request('http://localhost/users/direct'))).json()).toEqual({ id: 'direct', middleware: 'derived', count: 42 })
  })

  it('rolls back partial registration without removing existing routes', async () => {
    disposers.push(defineWebServer(app => app.get('/occupied', () => 'existing'))(ctx))
    expect(() => defineWebServer((app) => {
      app.get('/temporary', () => 'temporary')
      app.get('/occupied', () => 'conflict')
    })(ctx)).toThrow('duplicate exact route')
    expect((await fetch(`${base}/temporary`)).status).toBe(404)
    expect(await (await fetch(`${base}/occupied`)).text()).toBe('existing')
    const dispose = defineWebServer(app => app.get('/temporary', () => 'new'))(ctx)
    dispose()
    disposers.push(defineWebServer(app => app.get('/temporary', () => 'replacement'))(ctx))
    dispose()
    expect(await (await fetch(`${base}/temporary`)).text()).toBe('replacement')
  })

  it('rejects asynchronous native plugins before host registration', () => {
    const register = vi.spyOn(ctx.webServer, 'register')
    expect(() => defineWebServer((app) => {
      app.get('/sync-before-async', () => 'not registered')
      app.use(Promise.resolve(new Elysia().get('/async-plugin', () => 'async')))
    })(ctx)).toThrow('asynchronous plugins are not supported')
    expect(register).not.toHaveBeenCalled()
    register.mockRestore()
  })

  it('validates declarations before any registration', () => {
    const register = vi.spyOn(ctx.webServer, 'register')
    for (const route of ['/invalid?query', '//example.com', '/invalid\\path', '/invalid//', '/api//:id']) {
      expect(() => defineWebServer((app) => {
        app.get('/otherwise-valid', () => 'unused')
        app.get(route, () => 'invalid')
      })(ctx)).toThrow(TypeError)
    }
    expect(register).not.toHaveBeenCalled()
    register.mockRestore()
    expect(() => defineWebServer(app => app.get('/:id', () => 'root pattern'))(ctx)).toThrow('root-level patterns')
    expect(() => defineWebServer(() => {})(new Context())).toThrow('webServer service')
    // @ts-expect-error setup requires callback
    expect(() => defineWebServer('invalid')).toThrow('requires a setup callback')
    // @ts-expect-error setup cannot return an unrelated value
    expect(() => defineWebServer(() => 'invalid')(ctx)).toThrow('setup must be synchronous')
    // @ts-expect-error native paths are strings
    expect(() => defineWebServer(app => app.get(undefined, () => 'unused'))(ctx)).toThrow(TypeError)
    // @ts-expect-error host descriptors are not Elysia paths
    expect(() => defineWebServer(app => app.get({ kind: 'exact', path: '/removed' }, () => 'unused'))(ctx)).toThrow(TypeError)
  })

  it('keeps native Response and large string responses compressed', async () => {
    const body = 'large gzip response '.repeat(256)
    disposers.push(defineWebServer((app) => {
      app.get('/large', () => new Response(body, { headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=60' } }))
      app.get('/large-native', () => body)
    })(ctx))
    for (const path of ['/large', '/large-native']) {
      const response = await rawGet(`${base}${path}`)
      expect(response.encoding).toBe('gzip')
      expect(gunzipSync(response.body).toString()).toBe(body)
    }
  })

  it('normalizes all Node end overloads through host compression', async () => {
    const callbacks: string[] = []
    const repeated = vi.fn()
    disposers.push(defineWebServer((app) => {
      app.onBeforeHandle(({ request }) => {
        const res = (request as ServerRequest).runtime!.node!.res! as ServerResponse
        const done = (): void => {
          callbacks.push(new URL(request.url).pathname)
          res.end(repeated)
        }
        switch (new URL(request.url).pathname) {
          case '/end/callback':
            res.end(done)
            break
          case '/end/encoding-callback':
            res.end('small', done)
            break
          case '/end/explicit':
            res.end('small', 'utf8', done)
            break
          case '/end/bare':
            res.end()
            break
        }
        return new Response(null)
      })
      app.get('/end/callback', () => null)
      app.get('/end/encoding-callback', () => null)
      app.get('/end/explicit', () => null)
      app.get('/end/bare', () => null)
    })(ctx))
    for (const path of ['/end/callback', '/end/encoding-callback', '/end/explicit', '/end/bare'])
      expect((await fetch(`${base}${path}`)).status).toBe(200)
    expect(callbacks).toEqual(['/end/callback', '/end/encoding-callback', '/end/explicit'])
    expect(repeated).toHaveBeenCalledTimes(3)
    expect(repeated).toHaveBeenCalledWith(expect.objectContaining({ code: 'ERR_STREAM_ALREADY_FINISHED' }))
  })

  it('preserves Response streams, SSE and native error hooks', async () => {
    disposers.push(defineWebServer((app) => {
      app.onError(({ error, set }) => {
        set.status = 500
        return { message: error instanceof Error ? error.message : String(error) }
      })
      app.get('/error', () => {
        throw new Error('native failure')
      })
      app.get('/stream', () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed'))
        controller.close()
      } }), { headers: { 'content-type': 'text/plain' } }))
      app.get('/sse', function* ({ set }) {
        set.headers['content-type'] = 'text/event-stream'
        yield 'first'
        yield 'second'
      })
    })(ctx))
    expect(await (await fetch(`${base}/error`)).json()).toEqual({ message: 'native failure' })
    expect(await (await fetch(`${base}/stream`)).text()).toBe('streamed')
    const sse = await rawGet(`${base}/sse`)
    expect(sse.encoding).toBeUndefined()
    expect(sse.body.toString()).toContain('first')
    expect(sse.body.toString()).toContain('second')
  })
})

function rawGet(url: string): Promise<{ encoding: string | string[] | undefined, body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ encoding: res.headers['content-encoding'], body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(3000, () => req.destroy(new Error('response timed out')))
    req.end()
  })
}
