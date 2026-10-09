# Contributing to dsh-elysia

Follow [the contribution guidelines](https://github.com/antfu/contribute) and this repository's [AGENTS.md](<AGENTS.md>). Use Conventional Commits; preserve the [MIT license](<LICENSE.md>).

## Development

```sh
pnpm install
pnpm lint
pnpm knip
pnpm test
pnpm typecheck
pnpm build
pnpm coverage
```

All gates must pass before a PR. Coverage for `src/**` must meet the thresholds in [vitest.config.ts](<vitest.config.ts>). Run these checks with Node.js, Elysia 1.4.30 and `@elysiajs/node` 1.4.5; Bun is not required.

## Native Elysia contracts

Use native Elysia context/route handlers, `context.query`, `context.body`, and `t.Object` route schemas. Use `getServerContext` / `getServerOptions` from `dsh-elysia/utils` to read activation data. Keep validation at request boundaries, method/path ownership, rollback, and Cordis disposal intact. Plugins must reuse the host's `ctx.webServer`, not start their own server or claim fallback.

For changes to routes or GenAPI, regenerate the [playground client](<playground/src/client/apis/index.ts>) rather than editing generated files:

```sh
pnpm build
pnpm --dir playground genapi
pnpm --dir playground typecheck
pnpm --dir playground build
```

Add a focused regression check for non-trivial behavior. Keep [Chinese](<README.md>) and [English](<README.en.md>) documentation, the [skill](<skills/dsh-elysia/SKILL.md>), and the [playground guide](<playground/README.md>) aligned. Report the exact checks run and any remaining uncertainty; do not claim host verification without testing the actual host.

## 中文摘要

遵守项目 AGENTS 规则与 Conventional Commits，保留 MIT 许可证。提交 PR 前必须通过上面的所有 gates 与覆盖率要求。修改路由/schema 后重新生成客户端并检查 playground。使用原生 Elysia context、query/body 与 `t.Object` 验证，不另起服务器；保持双语 README、技能与示例一致。
