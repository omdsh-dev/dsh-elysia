# DSH 原生 Elysia 插件示例

本示例使用 [dsh-elysia](<../README.md>) 构建纯宿主插件。路由运行在现有 Node.js 宿主 WebServer 上，不需要 Bun、不另起服务器或占用端口。

## 项目结构

```text
genapi.config.ts           # dsh-elysia/genapi 静态生成配置
cordis.patch.yml           # Cordis loader patch
src/index.ts              # inject/apply 与 effect 生命周期
src/host/server/index.ts  # 原生路由与 query/body schemas
src/host/server/routes/
  health.ts               # getServerOptions 与 uptime
  server.ts               # getServerContext 与宿主端口
  inspect.ts              # native request/path/query
  echo.ts                 # native params/query/body、JSON return
src/client/apis/
  index.ts                # 生成请求函数；不可手工修改
  index.type.ts           # 生成类型；不可手工修改
```

业务处理器是普通函数。query/body 使用 Elysia `t.Object` schemas，在注册时进行真实验证；独立处理器用 `Context` 与 `Static<typeof schema>` 表达同一合同。helper 接受原生 context 的 `__host_instance` 装饰。

## 构建与生成

从仓库根目录执行：

```sh
pnpm install
pnpm build
pnpm --dir playground genapi
pnpm --dir playground typecheck
pnpm --dir playground build
```

插件产物为 `playground/dist/index.mjs`，只打包宿主代码。GenAPI 通过 `dsh-elysia/genapi` 分析服务入口，不执行处理器、不加载插件、不启动 DSH。生成文件纳入版本控制，schema 变更后重新生成，不能手工修补输出。

## 客户端调用

```ts
import { getApiEchoChannel, getApiHealth, getApiInspect, getApiServer, postApiEchoChannel } from './apis'

const health = await getApiHealth()
const host = await getApiServer()
const request = await getApiInspect({ query: '1' })
const echo = await getApiEchoChannel({ channel: 'demo' }, { pretty: true, limit: 2 })
const written = await postApiEchoChannel(
  { channel: 'demo' },
  { message: 'hello', tags: ['example'], metadata: { source: 'client' } },
  { limit: 2 },
)

console.log(health.uptimeMs, host.port, request.query, echo.channel, written.body.message)
```

生成的 fetch 客户端使用相对 URL，适合已有同源客户端；末尾参数是原生 `RequestInit`，不支持 `baseURL`。独立 Node 客户端需要现有 fetch 适配层将相对路径解析到宿主地址，参见仓库端到端测试。完整链路为 route schema 验证 → native context.query/body → JSON object 返回 → GenAPI 类型 → 生成客户端 → 宿主 JSON 响应。

`/api/inspect` 是 exact 路径；`/api/echo/:channel` 演示 native params 和必填客户端路径参数，不枚举任意通配符子路径。

## 加载到现有宿主

`inject = ['webServer']` 确保宿主服务准备就绪才激活；Cordis effect 在禁用/卸载插件时自动移除全部路由。

若宿主已运行，按现有 loader 流程加载 [patch](<cordis.patch.yml>)，不要启动第二份 server。首次启动宿主可在 playground 目录执行 `pnpm dev:dsh`（需要 dsh CLI）。这不是插件独立服务器。

## 请求检查

仅在现有宿主已加载插件后执行，端口按实际宿主修改：

```sh
curl http://127.0.0.1:3080/api/health
# {"status":"ok","uptimeMs":...}

curl http://127.0.0.1:3080/api/server
# {"port":3080}

curl 'http://127.0.0.1:3080/api/inspect?query=1'
# {"method":"GET","path":"/api/inspect","query":{"query":"1"}}

curl 'http://127.0.0.1:3080/api/echo/demo?pretty=true&limit=2'
# native schema 解码后的 pretty: true、limit: 2

curl -X POST 'http://127.0.0.1:3080/api/echo/demo?limit=2' \
  -H 'content-type: application/json' \
  -d '{"message":"hello","tags":["example"]}'
# JSON body 原样出现在响应 body 中

curl -X POST http://127.0.0.1:3080/api/health
# 405，带 allow 响应头
```

加载前确认 `/api/*` 未被占用；若冲突，调整服务入口路径并重新生成 API。示例是诊断接口；生产敏感功能必须补齐鉴权 hooks 与请求体大小限制。schema 验证不替代鉴权。

## English summary

This host-only plugin uses native Elysia context, `t.Object` query/body route schemas, JSON object returns, and activation helpers. Build the package, generate the client through `dsh-elysia/genapi`, then typecheck/build playground. Load it into the existing Node.js host with the Cordis patch; never start another server. Generated clients cover exact paths and required `:channel` parameters. Regenerate rather than hand-editing output. The curl commands are instructions, not claims of verified host responses.
