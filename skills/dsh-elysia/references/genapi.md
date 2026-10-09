# GenAPI rules

`dsh-elysia/genapi` exports `original`, a static TypeScript analysis stage. It reads source and constructs route/type metadata for the GenAPI pipeline; it never loads plugins, executes handlers, or starts a server.

## Pipeline

```ts
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

Place original after config and before parser. Input is a local service-entry file; `output.type` is required. The nearest tsconfig supplies compiler options. Type errors fail generation rather than silently producing incomplete clients.

## Static service entry

Declare `defineWebServer` directly at module scope. Setup must be statically resolvable and synchronous. Use direct `app.get/post/put/patch/delete/head/options` calls, native `app.route('POST', path, handler, schema)`, or their registration chains.

Use ordinary functions or arrow handlers, including imported handlers. Dynamic registration through conditions, loops, nested factories, or sub-app composition is not a static client contract. Runtime Elysia support is broader than GenAPI's subset.

## Native request contracts

```ts
import { defineWebServer } from 'dsh-elysia'
import { t } from 'elysia'

export const server = defineWebServer((app) => {
  app.post('/api/echo/:channel', context => ({
    channel: context.params.channel,
    pretty: context.query.pretty ?? false,
    body: context.body,
  }), {
    query: t.Object({ pretty: t.Optional(t.Boolean()) }),
    body: t.Object({ message: t.String(), tags: t.Optional(t.Array(t.String())) }),
  })
})
```

Schemas are native Elysia `t.Object` route options, not another schema format. Read native context.query/body; no parsing helper is needed. Optional schema fields produce optional client inputs, and body is an object contract with named fields. Keep schema validation present even when a separate handler has a typed Elysia Context.

Static generation supports default JSON body parsing with no `parse` option. Every explicit `parse` option is conservatively rejected, including `parse: 'json'`; wire contracts after custom parsing are not inferred. This is a GenAPI limitation, not a runtime restriction on native Elysia parsing hooks.

Generation rejects `t.Transform` schemas, including nested transforms, with `transform schemas require separate wire contracts and are not supported`. The wire JSON type and decoded handler type can differ, so treating Static alone as both contracts is unsafe. Use supported non-transform schemas until both sides are modeled explicitly.

For separate handlers, export schemas and annotate inputs with `Context` plus `Static<typeof schema>`. Register those exact schemas in the entry. Avoid any/unknown inputs: generated contracts must be concrete. Validate generated query/body/response output after every schema change.

## Paths and naming

Prefer static absolute paths or simple unique `:parameter` segments below a static prefix. Parameters become required client path inputs. The playground deliberately uses exact `/api/inspect` and parameterized `/api/echo/:channel`, so no generated wildcard client is needed. Do not assume every runtime wildcard/regex pattern is supported; run generation and inspect its diagnostics for complex paths.

The only wildcard exception is terminal `/*` below a non-root, fully static prefix: `/api/inspect/*` generates a fixed `/api/inspect/` request only, preserving the trailing slash because the slashless `/api/inspect` does not match Elysia's wildcard, not arbitrary wildcard descendants. Root `/*`, parameterized prefixes before `/*`, and other wildcard forms are unsupported.

Method and path determine stable names:

- `GET /api/health` → `getApiHealth`, `GetApiHealthResponse`.
- `POST /api/echo/:channel` → `postApiEchoChannel`, `PostApiEchochannelBody`, `PostApiEchochannelResponse`.
- A query field contributes a route-scoped query type, such as `PostApiEchochannelQueryPretty`.

Use `patch.operations` to customize function names. Distinct routes must not normalize to the same generated type name.

## Response contracts

Return ordinary JSON objects. Response types are inferred from the handler's awaited return type. Use concrete values that Elysia natively serializes as JSON, preferably objects. Plain strings are returned as text/plain, so the JSON preset rejects string returns and unions containing strings. Recursive types, functions, bigint, class instances, custom Response objects, and other non-JSON outputs are not generated JSON client contracts; manually serialized Response JSON is not inferred. Explicit return types can stabilize the contract, but must match actual output.

The route response schema takes precedence over the handler's awaited return type. The result is aggregated into a single HTTP 200 response contract, not a complete status-code map; response status maps are unsupported. Validation/authorization errors and hook responses are not enumerated.

GenAPI supports only response-free (void) `onRequest` hooks, without independent hook response contracts. Unanalysed route-local contract-changing hooks (`beforeHandle`, `afterHandle`, `mapResponse`, `onError`, `transform`, `resolve`) are conservatively rejected so JSON clients cannot silently disagree with transformed runtime responses. Other unsupported setup hooks also cannot be assumed to generate. This is a static-generation boundary, not a restriction on native Elysia hooks at runtime.

Ordinary static trailing slashes normalize to the canonical host path (`/x/` → `/x`). The terminal wildcard base exception retains its slash (`/api/inspect/*` → `/api/inspect/`). Inspect the generated contract and test actual runtime behavior separately.

## End-to-end verification

1. Build the library so the `dsh-elysia/genapi` package export resolves.
2. Run `pnpm --dir playground genapi` to regenerate the client.
3. Inspect generated paths, methods, required parameters, query/body types, and JSON responses.
4. Run playground typecheck/build and generation consistency tests.
5. If testing requests, use the existing host and its plugin-loading procedure. Never start a replacement server merely to demonstrate plugin routes.

Track generated files, do not edit them by hand. Report exactly which checks passed and whether actual host requests were verified. Unsupported syntax reports source locations; resolve the root contract issue instead of weakening types or bypassing generation.
