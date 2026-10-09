# dsh-elysia

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![coverage][coverage-src]][coverage-href]
[![License][license-src]][license-href]

✨ **dsh-elysia** 为 DeepSeek Harness 插件 host 集成 [Elysia](<https://elysiajs.com/>)——注重开发体验与类型安全的 Web 框架，以 schema 驱动请求验证和类型推导，通过 Cordis 管理注册与卸载。使用现有 Node.js 宿主，不需要 Bun，不启动额外服务器。

[English](<README.en.md>)

## 📦 安装

```sh
pnpm add dsh-elysia elysia@1.4.30
```

使用 Elysia **1.4.30** 与 `@elysiajs/node` **1.4.5**。插件激活前，宿主必须提供 `webServer`；Node 适配由本库处理，插件不要调用 `listen`。

<details>
<summary>Are you an AI?</summary>

Run `npx skills add omdsh-dev/dsh-elysia --skill dsh-elysia -y` to install the skill. Ask which agents to support and use `--agent` to avoid installing unnecessary agent directories.

</details>

## 特性

- **原生 Elysia**：原生 context、路由处理器、参数、生命周期 hooks、`t.Object` 验证与链式注册。
- **宿主路由**：从字符串路径推导 exact/prefix 匹配，由 Elysia 完成实际路由与验证。
- **上下文与选项**：在处理器中或服务外读取本次激活的 Cordis Context 和配置。
- **生命周期清理**：通过 Cordis effect 卸载路由，注册失败时仅回滚本次激活。
- **复用宿主服务**：使用 `ctx.webServer`，不占用额外端口或 fallback。
- **客户端 API**：通过 `dsh-elysia/genapi` 静态生成请求函数和类型，不执行宿主代码。

## 🚀 快速开始

### 1. 定义与激活路由服务

业务处理器是普通函数，返回 JSON 对象：

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

`server(ctx)` 返回可重复调用的卸载函数。`ctx.effect` 在插件卸载时自动移除路由；注册失败仅回滚本次激活，不影响已有路由。

### 2. 读取上下文与配置选项

通过 `server(ctx, options)` 注入配置或运行时依赖：

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
  getServerContext(server) // 已传入的 Context
  getServerOptions(server) // 自动推断为 Options；仅在激活期间有效
}
```

每次激活独立捕获 Context 与选项。处理器的原生 Elysia context 包含本次激活的 `__host_instance` 装饰；直接把 context 传给 helper，不使用嵌套事件上下文。独立处理器可用 `{ __host_instance: HostServiceInstance<Options> }` 标注 helper 所需的结构，参见 [health 示例](<playground/src/host/server/routes/health.ts>)。

### 3. 原生请求验证

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

读取 `context.query`、`context.body`、`context.params`、`context.request.method` 和 `context.path`。让 Elysia route schema 负责验证与类型推导，不用类型断言代替运行时验证。

## 🛠️ 生成客户端 API

`dsh-elysia/genapi` 提供 GenAPI 的 `original` 构建阶段。静态分析服务入口、原生 Elysia handlers 与 query/body route schema，**不加载插件、不执行宿主代码、不启动服务器**。

### 1. 安装开发依赖

```sh
pnpm add -D @genapi/core @genapi/pipeline @genapi/presets
```

### 2. 配置

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

### 3. 生成、调用与校验

```sh
pnpm exec genapi
```

```ts
import { postApiEcho } from './apis'

const result = await postApiEcho({ message: 'hello' })
console.log(result.message)
```

生成的 fetch 客户端使用相对 URL，适合同源客户端；末尾参数是原生 `RequestInit`，没有 `baseURL` 选项。独立 Node 客户端应通过现有 fetch 适配层将相对路径解析到宿主地址。将生成文件纳入版本控制，不手工修改。路由或 schema 变更后重新生成，再运行类型检查、生成一致性测试与构建。[完整 playground](<playground/README.md>) 包含 query、JSON body、路径参数、helper、[GenAPI 配置](<playground/genapi.config.ts>)与[生成客户端](<playground/src/client/apis/index.ts>)，形成服务定义 → 类型生成 → 请求 → JSON 响应的端到端流程。

### 规则与限制

- `input` 必须在模块顶层直接声明 `defineWebServer`；setup 同步执行。
- 使用静态字符串路径与直接 `app.get/post/...` 或 `app.route('POST', ...)` 调用，支持链式注册。
- 静态前缀下的简单 `:parameter` 路由生成必填路径参数。唯一通配符例外是非根、完全静态前缀后的末尾 `/*`：`/api/inspect/*` 仅生成保留末尾斜线的固定 `/api/inspect/` 请求（Elysia 的无斜线 `/api/inspect` 不匹配该通配符），不生成任意子路径客户端；根级、带参数前缀或其他通配符形式不支持。
- GenAPI 支持不返回响应（void）的 `onRequest`；不生成 hook 的独立响应契约。未分析的 route-local 契约修改 hooks（`beforeHandle`、`afterHandle`、`mapResponse`、`onError`、`transform`、`resolve`）会保守拒绝，避免 JSON 客户端契约与实际响应断链；其他未支持的 setup hooks 也不能依赖静态生成。这不是运行时原生 Elysia hooks 的限制。
- 普通静态路径的末尾斜线按宿主 canonical 路径归一化：`/x/` 生成 `/x`；上述通配符 base 例外保留 `/api/inspect/` 的斜线。
- 响应取 route response schema 或 handler 的 awaited 返回类型，聚合为一个 HTTP 200 契约；不构建完整状态码映射，也不枚举验证/鉴权错误响应。
- `t.Transform` schemas 当前拒绝生成（包括嵌套 transform），因为网络 wire 类型与处理器解码类型可能不同；需要分别建模两者后才能支持。
- GenAPI 仅支持不配置 `parse` 的默认 JSON body 解析；当前保守拒绝所有显式 `parse` 选项（即使是 `parse: 'json'`），不推导自定义解析后的 wire 输入契约。这不限制运行时的原生 Elysia parsing hooks。
- 采用原生 `t.Object` query/body schemas，并返回由 Elysia 原生序列化为 JSON 的对象；独立函数可用 Elysia `Context` 与 `Static<typeof schema>` 类型。普通字符串返回是 text/plain，不是 JSON，因此 GenAPI 的 JSON preset 拒绝字符串及包含字符串的返回联合类型；当前也不推导手工序列化 `Response` 的 JSON 契约。
- 函数与类型名由路径和方法组成，例如 `/api/health` → `getApiHealth`、`GetApiHealthResponse`；可通过 `patch.operations` 自定义函数名。
- 不将运行时支持等同于静态生成支持：动态条件、循环、子应用、复杂路径和非 JSON 契约不应依赖自动生成。复杂应用请先运行生成器确认支持范围；不支持的语法会报告源码位置。

## 💡 示例项目

```sh
# 仓库根目录：安装、构建主包
pnpm install
pnpm build

# 生成并构建 playground
pnpm --dir playground genapi
pnpm --dir playground typecheck
pnpm --dir playground build
```

示例通过 Cordis loader patch 加载到真实宿主。若宿主已在运行，不要另起服务器；按现有宿主的插件加载流程应用 [patch](<playground/cordis.patch.yml>)。首次启动可在 playground 目录使用 `pnpm dev:dsh`（需要已安装 dsh CLI）。

## 📚 API 参考

### `defineWebServer<Options>(setup)`

```ts
import type { HostApp, HostService } from 'dsh-elysia'
import type { AnyElysia } from 'elysia'

function defineWebServer<Options = undefined>(
  setup: (app: HostApp<Options>) => void | AnyElysia,
): HostService<Options>
```

每次激活创建新 Elysia 实例。setup 必须同步执行，返回 undefined 或提供的 app 的注册链。直接使用原生路由、handlers、hooks 与 `t.Object` schemas，不要调用 `listen`。运行时组合仅支持同步的原生 `app.use` 插件；Promise 插件、async 插件工厂/回调以及尚未完成的异步插件加载不支持并会拒绝激活，不能静默丢失其路由。异步请求处理器不受此 setup 注册限制影响。GenAPI 仍不支持 `app.use` 插件组合。

### `getServerContext(server | context)` / `getServerOptions<Options>(server | context)`

从 `dsh-elysia/utils` 导入。读取服务或原生 Elysia context 的本次激活信息；从 server 读取选项可自动推导类型。服务未激活或 context 不属于本库时抛出 TypeError。

`server.__host_instance` 指向最近一次成功激活。卸载旧实例不会清除新实例；卸载当前实例后不回退到更早实例。各次激活的处理器始终保留自己的 Context/选项。

### `original(configRead)`

从 `dsh-elysia/genapi` 导入，放在 GenAPI pipeline 的 config 之后、parser 之前，填充路由与类型元数据。必须配置 `output.type`。

### 字符串路径与宿主匹配

| Elysia 路径 | 宿主匹配 |
| --- | --- |
| `/api/version` | exact `/api/version` |
| `/api/users/:id` | prefix `/api/users`；参数由 Elysia 解析 |
| `/api/inspect/*` | prefix `/api/inspect`；通配符由 Elysia 解析 |

动态路由必须有静态前缀；不支持根级 `/:id`、`/*`。prefix 按路径片段匹配，不会将 `/api/inspection` 交给 `/api/inspect`。每个宿主路由组独立约束方法和路径所有权；未允许的方法返回带 `allow` 头的 405，HEAD 可回退至 GET。重复注册宿主已占用的 `(kind, path)` 会失败，并仅回滚本次激活。

> 🔐 身份认证、鉴权与请求体大小限制由插件保障。敏感路由应配置适当的 Elysia hooks 和验证；schema 不替代鉴权或大小限制。

## 🛠️ 开发与贡献

```sh
pnpm install
pnpm lint
pnpm knip
pnpm test
pnpm typecheck
pnpm build
pnpm coverage
```

覆盖率阈值由配置强制执行。参见 [贡献指南](<CONTRIBUTING.md>)。

## 📜️ 许可证

MIT，保留原 [许可证](<LICENSE.md>)。

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
