import { Context } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { expect, it, vi } from 'vitest'
import { getApiEchoChannel, getApiHealth, getApiServer, postApiEchoChannel } from '../playground/src/client/apis'
import { server } from '../playground/src/host/server'

it('runs the generated client against the native Elysia playground through the host', async () => {
  const ctx = new Context()
  const nativeFetch = globalThis.fetch
  let dispose: (() => void) | undefined
  try {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    dispose = server(ctx, { startedAt: Date.now() - 1000 })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => nativeFetch(typeof input === 'string' ? new URL(input, base) : input, init))
    expect(await getApiHealth()).toMatchObject({ status: 'ok' })
    expect(await getApiServer()).toEqual({ port: ctx.webServer.port })
    expect(await getApiEchoChannel({ channel: 'client' }, { pretty: true, limit: 3 })).toEqual({
      channel: 'client',
      method: 'GET',
      pretty: true,
      limit: 3,
      query: { pretty: true, limit: 3 },
    })
    const body = { message: 'native JSON', tags: ['client'], metadata: { source: 'genapi' } }
    expect(await postApiEchoChannel({ channel: 'client' }, body, { limit: 2 })).toEqual({
      channel: 'client',
      method: 'POST',
      pretty: false,
      limit: 2,
      body,
      query: { limit: 2 },
    })
    expect((await nativeFetch(`${base}/api/echo/client?limit=bad`)).status).toBe(422)
    expect((await nativeFetch(`${base}/api/echo/client`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400)
    expect((await nativeFetch(`${base}/api/echo/client`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 1 }) })).status).toBe(422)
    const head = await nativeFetch(`${base}/api/health`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    dispose()
    expect((await nativeFetch(`${base}/api/health`)).status).toBe(404)
  }
  finally {
    vi.restoreAllMocks()
    dispose?.()
    await ctx.fiber.dispose()
  }
})
