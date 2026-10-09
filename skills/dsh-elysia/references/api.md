# dsh-elysia API reference

## Imports

- `defineWebServer`, `HostApp`, `HostService`, `HostServiceInstance`: `dsh-elysia`
- Native `Context`, `Static`, `t`, `Elysia`: `elysia`
- `getServerContext`, `getServerOptions`: `dsh-elysia/utils`
- GenAPI stage `original`: `dsh-elysia/genapi`

## Define and activate

```ts
import type { HostApp, HostService } from 'dsh-elysia'
import type { AnyElysia } from 'elysia'

function defineWebServer<Options = undefined>(
  setup: (app: HostApp<Options>) => void | AnyElysia,
): HostService<Options>
```

Each activation creates a fresh native Elysia app, decorated with its activation instance. Setup is synchronous and returns nothing or the supplied app's registration chain. Runtime plugin composition supports synchronous native `app.use` only. Promise plugins, async plugin factories/callbacks, and pending async plugin loads reject activation; their routes must not be silently omitted. This restriction concerns setup registration, not async request handlers. GenAPI does not support `app.use` composition. Do not call `listen`; the library uses the Node adapter and registers on the host.

```ts
const dispose = server(ctx, options)
dispose() // idempotent
```

The options argument is optional when Options is undefined. The host must provide `ctx.webServer.register`. Declare `inject = ['webServer']` and activate with `ctx.effect(() => server(ctx, options), 'label')`.

A failed activation rolls back only its own route registrations. Successful activation updates `server.__host_instance`. Disposing an older activation leaves the newer one intact; disposing the current one does not restore an earlier instance.

## Native Elysia handlers and schemas

```ts
app.post('/api/users/:id', context => ({
  id: context.params.id,
  message: context.body.message,
  limit: context.query.limit ?? 10,
}), {
  query: t.Object({ limit: t.Optional(t.Number()) }),
  body: t.Object({ message: t.String() }),
})
```

Use ordinary functions, JSON object returns, Elysia route options, hooks, and chainable methods. Read request method through `context.request.method`, path through `context.path`, and native inputs through query/body/params. Schemas validate input at runtime; context type annotations alone do not.

Separate handlers can annotate native Elysia `Context<{ query: Static<typeof querySchema>, body: Static<typeof bodySchema> }>` and attach those same schemas at registration. Helper-only handlers can declare the structural `__host_instance` field, avoiding a custom context wrapper.

## Host matching and ownership

| Native path | Inferred host registration |
| --- | --- |
| `/api/version` | exact `/api/version` |
| `/api/users/:id` | prefix `/api/users` |
| `/api/inspect/*` | prefix `/api/inspect` |

Elysia matches the actual route after host dispatch. Paths must be canonical absolute pathnames, without query, fragment, or backslash. Dynamic routes need a static prefix: root `/:id` and `/*` are rejected. Host prefix matching respects segment boundaries.

Methods and paths stay within their host route group. A disallowed method returns 405 with `allow`; HEAD can fall back to GET. Multiple native routes with the same inferred key in an activation share one host group. An already-owned host `(kind, path)` fails registration, triggering rollback.

## Context/options helpers

```ts
import { getServerContext, getServerOptions } from 'dsh-elysia/utils'

getServerContext(server)
getServerOptions(server) // inferred Options
getServerContext(context)
getServerOptions<Options>(context)
```

Helpers accept the callable HostService or a native context with `__host_instance: HostServiceInstance<Options>`. Pass the native context directly, not a nested event field. From separate handlers, import HostServiceInstance from `dsh-elysia` for that structural input type.

Helpers throw TypeError for an inactive service or an unrelated context. Each activation captures its own Cordis Context/options, so later activations do not overwrite earlier handlers.

## Security

Do not remove trust-boundary schemas, authentication, authorization, or body limits. Elysia schema validation is not a replacement for authentication or request-size protection. Do not start a separate server for plugins or tests of existing host integration.
