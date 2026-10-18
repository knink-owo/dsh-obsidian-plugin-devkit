# DSH 插件设计指南要点（本轮实测核对）

本文件记录 2026-10-18 修复 `Invalid schema for function 'obsidian_devkit_build': schema must be a JSON Schema of 'type: "object"', got 'type: null'` 时，对 DeepSeek Harness 插件契约的核对结果。适用于本仓库这类 **host-only bundle 插件**。

## 1. 插件形态

| 形态 | 入口 | 能力 |
| --- | --- | --- |
| host bundle（本仓库） | `package.json` → `main`/`types` + `dsh.bundle.patch` | 注册工具、服务、命令、会话上下文 |
| client UI plugin | `exports["./client"]` + `ctx.slots`/`theme` | 往 Web GUI 的插槽挂面板、装饰、小部件 |

host 插件不需要 UI 半区；装了不需要的 `client.js` 反而多一个加载失败点。

## 2. bundle 的组成（缺一不可）

```jsonc
// package.json
{
  "name": "@scope/pkg",
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "exports": {
    ".":            { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./locale/*.json": "./locale/*.json",
    "./icon":       "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["lib", "assets", "locale/*.json", "icon.svg", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml —— 只是声明「怎么挂」，不承载任何逻辑
- insert:
    - id: obsidian-plugin-devkit
      name: '@knink-owo/dsh-obsidian-plugin-devkit'
      config:
        defaultMinAppVersion: '1.13.0'
```

- 安装入口是 `plugin_manager`（profile 级）：它会校验 `dsh.bundle.patch`、把包 link 进 profile 的 `node_modules`，再改写 profile 的 `cordis.yml`。**不要手写 profile 文件**。
- **替换已安装包 / 修改 lib 后需要重启宿主**：已激活的模块被 module cache 固定，不会热替换；安装结果里的 `nextStep` 会提示。
- `files` 必须覆盖 `cordis.patch.yml`、`assets/`、`locale/`、`icon.svg`，否则发布/安装后缺少资源。

## 3. 展示元数据

- `locale/en.json`、`locale/zh.json`：`{ "meta": { "title": "...", "description": "..." } }`，Harness GUI 的插件/工具来源页读取。
- `icon.svg`（或 PNG/JPEG/WebP，≤256 KiB）放在包内，通过 `exports["./icon"]` 暴露；不要指向包外路径。

## 4. cordis 插件导出面

```ts
export const name = "obsidian-plugin-devkit";     // 覆盖 patch 行 id
export const inject = ["tools", "fs"];            // 依赖的服务
export function apply(ctx, config) { /* ... */ }  // 入口
// 可选：
// export const Config = z.object({...});         // @deepseek-ai/schemastery，校验 config
// export const disposable = ... / ctx.effect(...) // 清理
```

- 不声明 `Config` 时 config 不校验（本仓库 M1 如此）；声明后 patch 里的 config 会先过 schema，校验失败则插件不激活。
- 声明 `Config` 时，`@deepseek-ai/schemastery` 必须作为 **peerDependency** 且 profile 里能解析到，否则 activation 失败（本仓库 M1 没有用，故已移除该 peer）。

## 5. 工具注册契约（本轮 bug 的根因）

```ts
ctx.tools.register({
  name: "obsidian_devkit_build",
  description: "...",
  parameters: {                     // ← 必须是 JSON Schema 对象根！
    type: "object",
    properties: { projectDir: { type: "string", description: "..." } },
    required: ["projectDir"],
    additionalProperties: false,
  },
  output: {
    schema: { type: "string" },     // 结果值的 JSON Schema
    render: (_args, value) => [{ type: "text", text: value }],
  },
  timeoutMs: 300_000,
  isConcurrencySafe: () => false,   // ← 函数，不是布尔值
  async execute(args, exec) { /* ... */ },
});
```

**关键点**：DSH 把 `parameters` **原样投影**为模型函数的参数 schema，不做二次包装；因此注册扁平 DSL `{ targetDir: { type: "string", required: true } }` 会让模型侧看到 `{ type: null }`，整轮请求被 API 拒绝：

```
Invalid schema for function 'obsidian_devkit_build':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

Harness 自带的 `defineTool`（`@deepseek-ai/dsh-tools`）接受扁平 DSL 并自动包装，但那只在插件依赖 harness 包、拿到真实 `defineTool` 时可用；手写 `ctx.tools.register` 必须自己包 `{ type: "object", properties, required, additionalProperties }`。

回归测试必须断言：每个注册工具的 `parameters.type === "object"`、`properties` 是对象、`isConcurrencySafe` 是函数（见 `test/plugin.test.mjs`）。

`execute(args, exec)`：
- `exec.signal`：AbortSignal；长任务可超时/取消。
- `exec.agent.session.header.cwd`：当前会话工作目录；`ctx.get("sandboxPolicy")?.resolve({ session })` 拿沙箱策略（`workspaceRoot`、`mode`）。
- 失败不要 throw 到模型之外：返回可读错误文本（或让 host 物化错误结果）。

## 6. 生命周期与副作用

- 一次性子进程（构建、CLI 调用）发完即止，**不要**在插件里常驻 watcher/后台进程；结束用 `exec.signal`/`timeoutMs` 兜底。
- 需要清理的资源用 `ctx.effect(() => cleanup)` 或 `ctx.on("dispose", ...)`。
- 文件访问优先走 `ctx.fs`（带沙箱策略），不要绕过策略直接 `node:fs`；本仓库 `Fs` 类在 `ctx.fs` 缺失时回退 Node fs，仅用于测试。

## 7. 排查路径

1. `plugin_manager` → `list_plugins`：确认 entryId/`fiberPhase`（`active` 才是真正加载）。
2. 装/改包后看安装结果的 `application`/`diagnostic`/`nextStep`；`failed` 时先修 `nextStep` 指出的原因，再重装。
3. 宿主日志：`~/.dsh/logs`；profile 的 pnpm 日志：`~/.dsh/profiles/<name>/.plugin-manager/logs/<op>/pnpm.log`。
4. 工具 schema 类错误在**下一轮模型请求**才暴露（工具已注册但没被调用也会炸）；改完必须重启宿主再验证。
5. HMR（`dsh-hmr`）只对源码开发态的部分模块生效；生产安装一律按「重装 + 重启」处理。

## 8. 本仓库对应改动（2026-10-18）

- `src/types.ts`：`ToolDefinition.parameters` 改为 `JsonSchemaNode`（对象根）；新增 `objectSchema()` 包装器与 `ParameterSpec`。
- `src/index.ts`：4 个工具全部改为 `parameters: objectSchema({...})`；`isConcurrencySafe` 改为 `() => false/true`。
- `test/plugin.test.mjs`：新增对象根/属性/并发函数断言，防止回归。
- 移除未使用的 `@deepseek-ai/schemastery` peer/dev 依赖，避免 pnpm 的 peer 警告。
- 补齐 `locale/en.json`、`locale/zh.json`、`icon.svg`、`exports`/`files` 条目。

## 归档说明（v1.0.0）

本文件描述的是 **v0.5.0 及之前的 DSH 插件形态**，该形态已于 v1.0.0 归档（代码在 `archive/plugin/`，git tag `archive-plugin-v0.5.0`）。当前交付形态是 `obsidian-devkit` CLI + `skill/obsidian-plugin-dev` 独立 skill；本文件保留作为宿主 bundle 契约与排错的历史记录，不再随 CLI 维护。文中 `obsidian_devkit_*` 工具名对应现在的 CLI 命令（例如 `obsidian_devkit_validate` → `obsidian-devkit validate <dir>`）。
