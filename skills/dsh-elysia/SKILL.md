---
name: dsh-elysia
description: Build host-only HTTP route services for DeepSeek Harness plugins with native Elysia on Node.js and Cordis-managed registration/disposal. Use whenever creating or editing a DSH plugin with defineWebServer, native context.query/body/params handlers and t.Object route schemas, activation Context/options helpers, or typed client generation through dsh-elysia/genapi.
license: MIT
compatibility: Requires Node.js and pnpm, Elysia 1.4.30 and @elysiajs/node 1.4.5. The host must provide the webServer service. Bun is not required.
metadata:
  author: omdsh-dev
  version: "0.0.0"
---

# dsh-elysia

Register native Elysia routes on the existing `ctx.webServer`. Do not call `listen`, bind another port, start another server, or claim fallback. Cordis owns activation and disposal.

## Workflow

1. Read the plugin entry, route entry, handlers, GenAPI configuration, and AGENTS rules before changing contracts.
2. Define observable completion: native validated routes, connected JSON inputs/outputs, regenerated client, and passing relevant checks.
3. Reuse `defineWebServer`, native Elysia handlers/schemas, and the existing GenAPI pipeline. Do not invent request/response wrappers.
4. Activate through `ctx.effect` with `inject = ['webServer']`.
5. Regenerate clients, verify types/build and a focused regression check, then inspect the final diff. Report only checks actually run.

## Define and activate routes

```ts
// src/host/server/index.ts
import { defineWebServer } from 'dsh-elysia'
import { getServerContext, getServerOptions } from 'dsh-elysia/utils'
import { t } from 'elysia'

export interface ServerOptions {
  startedAt: number
}

export const server = defineWebServer<ServerOptions>((app) => {
  app.get('/api/health', (context) => {
    const ctx = getServerContext(context)
    const { startedAt } = getServerOptions<ServerOptions>(context)
    return { port: ctx.webServer.port, uptimeMs: Date.now() - startedAt }
  })
  app.post('/api/echo/:channel', context => ({
    channel: context.params.channel,
    message: context.body.message,
    limit: context.query.limit ?? 10,
  }), {
    query: t.Object({ limit: t.Optional(t.Number()) }),
    body: t.Object({ message: t.String() }),
  })
})
```

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { server } from './host/server'

export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => server(ctx, { startedAt: Date.now() }), 'elysia:routes')
}
```

Setup must be synchronous, returning nothing or the supplied app's native registration chain. Use native `app.get/post/...`, `app.route(method, path, handler, schema)`, hooks, and chaining. Runtime `app.use` composition must also be synchronous: Promise plugins, async plugin factories/callbacks, and pending async plugin loads reject activation. Async request handlers remain allowed; they are not async setup plugins. GenAPI does not support `app.use` composition. Return plain JSON objects for generated JSON clients.

## Request contracts and separate handlers

Read `context.query`, `context.body`, `context.params`, `context.request.method`, and `context.path`. Attach native `t.Object` query/body schemas to each route: types and runtime validation must describe the same contract. Casts or a typed context alone are not validation.

```ts
// routes/echo.ts
import type { Context, Static } from 'elysia'
import { t } from 'elysia'

export const echoBody = t.Object({ message: t.String() })

export function echo(context: Context<{ body: Static<typeof echoBody> }>) {
  return { message: context.body.message }
}
```

```ts
// route entry
app.post('/api/echo', echo, { body: echoBody })
```

Pass native context directly to helpers from `dsh-elysia/utils`. The host decoration is `context.__host_instance`, not a nested event field. A separate helper-using handler can take `{ __host_instance: HostServiceInstance<Options> }`, importing the type from `dsh-elysia`.

Outside handlers, `getServerContext(server)` and `getServerOptions(server)` work only while active; options are inferred from the service. Each activation captures independent data. Inactive services and unrelated contexts throw TypeError.

## Host ownership

| Native path | Host match |
| --- | --- |
| `/api/version` | exact `/api/version` |
| `/api/users/:id` | prefix `/api/users` |
| `/api/inspect/*` | prefix `/api/inspect` |

Elysia performs the actual parameter/wildcard match. Dynamic routes require a static prefix; root `/:id` or `/*` are unsupported. Prefixes respect path segments. Each host group owns its methods and paths: disallowed methods return 405 with `allow`; HEAD can fall back to GET. Duplicate host keys fail. Registration failure rolls back only the current activation; disposers are idempotent.

Use authentication/authorization hooks and body limits for sensitive endpoints. Schema validation alone is not authentication or a size limit.

## Generate the client API

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

Declare `defineWebServer` directly at module scope. Keep registrations statically resolvable: direct methods, string paths, ordinary functions returning concrete JSON. Use query/body route schemas. Generation executes no host code and starts no server.

Install the matching version with `pnpm add dsh-elysia elysia@1.4.30`. Keep the plugin's Elysia version aligned with the library, rather than pulling an unverified future version.

Generation has precise limits: terminal `/*` below a non-root fully static prefix generates only its fixed base endpoint with the trailing slash preserved (`/api/inspect/*` → `/api/inspect/`, not `/api/inspect`), never arbitrary child-path clients. GenAPI supports response-free (void) `onRequest` hooks only and does not generate independent hook responses. Unanalysed route-local contract-changing hooks (`beforeHandle`, `afterHandle`, `mapResponse`, `onError`, `transform`, `resolve`) are conservatively rejected; other unsupported setup hooks cannot be assumed to generate. This does not restrict native runtime hooks. Ordinary static `/x/` normalizes to `/x`, unlike the slash-preserving wildcard base. Responses are aggregated under HTTP 200, not a full status-code map. Return objects that Elysia natively serializes as JSON: plain strings are text/plain, so the JSON preset rejects strings and return unions containing strings. Manually serialized Response JSON contracts are not inferred. GenAPI supports default JSON body parsing with no `parse` option; every explicit `parse` option, even `parse: 'json'`, is conservatively rejected rather than inferring custom-parsed wire inputs. Native runtime parsing hooks remain available. `t.Transform`, including nested transforms, is rejected because wire and decoded types need separate modeling. Read the [GenAPI rules](<references/genapi.md>) before relying on those features.

Run `pnpm exec genapi`; track generated files, do not hand-edit them. Trace the whole flow: route input → schema validation → handler JSON → generated types → client request → real host response. Keep URL/method/required params aligned.

## Verify

```sh
pnpm lint
pnpm knip
pnpm test
pnpm typecheck
pnpm build
pnpm coverage
```

In this repository also run `pnpm --dir playground genapi`, `pnpm --dir playground typecheck`, and `pnpm --dir playground build`. Do not start a replacement server. Say explicitly if real-host checks were not run.

## References

- [API reference](<references/api.md>): activation, native context, ownership, helpers.
- [GenAPI rules](<references/genapi.md>): pipeline, static schema contracts, naming, limitations.
