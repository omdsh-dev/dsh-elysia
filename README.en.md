# dsh-elysia

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![coverage][coverage-src]][coverage-href]
[![License][license-src]][license-href]

✨ **dsh-elysia** integrates [Elysia](<https://elysiajs.com/>) into the DeepSeek Harness plugin host. Elysia is an ergonomic, type-safe Web framework with schema-driven request validation and type inference. Cordis manages registration and disposal. It runs on the existing Node.js host: no Bun and no additional server.

[中文](<README.md>)

## 📦 Install

```sh
pnpm add dsh-elysia elysia@1.4.30
```

Uses Elysia **1.4.30** and `@elysiajs/node` **1.4.5**. The host must provide `webServer` before activation. This library handles the Node adapter; plugins must not call `listen`.

<details>
<summary>Are you an AI?</summary>

Run `npx skills add omdsh-dev/dsh-elysia --skill dsh-elysia -y` to install the skill. Ask which agents to support and use `--agent` to avoid installing unnecessary agent directories.

</details>

## Features

- **Native Elysia**: native context, handlers, parameters, lifecycle hooks, `t.Object` validation, and chaining.
- **Host routing**: string paths infer host exact/prefix matching; Elysia handles actual routing and validation.
- **Context and options**: read the activation's Cordis Context and configuration from handlers or the service.
- **Lifecycle cleanup**: dispose routes through Cordis effects and roll back only this activation on registration failure.
- **Reuse the host**: uses `ctx.webServer`, with no additional port or fallback slot.
- **Client API**: statically generate request functions and types through `dsh-elysia/genapi`, without executing host code.

## 🚀 Quick start

### 1. Define and activate a route service

Business handlers are ordinary functions returning JSON objects:

```ts
// src/host/server/routes/health.ts
export function health() {
  return { status: 'ok' }
}
```

```ts
// src/host/server/index.ts
import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'
import { health } from './routes/health'

export const server = defineWebServer((app) => {
  app.get('/api/health', health)
  app.get('/api/users/:id', context => ({ id: context.params.id }))
  app.post('/api/echo', context => ({ message: context.body.message }), {
    body: t.Object({ message: t.String() }),
  })
})
```

```ts
// src/host/apply.ts
import type { Context } from '@deepseek-ai/cordis'
import { server } from './server'

export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => server(ctx), 'elysia:routes')
}
```

`server(ctx)` returns an idempotent disposer. With `ctx.effect`, routes are removed when the plugin unloads. Registration failure rolls back only the current activation, preserving existing routes.

### 2. Read the context and options

Pass configuration or runtime dependencies through `server(ctx, options)`:

```ts
// src/host/server/index.ts
import { defineWebServer } from 'dsh-elysia'
import { getServerContext, getServerOptions } from 'dsh-elysia/utils'

export interface Options {
  startedAt: number
}

export const server = defineWebServer<Options>((app) => {
  app.get('/api/status', (context) => {
    const ctx = getServerContext(context)
    const options = getServerOptions<Options>(context)
    return { port: ctx.webServer.port, uptimeMs: Date.now() - options.startedAt }
  })
})
```

```ts
// src/host/apply.ts
import type { Context } from '@deepseek-ai/cordis'
import { getServerContext, getServerOptions } from 'dsh-elysia/utils'
import { server } from './server'

export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => server(ctx, { startedAt: Date.now() }), 'status:routes')
  getServerContext(server) // the Context passed in
  getServerOptions(server) // inferred as Options; valid only while active
}
```

Each activation captures its own Context and options. Native Elysia context carries the activation's `__host_instance` decoration. Pass context directly to the helpers, not a nested event context. Separate handlers can declare `{ __host_instance: HostServiceInstance<Options> }` for the helper input, as shown in the [health handler](<playground/src/host/server/routes/health.ts>).

### 3. Native request validation

```ts
import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer((app) => {
  app.post('/api/messages', context => ({
    message: context.body.message,
    limit: context.query.limit ?? 10,
  }), {
    query: t.Object({ limit: t.Optional(t.Number()) }),
    body: t.Object({ message: t.String() }),
  })
})
```

Read `context.query`, `context.body`, `context.params`, `context.request.method`, and `context.path`. Use Elysia route schemas for validation and inference; type assertions are not runtime validation.

## 🛠️ Generate the client API

`dsh-elysia/genapi` provides GenAPI's `original` stage. It statically analyses the service entry, native handlers, and query/body route schemas, **without loading plugins, executing host code, or starting a server**.

### 1. Install dev dependencies

```sh
pnpm add -D @genapi/core @genapi/pipeline @genapi/presets
```

### 2. Configure the pipeline

```ts
// genapi.config.ts
import { defineConfig } from '@genapi/core'
import pipeline from '@genapi/pipeline'
import { fetch } from '@genapi/presets'
import { original } from 'dsh-elysia/genapi'

export default defineConfig({
  preset: pipeline(
    fetch.ts.config,
    original,
    fetch.ts.parser,
    fetch.ts.compiler,
    fetch.ts.generate,
    fetch.ts.dest,
  ),
  input: './src/host/server/index.ts',
  output: {
    main: 'src/client/apis/index.ts',
    type: 'src/client/apis/index.type.ts',
  },
})
```

### 3. Generate, call, and verify

```sh
pnpm exec genapi
```

```ts
import { postApiEcho } from './apis'

const result = await postApiEcho({ message: 'hello' })
console.log(result.message)
```

The generated fetch client uses relative URLs for same-origin clients. Its final option is native `RequestInit`, with no `baseURL` option. Independent Node clients need an existing fetch adapter that resolves relative paths against the host address. Track generated files in version control; do not edit them manually. Regenerate after route/schema changes, then run type checking, generation consistency tests, and builds. The [complete playground](<playground/README.md>) includes query, JSON body, path parameters, helpers, [configuration](<playground/genapi.config.ts>), and the [generated client](<playground/src/client/apis/index.ts>): service definition → generated types → request → JSON response.

### Rules and limitations

- `input` must declare `defineWebServer` directly at module scope; setup is synchronous.
- Use static string paths and direct `app.get/post/...` or `app.route('POST', ...)` calls. Chaining is supported.
- Simple `:parameter` routes below a static prefix generate required path parameters. The only wildcard exception is a terminal `/*` below a non-root, fully static prefix: `/api/inspect/*` generates only the fixed `/api/inspect/` request, preserving the trailing slash (Elysia does not match the slashless `/api/inspect` against that wildcard), not arbitrary child-path clients. Root, parameterized-prefix, and other wildcard forms are unsupported.
- GenAPI supports `onRequest` hooks that return no response (void), without generating independent hook response contracts. Unanalysed route-local contract-changing hooks (`beforeHandle`, `afterHandle`, `mapResponse`, `onError`, `transform`, `resolve`) are conservatively rejected to avoid disconnecting the JSON client contract from the actual response. Do not depend on generation for other unsupported setup hooks. Native Elysia hooks remain supported at runtime.
- Ordinary static trailing slashes normalize to the host's canonical path: `/x/` generates `/x`. The wildcard base exception above retains the slash in `/api/inspect/`.
- The route response schema or handler's awaited return type is aggregated into one HTTP 200 contract, not a complete status-code map. Validation/authorization error responses are not enumerated.
- Generation currently rejects `t.Transform` schemas, including nested transforms, because wire input types can differ from decoded handler types. Supporting them requires separately modeling both contracts.
- GenAPI supports default JSON body parsing with no `parse` option. It conservatively rejects every explicit `parse` option, including `parse: 'json'`, rather than inferring wire contracts after custom parsing. This is not a restriction on native Elysia parsing hooks at runtime.
- Use native `t.Object` query/body schemas and objects that Elysia natively serializes as JSON. Separate handlers can use Elysia `Context` and `Static<typeof schema>` types. Plain string returns are text/plain, not JSON, so GenAPI's JSON preset rejects strings and return unions containing strings. JSON contracts for manually serialized `Response` objects are not currently inferred.
- Names derive from path and method: `/api/health` → `getApiHealth`, `GetApiHealthResponse`. Customize function names with `patch.operations`.
- Runtime support does not imply static generation support. Do not depend on generation for conditional/looped registration, sub-apps, complex paths, or non-JSON contracts. Run the generator to confirm support for complex applications; unsupported syntax reports its source location.

## 💡 Example project

```sh
# Repository root: install and build the package
pnpm install
pnpm build

# Generate and build the playground
pnpm --dir playground genapi
pnpm --dir playground typecheck
pnpm --dir playground build
```

Load the example into the real host through its Cordis loader [patch](<playground/cordis.patch.yml>). If the host is already running, do not start another server; use the existing host's plugin-loading procedure. For an initial host launch, run `pnpm dev:dsh` from playground (requires the dsh CLI).

## 📚 API reference

### `defineWebServer<Options>(setup)`

```ts
import type { HostApp, HostService } from 'dsh-elysia'
import type { AnyElysia } from 'elysia'

function defineWebServer<Options = undefined>(
  setup: (app: HostApp<Options>) => void | AnyElysia,
): HostService<Options>
```

Each activation creates a fresh Elysia instance. Setup must run synchronously and return undefined or the supplied app's registration chain. Use native routes, handlers, hooks, and `t.Object` schemas. Do not call `listen`. Runtime composition supports only synchronous native `app.use` plugins. Promise plugins, async plugin factories/callbacks, and pending async plugin loads are unsupported and reject activation rather than silently losing their routes. Async request handlers are not affected by this setup-registration restriction. GenAPI still does not support `app.use` plugin composition.

### `getServerContext(server | context)` / `getServerOptions<Options>(server | context)`

Imported from `dsh-elysia/utils`. Read activation data from the service or native Elysia context. Options read from the service are inferred automatically. Both throw TypeError when the service is inactive or the context does not belong to this library.

`server.__host_instance` points to the latest successful activation. Disposing an older instance does not clear a newer one; disposing the current one does not fall back to an earlier instance. Every activation's handlers retain their own Context/options.

### `original(configRead)`

Imported from `dsh-elysia/genapi`. Place it after config and before parser in the pipeline to fill route/type metadata. `output.type` is required.

### String paths and host matching

| Elysia path | Host matching |
| --- | --- |
| `/api/version` | exact `/api/version` |
| `/api/users/:id` | prefix `/api/users`; Elysia resolves parameters |
| `/api/inspect/*` | prefix `/api/inspect`; Elysia resolves the wildcard |

Dynamic routes need a static prefix; root `/:id` and `/*` are unsupported. Prefixes respect segment boundaries, so `/api/inspection` does not enter `/api/inspect`. Each host group owns its methods and paths. Unallowed methods return 405 with an `allow` header; HEAD can fall back to GET. An already-owned host `(kind, path)` causes registration failure and rollback of only the current activation.

> 🔐 Plugins are responsible for authentication, authorization, and body size limits. Configure suitable Elysia hooks and validation for sensitive endpoints; schemas do not replace authorization or size limits.

## 🛠️ Development and contributing

```sh
pnpm install
pnpm lint
pnpm knip
pnpm test
pnpm typecheck
pnpm build
pnpm coverage
```

Coverage thresholds are enforced by configuration. See the [contributing guide](<CONTRIBUTING.md>).

## 📜️ License

MIT; the original [license](<LICENSE.md>) is retained.

[npm-version-src]: https://img.shields.io/npm/v/dsh-elysia?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/dsh-elysia
[npm-downloads-src]: https://img.shields.io/npm/dm/dsh-elysia?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/dsh-elysia
[bundle-src]: https://img.shields.io/bundlephobia/minzip/dsh-elysia?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=dsh-elysia
[license-src]: https://img.shields.io/github/license/omdsh-dev/dsh-elysia.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/omdsh-dev/dsh-elysia/blob/main/LICENSE.md
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/dsh-elysia
[coverage-src]: https://codecov.io/gh/omdsh-dev/dsh-elysia/graph/badge.svg
[coverage-href]: https://codecov.io/gh/omdsh-dev/dsh-elysia
