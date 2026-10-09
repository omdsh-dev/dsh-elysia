import type { ApiPipeline } from '@genapi/shared'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { original } from '../src/genapi'

function scope(): ApiPipeline.GraphSlice {
  return { functions: [], imports: [], variables: [], typings: [], interfaces: [] }
}

function read(uri: string, withTypeScope = true): ApiPipeline.ConfigRead {
  const scopes: Record<string, ApiPipeline.GraphSlice> = withTypeScope ? { type: scope() } : {}
  return {
    inputs: { uri },
    config: { input: { uri } },
    graphs: { scopes, response: {} },
    outputs: [],
  }
}

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/genapi/${name}`, import.meta.url))
}

function rejects(name: string, message: RegExp): void {
  expect(() => original(read(fixture(name)))).toThrow(message)
}

function accepts(name: string): ApiPipeline.GraphSlice {
  const configRead = read(fixture(name))
  original(configRead)
  return configRead.graphs.scopes.type
}

describe('genapi input and configuration failures', { timeout: 20000 }, () => {
  it('rejects a missing service entry uri', () => {
    expect(() => original(read(''))).toThrow(/input must be a local service entry file/)
  })

  it('rejects a tsconfig whose root value is not an object', () => {
    rejects('config-not-object/entry.ts', /must be an object/)
  })

  it('rejects a tsconfig with an invalid compiler option value', () => {
    rejects('bad-option/entry.ts', /TS6046/)
  })

  it('rejects a service entry that cannot be read, without any tsconfig above it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-elysia-genapi-'))
    expect(() => original(read(join(directory, 'entry.ts')))).toThrow(/cannot read service entry/)
  })

  it('rejects a service entry with pre-emit diagnostics', () => {
    rejects('preemit/entry.ts', /no exported member 'defineWebServer'/)
  })

  it('requires a TypeScript type output', () => {
    expect(() => original(read(fixture('routes.ts'), false))).toThrow(/a TypeScript type output is required/)
  })
})

describe('genapi handler and contract failures', { timeout: 20000 }, () => {
  it('rejects a non-const route binding', () => {
    rejects('binding-not-const.ts', /route bindings must be const/)
  })

  it('rejects a route path that is not a static string', () => {
    rejects('path-not-static.ts', /route paths and HTTP methods must be static strings/)
  })

  it('rejects a contract with a bigint response member', () => {
    rejects('contract-bigint.ts', /request and response contracts must be concrete JSON types/)
  })

  it('rejects a recursive contract', () => {
    rejects('contract-recursive.ts', /recursive contracts are not supported/)
  })

  it('rejects a function member in a contract', () => {
    rejects('contract-function.ts', /functions and class instances are not JSON contracts/)
  })

  it('rejects a dynamically created handler', () => {
    rejects('handler-node-callback.ts', /use a statically resolvable Elysia handler/)
  })

  it('rejects a handler without any call signature', () => {
    rejects('handler-not-callable.ts', /handler must be callable/)
  })

  it('rejects untyped native query access', () => {
    rejects('request-twice.ts', /query requires an object contract with named fields/)
  })

  it('rejects a native body schema over a string contract', () => {
    rejects('readbody-string.ts', /body requires an object contract with named fields/)
  })

  it('rejects a native body schema over an array contract', () => {
    rejects('readbody-array.ts', /body requires an object contract with named fields/)
  })

  it('rejects a native body schema over a tuple contract', () => {
    rejects('readbody-tuple.ts', /body requires an object contract with named fields/)
  })

  it('rejects a native body schema over an index signature contract', () => {
    rejects('readbody-index.ts', /body requires an object contract with named fields/)
  })
})

describe('genapi route failures', { timeout: 20000 }, () => {
  it('rejects a relative route path', () => {
    rejects('path-relative.ts', /route path must be an absolute pathname/)
  })

  it('rejects a protocol relative route path', () => {
    rejects('path-protocol.ts', /route path must be an absolute pathname/)
  })

  it('rejects a route path with a query delimiter', () => {
    rejects('path-delimiter.ts', /route path must be an absolute pathname/)
  })

  it('rejects a brace pattern before URL normalization', () => {
    rejects('path-braces.ts', /only static paths and simple :parameter segments/)
  })

  it.each(['path-wildcard.ts', 'path-wildcard-interior.ts', 'path-wildcard-root.ts', 'path-wildcard-param.ts', 'path-wildcard-trailing.ts'])('rejects an unsupported wildcard route: %s', (name) => {
    rejects(name, /only static paths and simple :parameter segments/)
  })

  it('rejects a duplicated path parameter name', () => {
    rejects('path-param-dup.ts', /path parameter names must be unique/)
  })

  it('rejects a malformed path parameter segment', () => {
    rejects('path-param-bad.ts', /only simple :parameter segments are supported/)
  })

  it('rejects a method wide route declaration', () => {
    rejects('method-all.ts', /declare a specific OpenAPI HTTP method/)
  })

  it('rejects a duplicated method and path declaration', () => {
    rejects('duplicate-route.ts', /duplicate GET \/api\/duplicate/)
  })
})

describe('genapi setup failures', { timeout: 20000 }, () => {
  it('rejects a setup callback without an app parameter', () => {
    rejects('setup-no-param.ts', /defineWebServer requires a static setup callback with an app parameter/)
  })

  it('rejects a setup that calls something other than app', () => {
    rejects('setup-foreign-call.ts', /setup must use direct app.method\(\.\.\.\) route declarations/)
  })

  it('rejects app.route without all three arguments', () => {
    rejects('setup-on-short.ts', /app.route requires method, path and handler/)
  })

  it('rejects a route declaration without both arguments', () => {
    rejects('setup-get-short.ts', /route declarations require path and handler/)
  })

  it('rejects a conditional route registration', () => {
    rejects('setup-conditional.ts', /conditional, looped and mounted route registration is not supported/)
  })

  it('rejects a non-const binding inside setup', () => {
    rejects('setup-let-binding.ts', /route bindings must be const/)
  })

  it('rejects an indirect app use inside a binding', () => {
    rejects('setup-indirect.ts', /setup must use direct app.method\(\.\.\.\) route declarations/)
  })

  it('rejects a service declared inside a block', () => {
    rejects('setup-nested-module.ts', /services must be declared directly at module scope/)
  })

  it('rejects an input without any defineWebServer route', () => {
    rejects('middleware-only.ts', /no static defineWebServer routes found in input/)
  })
})

describe('genapi accepted input branches', { timeout: 20000 }, () => {
  it('accepts native exact, static prefix and root paths', () => {
    const scope = accepts('branches-paths.ts')
    expect(scope.typings.map(typing => typing.name)).toEqual([
      'GetApiLiteralExactResponse',
      'GetApiLiteralPrefixResponse',
      'GetResponse',
    ])
  })

  it('accepts parenthesized, asserted handlers and native JSON objects', () => {
    const scope = accepts('branches-unwrap.ts')
    expect(scope.typings.map(typing => typing.name)).toEqual([
      'GetApiUnwrapParenthesizedResponse',
      'GetApiUnwrapAssertedResponse',
      'GetApiUnwrapSatisfiedResponse',
      'GetApiUnwrapNonNullResponse',
      'GetApiUnwrapTypeAssertionResponse',
      'GetApiUnwrapObjectFormResponse',
    ])
  })

  it('accepts every supported contract shape', () => {
    const scope = accepts('branches-types.ts')
    expect(scope.typings.map(typing => typing.name)).toEqual(['GetApiTypesResponse'])
  })

  it('accepts chained, concise and returning setups', () => {
    const scope = accepts('branches-routing.ts')
    expect(scope.typings.map(typing => typing.name)).toContain('GetApiChainBResponse')
  })

  it('accepts an object body schema and nested native context reads', () => {
    const scope = accepts('branches-readbody.ts')
    expect(scope.interfaces.map(typing => typing.name)).toEqual(['PostApiReadbodyObjectBody'])
  })

  it('accepts aliased, functional and default exported handlers', () => {
    const scope = accepts('branches-imports.ts')
    expect(scope.typings.map(typing => typing.name)).toEqual([
      'GetApiImportedNamedResponse',
      'GetApiImportedFunctionResponse',
      'GetApiImportedDefaultResponse',
    ])
  })
})
