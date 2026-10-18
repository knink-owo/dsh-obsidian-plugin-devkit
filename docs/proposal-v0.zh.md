# dsh-obsidian-plugin-devkit 方案 v0（草案）

> 状态：**待 grill 确认**。本文件是给用户评审的方案草案，不是定稿；功能范围由后续逐轮 grill 决定。
> 关联调研：见 [research.zh.md](./research.zh.md)

---

## 1. 目标与非目标

### 目标

给 DSH agent 一套**确定性的 Obsidian 社区插件开发能力**：从脚手架到发布，每个环节都有工具可调用、有验证可依赖、有纪律可遵守。让 agent 能独立完成「新建插件 → 实现 → 构建 → 冒烟 → 部署到测试库 → 校验 → 版本 → 提交发布」的全过程。

### 非目标（v0.1 明确不做）

- 不操作 vault 笔记内容（CRUD、搜索、任务管理）——那是 `obsidian` skill 与 Local REST API 的领域
- 不做 Obsidian 主题开发
- 不内置 UI 面板（Client 插件）——v0.2 再议
- 不做发布自动化（GitHub Release 创建、community.obsidian.md 提交）——M4 再议
- 不做常驻 watch 守护进程——除非 grill 决定纳入 v0.1（见 Q3）

---

## 2. 产品形态

| 项 | 建议值 | 备注 |
|---|---|---|
| 类型 | Host-only Cordis bundle（DSH 插件） | 无 Client/UI，纯工具 + skill |
| 包名 | `@knink-owo/dsh-obsidian-plugin-devkit` | 待 Q5 确认 |
| 插件 id | `obsidian-plugin-devkit` | patch 里的 id |
| 工具前缀 | `obsidian_devkit_` | 与参考实现的 `obsidian_plugin_` 区分，可共存 |
| 技能名 | `obsidian-plugin-dev` | 参考实现占用 `obsidian-plugin`，避免冲突 |
| 安装方式 | `plugin_manager install_bundle`（开发期）→ `dsh plugin --profile desktop add`（发布后） | 本机 profile 为 desktop |
| 语言 | 工具输出/文档中文优先，代码与 API 英文 | 待确认是否双语 |

### 组合根

```ts
// src/index.ts
export const name = 'obsidian-plugin-devkit'
export const inject = ['tools', 'fs']
export const Config = z.object({
  defaultMinAppVersion: z.string().default('1.13.0'), // Round 2 Q2：声明式设置代际
  defaultSettingsStyle: z.enum(['declarative', 'legacy']).default('declarative'),
  testVault: z.string().default('dev-vault'),     // workspace 相对路径
  packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun']).default('pnpm'),
  enableCli: z.boolean().default(true),           // 能力探测开关
})
export function apply(ctx, config) { ... }
```

`apply` 做四件事：

1. `ctx.tools.register(...)` 注册工具（按职责拆分模块）
2. `ctx.get('skills').register(...)` 注册 `obsidian-plugin-dev` skill（从 `assets/skills/` 读 SKILL.md）
3. `ctx.get('systemPrompt').context(...)` 注入会话上下文文档（工作流纪律、当前配置）
4. `ctx.effect(...)` 注册清理（后台进程、临时目录）

---

## 3. 工具清单（v0.1 建议）

| # | 工具 | 作用 | 层级 |
|---|---|---|---|
| 1 | `obsidian_devkit_scaffold` | 用官方 obsidian-sample-plugin 模板生成 TS + esbuild 插件骨架；内置 id/name/description 命名与提交规则校验；生成 manifest/versions/package/tsconfig/esbuild/styles/version-bump/src/main.ts/eslint.config.mts/AGENTS.md（官方自带的 agent 指令）；设置模板按目标 minAppVersion 选「声明式（1.13.0+）」或「命令式」 | — |
| 2 | `obsidian_devkit_install` | 依赖 bootstrap：检测 pnpm/npm、把 cache 指到 workspace、安装依赖、锁定关键版本（esbuild/obsidian typings）；输出工具链体检报告 | — |
| 3 | `obsidian_devkit_build` | 类型检查 + esbuild 打包成 CJS `main.js`；入口/产物自动解析（显式参数 → src/main.ts → 根 main.ts → 项目构建配置 → package.json main）；L1 静态自检（CJS 格式、external、版本一致性、产物大小） | L1 |
| 4 | `obsidian_devkit_deploy` | 把三件套写进测试 vault（默认 workspace 内 `dev-vault/`），合并 `community-plugins.json`，写 `.dsh/devkit.json` 绑定文件；分列报告 written/enabled/active | — |
| 5 | `obsidian_devkit_validate` | 以官方审核规则为准（id `^[a-z0-9-]+$` 且不含 obsidian/不以 plugin 结尾、name/description/emoji、version 严格 x.y.z、`isDesktopOnly`、`fundingUrl`、tag==version、`versions.json` 覆盖、main.js 不进 git）；跑 `eslint-plugin-obsidianmd`；输出「社区目录自动化审核会拦什么」的报告 | — |
| 6 | `obsidian_devkit_version` | 同步 package.json / manifest.json / versions.json 三处版本 | — |
| 7 | `obsidian_devkit_test` | L2 离线冒烟：在纯 Node 里用桩化 Obsidian API 加载 CJS 产物，跑 onload/onunload、注册动作、未处理异常；报告必须写明本次覆盖不到什么 | L2 |
| 8 | `obsidian_devkit_status` | 环境体检：Obsidian 版本、CLI 是否可用、已注册 vault、当前项目状态、依赖状态、测试库状态 | — |
| 9 | `obsidian_devkit_dev` | 一键开发循环：build → deploy →（CLI 可用时）reload；可选常驻 watch（待 Q3 决定） | L1+ |
| 10 | `obsidian_devkit_adopt` | （v0.2 候选）接管已有插件项目：探测布局、生成绑定文件、标记可迁移项 | — |
| 11 | `obsidian_devkit_reload` / `obsidian_devkit_inspect` | （条件启用）包装官方 CLI 的真机 reload / errors / console / dom / css / screenshot；CLI 不可用时明确报 unavailable 而不是假装成功 | L3 |

> 工具输出统一为**人类可读的文本报告**（参考实现的选择）：agent 与用户读同一份报告，减少结构化 JSON 的解析负担；只有需要程序化消费的字段才放 JSON 尾部。

---

## 4. 架构与目录

```text
dsh-obsidian-plugin-devkit/
├── package.json              # type: module, exports, dsh.bundle.patch, peerDeps(optional)
├── cordis.patch.yml          # - insert: [{ id: obsidian-plugin-devkit, name: '@knink-owo/...' }]
├── tsconfig.json
├── src/
│   ├── index.ts              # 组合根：Config / inject / apply / 注册
│   ├── fs.ts                 # 沙箱安全文件层（显式 root + policy；绝不混用相对/绝对路径）
│   ├── proc.ts               # 子进程执行（超时、输出分类、进程组清理）
│   ├── naming.ts             # 命名/提交规则单一事实源
│   ├── lookup.ts             # 入口/产物解析（读配置文本，不执行项目代码）
│   ├── scaffold.ts           # 模板渲染
│   ├── install.ts            # 依赖安装与工具链检查
│   ├── build.ts              # 构建 + L1 检查
│   ├── deploy.ts             # 部署到测试 vault
│   ├── validate.ts           # manifest/版本/eslint
│   ├── version.ts            # 版本同步
│   ├── test.ts               # L2 离线桩
│   ├── dev.ts                # dev 循环 / watch（若做）
│   ├── cli.ts                # 官方 Obsidian CLI 能力探测与命令包装（若做）
│   └── report.ts             # 报告渲染
├── assets/
│   ├── templates/            # 官方 sample 基底：esbuild.config.mjs、manifest.json、tsconfig.json、
│   │                         #   package.json、styles.css、versions.json、version-bump.mjs、.gitignore、LICENSE
│   ├── harness/              # obsidian-stub.cjs + harness.cjs + scenarios/（L2 用）
│   └── skills/obsidian-plugin-dev/
│       ├── SKILL.md
│       └── reference/        # api-patterns / lifecycle / ui-css / submission / debugging / e2e
├── doc/
│   └── context.md            # 注入模型的会话上下文（工作流、纪律、配置）
├── test/                     # node:test，按模块 p0…pn
├── docs/                     # 本仓库文档（调研、方案、开发指南）
└── README.md / README.zh.md  # 安装、使用、兼容性
```

### 关键技术决策（草案）

1. **构建与产物**：优先跑项目自身的 production build 脚本（`tsc + esbuild`）；没有脚本时退化为直接调用项目本地 `node_modules/.bin/esbuild`；再不行才报错。绝不启动 watch（一次性工具），产物形态由 L1 检查兜底。
2. **沙箱写入**：所有写操作显式给 root（session workspace），并携带 sandbox policy；测试 vault 默认 `dev-vault/`（workspace 内）。对外部 vault 的写入默认拒绝并给出「如何获得授权」的说明。
3. **CLI 能力探测**：`status` 与 `dev` 启动时检测 `obsidian` 命令是否存在、`obsidian version` 是否可用、Obsidian 版本是否 ≥ 1.12.4；不可用时 L3 工具返回 `unavailable` 并建议升级，而不是硬失败。绝不自动切换用户窗口/抢焦点。
4. **L2 桩的诚实性**：报告固定标注「桩环境 / 空 vault / 无真实几何」，并列出未覆盖项；UI 相关改动必须由用户或 L3/L4 真正看到。
5. **命名规则单一事实源**：scaffold/validate/build 全部调用同一模块，规则表随官方文档更新而更新（版本化记录来源）。
6. **长驻任务（若选做）**：预留 `dev` 工具设计——后台子进程 + 日志环形缓冲 + `status` 查询；生命周期挂到 `ctx.effect` 清理；不阻塞工具调用。若技术上不可靠，降级为「多段命令由 agent 串联」。
7. **兼容性**：peerDeps 可选（`@deepseek-ai/cordis`、`dsh-tools`、`schemastery`），运行时用 `ctx.get(...)` 软取服务；不 import DSH Client 包；Node ≥ 20（开发）/ Node ≥ 22（构建）。
8. **项目布局（二次调研新增）**：官方流程是把插件仓库直接放在 `<vault>/.obsidian/plugins/<id>/` 内就地 watch，没有「复制到 vault」步骤。devkit 默认采用「源码目录独立（如 `projects/<id>/`）+ deploy 复制到测试库」以保持 git/沙箱干净，同时允许项目选择「就地开发」模式（源码就在测试库插件目录内，dev 循环跳过复制）。两种布局都需要 manifest.id == 目标目录名 的校验。
9. **代码生成版本门控（二次调研新增）**：声明式设置需 Obsidian ≥1.13.0、view 相关 API 需 ≥1.7.2、SecretStorage 较新；scaffold 按 `minAppVersion` 选模板，validate 检查「代码用到的 API 是否超出 minAppVersion」。
10. **skill 内容来源（二次调研新增）**：以官方 `obsidian-sample-plugin/AGENTS.md` 为基底（删掉其中已 404 的 validator 链接），再补我们自己的工具使用纪律与四层验证分级；不从零写规范文本。

---

## 5. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0** | 调研 + 方案 + grill 共识 + 文档定稿 | 用户确认范围；docs/ 定稿 |
| **M1** | 仓库骨架 + scaffold/build/validate/version + naming/lookup/fs/proc + 模板 + node:test + 可安装到 desktop profile | `plugin_manager install_bundle` 成功；在 workspace 内 scaffold 出示例插件并 build 成功 |
| **M2** | deploy + dev-vault + status + install + L2 test + skill + context 注入 | 示例插件部署进 dev-vault；Obsidian 打开 dev-vault 后可见；L2 冒烟通过 |
| **M3** | 真机增强（CLI reload/inspect）或 watch 循环（视 Q3/Q4） | 按选择验收 |
| **M4** | 双语 README、LICENSE、CI、发布（npm/GitHub release，若开源） | 发布可用 |

---

## 6. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 旧版 Obsidian（<1.12.4）无 CLI | L3 真机联调缺失 | 能力探测；文件层 + 手动 reload 兜底；文档写清升级步骤。本机已升级 **1.14.4** 并启用 CLI（2026-10-18 用户确认） |
| 沙箱只能写 workspace | 无法直接部署进用户现有 vault | 测试 vault 放 workspace；外部写入显式拒绝并说明 |
| 长驻 watch 与 DSH 工具模型不匹配 | 进程泄漏/卡死 | 先做一次性循环；watch 作为独立设计项评审 |
| DSH 版本差异（peerDeps/tools API） | 安装或运行失败 | 软取服务 + peerDeps 可选 + 兼容性矩阵文档 |
| 官方模板/规则演进 | validate 规则漂移 | 规则表版本化 + 来源链接 + 更新 checklist |
| 与参考实现功能重叠、用户同时安装 | 工具名/技能名冲突 | 前缀 `obsidian_devkit_`、技能名 `obsidian-plugin-dev` |

---

## 7. grill 决策记录

### Round 1（2026-10-18，用户确认「全按推荐」）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 受众与发布形态 | **开源发布（MIT）**，目标仓库 `knink-owo/dsh-obsidian-plugin-devkit`；先本地/`install_bundle` 跑通，M4 发 npm |
| Q2 | 与参考实现的关系 | **独立重写**，继承其工具语义与四层验证纪律（MIT 允许借鉴） |
| Q3 | v0.1 能力清单 | **① 核心闭环 scaffold/build/validate/deploy/version ② install ③ L2 冒烟 ④ dev 一键循环**；L3 真机 / L4 e2e / UI 面板 / adopt 推迟 |
| Q4 | 真机通道 | **双层能力探测**：CLI 存在则增强（reload/inspect），不存在则降级；文档推荐启用 CLI |
| Q5 | 命名与分发 | 包名 `@knink-owo/dsh-obsidian-plugin-devkit`；插件 id `obsidian-plugin-devkit`；工具前缀 `obsidian_devkit_`；技能名 `obsidian-plugin-dev`；先装 `desktop` profile |
| Q6 | 测试 vault 与写入边界 | **默认 workspace 内 `dev-vault/`**（可配置覆盖）；外部 vault 需显式指定并接受提示 |
| Q7 | 交付节奏 | **立即开始 M1 骨架**（Round 2 收束后动工） |

### Round 2（2026-10-18，用户确认「Q1 已启用，其余按推荐」）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 是否现在启用 Obsidian CLI | **已启用**（用户操作；`%APPDATA%\obsidian\obsidian.json` 已出现 `"cli":true`，用户 PATH 末尾追加了 Obsidian 安装目录）。注：CLI 要求 Obsidian 正在运行；本会话 DSH 进程 PATH 为启动时快照，需用绝对路径调用或重启宿主后生效 |
| Q2 | scaffold 默认 minAppVersion 与设置模板代际 | **C**：默认 `minAppVersion: 1.13.0` + **声明式设置**（`PluginSettingTab.getSettingDefinitions()`，官方文档确认 1.13.0+）；保留 `settingsStyle: 'legacy'` 参数生成命令式 `display()` 模板 |
| Q3 | 项目布局默认值 | **C**：默认「独立源码目录 + deploy 复制进测试库」；`inVault` 参数可选就地开发（源码在 `<vault>/.obsidian/plugins/<id>/`） |
| Q4 | skill 内容来源与语言策略 | **A**：skill 以官方 `obsidian-sample-plugin/AGENTS.md` 为基底改写；skill/reference 文档用英文，工具报告用中文，README 中英双语 |

---

## 8. 二次调研修正（2026-10-18 晚，官方文档全量核对）

Round 1 的问题不变，但以下事实修正/补充会进入实现细节（Round 2 可能产生新的决策题）：

1. **提交流程变了**：已从「PR 到 obsidian-releases + validate-plugin-entry.yml 机器人」迁到 **community.obsidian.md + 自动化审核**；旧校验工作流 404。validate 工具的规则来源改为「官方审核规则 + Plugin guidelines + October checklist + eslint-plugin-obsidianmd」。
2. **manifest 规则更严格**：id 只能 `[a-z0-9-]`（不含下划线）、不得以 plugin 结尾、不得含 obsidian、**必须等于插件目录名**；version 严格 `x.y.z`；description ≤250 且必须以 `.` 结尾、无 emoji；`isDesktopOnly` 必须显式存在；`fundingUrl` 仅限打赏。
3. **官方无 watch→复制步骤**：模板仓库直接置于 vault 插件目录内就地构建；这影响「项目布局」决策（见 §4 决策 8）。
4. **新 API 有版本门控**：声明式设置（1.13.0+）、DeferredView（1.7.2+）、SecretStorage；scaffold/validate 必须按 minAppVersion 选择与检查（见 §4 决策 9）。
5. **官方自带 agent 指令文件**：`obsidian-sample-plugin/AGENTS.md` 可直接作为 skill 内容基底（见 §4 决策 10）。
6. **文档检索方式**：官方 API 参考是按类/按成员的生成页面，适合按需抓取，不必内嵌 obsidian.d.ts。

**Round 2 预计新增的问题**（等 Round 1 答案后再定）：scaffold 默认目标 `minAppVersion`（保守 1.5.x 用命令式设置 vs 现代 1.13.0+ 用声明式设置）；项目布局默认值（独立源码目录 vs 就地开发）；是否把官方 AGENTS.md 原文纳入 skill（含删除失效链接的处理）；文档与工具输出语言（中文/英文/双语）。

---

## 9. M1 实施记录（2026-10-18，已交付）

M1 范围（Round 2 后用户批准立即开工）：**scaffold / build / validate / version 四个工具 + 可安装 bundle**。

### 已完成

- 仓库骨架：`package.json`（v0.1.0，`dsh.bundle.patch: ./cordis.patch.yml`）、`tsconfig.json`（NodeNext/ES2022/strict）、`cordis.patch.yml`、`LICENSE`（MIT）、`README.md`（中英双语）、`.gitignore`。
- `src/`：`index.ts`（cordis 入口，`inject = ["tools","fs"]`，注册 4 工具）、`fs.ts`（DSH `ctx.fs` 封装 + Node fs 回退）、`proc.ts`（一次性子进程，无 shell，超时）、`naming.ts`（官方提交命名规则 + 软提示）、`manifest.ts`（项目探测/JSON 读写）、`version.ts`（三文件同步）、`report.ts`（Markdown 报告）、`templates.ts`（`{{VAR}}`/`{{VAR|JSON}}`/`{{#IF_X}}` 渲染）、`scaffold.ts`、`build.ts`、`validate.ts`。
- `assets/templates/`：14 个模板文件；`src/main.ts` 含命令、ribbon 图标、Modal、settings tab；`src/settings.declarative.ts`（`getSettingDefinitions(): SettingDefinitionItem[]`）与 `src/settings.legacy.ts`（`display()`）二选一由 `settingsStyle`/`minAppVersion` 决定。
- 编译产物 `lib/`；`npm test` = 26 个 node:test 用例全过（naming/templates/scaffold/version/plugin wiring）。
- 真机样例验证：把 scaffold 产物放进 `.devkit/demo`，`tsc -noEmit -skipLibCheck` 通过，esbuild 产出 CommonJS `main.js`（只 externalize `obsidian` 等），`obsidian_devkit_validate` 报告 PASS。

### 已知限制（M1 范围外或环境限制）

1. **本会话沙箱禁止 Node 以管道 spawn 子进程**：`pnpm run build`（esbuild JS API 需要 spawn）在 DSH bash 沙箱内报 `spawn EPERM`。因此 `obsidian_devkit_build` 的「执行项目构建脚本」路径未在本沙箱内闭环测试；已用「直接调用 `node_modules/@esbuild/win32-x64/esbuild.exe` + 直接 `node node_modules/typescript/bin/tsc`」替代验证模板可编译，且 build 工具会在宿主（非沙箱）正常运行。测试脚本因此改 `node --test --test-isolation=none`。
2. **Obsidian CLI 已启用（1.14.4）但 M1 不使用**：`%APPDATA%\obsidian\obsidian.json` 有 `"cli":true`，Obsidian 安装目录 `C:\Users\ink14\AppData\Local\Programs\Obsidian` 已加入用户 PATH；本会话宿主 PATH 为启动快照，调用需绝对路径或重启宿主。M2 的 deploy/status/reload 才依赖它（且要求 Obsidian 正在运行）。
3. 尚未安装进 profile、尚未提交 git/推送（目标仓库仍空）；npm 发布按决策推迟到 M4。

### M2 入口（下一步）

deploy（写入 `<vault>/.obsidian/plugins/<id>/`，默认 workspace 内 `dev-vault/`）→ `status`/`reload`（官方 CLI，缺失时降级）→ 沙箱 e2e（WebdriverIO + wdio-obsidian-service，独立 config dir）→ `obsidian-plugin-dev` skill + `doc/harness.default.md` 会话上下文注入。

---

## 10. 事故修复记录：工具 schema 不是 JSON Schema 对象根（2026-10-18）

**现象**：插件安装启用后，用户侧下一轮请求直接失败（模型 API 400）：

```
Invalid schema for function 'obsidian_devkit_build':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

用户已停用插件，要求重新核对 DSH 插件设计指南。

**根因**：`ctx.tools.register` 的 `ToolDefinition.parameters` 被 DSH **原样投影**为模型函数的参数 schema。M1 代码传入的是扁平 DSL（`{ targetDir: { type: "string", required: true } }`），投影后模型看到 `{"type": null}`，请求被拒。参考实现没有踩坑，是因为它用了 `@deepseek-ai/dsh-tools` 的 `defineTool` helper（内部会包一层对象根）；我们手写注册，少包了这一层。

**修复**（版本号计划 0.1.1，尚未发版）：

1. `src/types.ts`：`parameters` 类型改为 `JsonSchemaNode`（对象根）；新增 `objectSchema()` 包装器（`required` 数组 + `additionalProperties: false`）。
2. `src/index.ts`：4 个工具全部 `parameters: objectSchema({...})`；`isConcurrencySafe` 从布尔改为 `(args) => boolean`（DSH 实际类型如此）。
3. `test/plugin.test.mjs`：新增断言 `parameters.type === "object"`、`properties` 为对象、`isConcurrencySafe` 为函数；全仓 26 + 5 = 31 项测试全过。
4. 补齐展示元数据：`locale/en.json`、`locale/zh.json`、`icon.svg`，`package.json` 增加 `exports["./locale/*.json"]`、`exports["./icon"]` 与对应 `files` 条目。
5. 移除未使用的 `@deepseek-ai/schemastery` peer/dev 依赖（M1 未导出 `Config`，避免 profile 里 peer 解析警告）。

**教训**（已写入 `docs/dsh-plugin-guide.zh.md`）：

- 插件「注册成功」≠「模型可用」：工具 schema 的合法性要到下一轮模型请求才暴露，安装后必须重启宿主并真实调一次工具才能验收。
- 手写 `ctx.tools.register` 时 `parameters` 必须是 `{ type: "object", properties, required }`；扁平 DSL 只属于 `defineTool` helper。
- `isConcurrencySafe` 是函数 `(args) => boolean`，`timeoutMs` 是毫秒数，`output.schema` 是**结果值**的 JSON Schema。
- 安装/替换插件后用 `plugin_manager list_plugins` 看 `fiberPhase === "active"`；`application: failed` 时先按 `nextStep` 修。
