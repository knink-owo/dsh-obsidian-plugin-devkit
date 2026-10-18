# Obsidian 插件开发调研报告

> 调研时间：2026-10-18 · 调研方式：官方文档源仓库（obsidianmd/obsidian-developer-docs、obsidian-api、obsidian-sample-plugin）+ 官方 CLI 帮助页 + 参考实现源码/发布包分析 + 本机环境实测
> 结论先行：Obsidian 插件开发的确定性很高（模板、构建、发布规则都被官方固化了），适合做成 DSH 工具链；真正的难点在「真机反馈回路」——官方 CLI 需要 Obsidian 1.12.4+，而本机是 1.8.10。
> 二次补充（2026-10-18）：对官方文档源仓库做了全量核对，修正 manifest 规则、提交流程（已移到 community.obsidian.md）、新增 API（声明式设置/SecretStorage/DeferredView）三处过时事实，详见 §1.2、§1.7、§2.1。完整英文调研笔记：[research/scratch/obsidian-plugin-docs-brief.md](../research/scratch/obsidian-plugin-docs-brief.md)。

---

## 1. Obsidian 插件开发模型

### 1.1 插件是什么

Obsidian 插件不是独立应用，而是被 Obsidian 渲染进程加载的 JavaScript 包。一个可加载的插件目录最小形态：

```
<vault>/.obsidian/plugins/<plugin-id>/
├── main.js        # 必需。CommonJS 格式的打包产物（Obsidian 用 require 加载）
├── manifest.json  # 必需。插件元数据，决定 id / 版本 / 最低 App 版本
├── styles.css     # 可选。插件样式
└── data.json      # 可选。运行时由 loadData()/saveData() 读写
```

开发仓库的典型结构（官方模板）：`src/main.ts` + `esbuild.config.mjs` + `manifest.json` + `versions.json` + `version-bump.mjs` + `styles.css`。

### 1.2 manifest.json 字段（官方定义）

| 字段 | 必需 | 官方约束（二次核对的准确版） |
|---|---|---|
| `id` | 是 | 只能小写字母+数字+连字符（`^[a-z0-9-]+$`）；**不得含 "obsidian"、不得以 "plugin" 结尾**；全局唯一、发布后不可改；**本地开发时必须等于插件目录名**，否则 `onExternalSettingsChange` 永远不会触发 |
| `name` | 是 | 展示名；仅 Basic Latin（允许连字符/`+`/括号），**无 emoji**；不得含 "Obsidian"/"Obsi-"/"-sidian"、不得用核心功能名（"Bases"、"Live Preview"）、**不得含单词 "Plugin"**；全局唯一 |
| `version` | 是 | **严格 `x.y.z`**（社区目录不接受预发布/构建后缀）；git **tag 必须与之完全相同且无前导 `v`**；发布时 `versions.json[version] = minAppVersion` |
| `minAppVersion` | 是 | 实际最低版本（不能虚高）；声明式设置需 ≥1.13.0，DeferredView 相关 ≥1.7.2 |
| `description` | 是 | ≤ **250 字符**、**以 `.` 结尾**、无 emoji、大小写正确；社区目录列表摘要 |
| `author` | 是 | 作者名；提交社区目录时必须是仓库 owner 或组织公开成员 |
| `authorUrl` | 否 | 作者主页 |
| `fundingUrl` | 否 | 字符串或 `{ "Buy Me a Coffee": "https://…" }` 映射；**仅允许打赏类服务**，不打赏就删掉 |
| `isDesktopOnly` | 是 | 布尔值；只要用到 Node.js/Electron API（或 `FileSystemAdapter` 专有特性）就必须为 true |

其他硬规则：**不要硬编码 `.obsidian`**，用 `Vault.configDir`（用户可改配置目录名）；`main.js` 不进 git（只进 release assets）。

### 1.3 官方模板 obsidian-sample-plugin（实测内容）

`package.json`：

```json
{
  "name": "obsidian-sample-plugin",
  "version": "1.0.0",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "version": "node version-bump.mjs && git add manifest.json versions.json"
  },
  "license": "0-BSD",
  "devDependencies": {
    "esbuild": "0.25.5",
    "obsidian": "latest",
    "typescript": "^5.8.3",
    "eslint": "^9.39.4",
    "eslint-plugin-obsidianmd": "^0.4.0",
    "@types/node": "^22.15.17",
    "globals": "^17.6.0",
    "jiti": "^2.6.1",
    "typescript-eslint": "^8.59.1",
    "@eslint/js": "^9.39.4"
  }
}
```

`esbuild.config.mjs` 的关键点（决定「能不能被 Obsidian 加载」）：

- `format: 'cjs'` —— **Obsidian 只加载 CommonJS**，产物必须是 CJS（这是最常见的踩坑点）
- `bundle: true`、`target: 'es2021'`、`treeShaking: true`、`outfile: 'main.js'`
- `external`: `obsidian`、`electron`、`@codemirror/*`、`@lezer/*`、`...builtinModules` —— 这些由 Obsidian 运行时提供，不能打进 bundle
- 开发模式 `context.watch()`；`production` 模式 `rebuild()` 后退出
- dev 模式内联 sourcemap，prod 模式 minify

`versions.json`：`{ "<plugin-version>": "<minAppVersion>" }` 映射；`version-bump.mjs` 在 `npm run version` 时把 `package.json` 的版本同步进 `manifest.json` 和 `versions.json`。

### 1.4 开发工作流（官方 "Development workflow"，已按二次核对修正）

官方流程的关键事实：**没有「构建后复制到 vault」这一步**。仓库（模板）本身就被放在 `<dev-vault>/.obsidian/plugins/<id>/` 里，`npm run dev` 的 watch 直接就地写 `main.js`，`manifest.json` 也在原地：

1. 用**独立 vault** 做开发，避免污染日常笔记库
2. 把插件仓库（或构建产物）放到 `<dev-vault>/.obsidian/plugins/<id>/`（官方是直接克隆进去；注意 manifest.id 必须等于目录名）
3. `npm run dev`（esbuild watch）持续就地产出 `main.js`（dev 内联 sourcemap，不 minify）
4. 重载方式：手动 Settings → Community plugins 关开插件，或命令面板 "Reload app without saving"；或装社区插件 **Hot-Reload**（`pjeby/hot-reload`，插件根放 `.hotreload` 标记文件）实现构建后自动重载
5. 发布前 `npm run build` = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`（minify、sourcemap 关闭）
6. 发版：`npm run version`（`version-bump.mjs` 改写 `manifest.json` + 追加 `versions.json`）→ 打与 version 完全相同的 tag → GitHub Release 附 `main.js`/`manifest.json`/`styles.css`

> 官方 "Development workflow" 页面很薄（872 字节），真正的规范落在 `Plugin guidelines`、`Submission requirements` 与 `Obsidian October self-critique checklist` 三处。

### 1.5 文档地图（docs.obsidian.md 源码目录）

- `Plugins/Getting started/`：Anatomy of a plugin、Build a plugin、Development workflow、Mobile development、Use React in your plugin、Use Svelte in your plugin
- `Plugins/Guides/`：Manage plugin lifecycle、Optimize plugin load time、Defer views、Store secrets、Support pop-out windows、Migrate to declarative settings、Build a Bases view
- `Plugins/Releasing/`：Plugin guidelines（13.6 KB，最重要的代码规范页）、Submit your plugin、Release your plugin with GitHub Actions、Beta-testing plugins
- `Plugins/User interface/`：Commands、Ribbon actions、Settings、Status bar、Modals、Context menus、HTML elements、Suggestion、Views…
- `Plugins/Editor/`：Editor extensions、Decorations、Markdown post processing、State fields/management、View plugins
- `Plugins/Events.md`
- `Community directory/`：Submission requirements for plugins、Developer policies、Organizations、Manage your plugin or theme、FAQ
- `Obsidian October plugin self-critique checklist.md`（7.2 KB，发布前自检清单）
- `Reference/TypeScript API/`：由 obsidian.d.ts 自动生成的完整 API 参考

### 1.6 核心 API 面（插件实际会用到的东西）

- 生命周期：`Plugin.onload()` / `Plugin.onunload()`；`loadData()` / `saveData()`
- 注册与清理：`registerEvent()`、`registerDomEvent()`、`registerInterval()`、`addCommand()`、`addRibbonIcon()`、`addSettingTab()`、`addStatusBarItem()`、`registerView()`、`registerMarkdownPostProcessor()`、`registerEditorExtension()`
- 数据层：`App` / `Vault` / `Workspace` / `MetadataCache` / `FileManager` / `CachedMetadata`
- 编辑器：CodeMirror 6（`@codemirror/state`、`view` 等，由 Obsidian 提供）
- 工具：`normalizePath()`、`requestUrl()`（插件内发网络请求应走它）、`Platform`（移动端判断）、`Notice`、`Modal`、`Setting`
- 移动端约束：用到 Node.js / Electron API 的插件必须 `isDesktopOnly: true`

### 1.7 二次核对补充的 API 事实（对工具生成代码有直接影响）

- **声明式设置（Obsidian 1.13.0+）**：`PluginSettingTab.getSettingDefinitions()` 返回行定义 `{ name, desc?, control | render | action | type: 'group' | 'list' | 'page' }`；`control.key` 对应 `this.plugin.settings` 上的字段，Obsidian 自动读写并 `saveData()`。控件类型：toggle/text/textarea/number/slider/dropdown/file/folder/color；都支持 `defaultValue` 与 `validate`（返回字符串=拒绝）；`visible`/`disabled` 支持布尔或函数，靠 `this.refreshDomState()` 刷新；`render(setting)` 不自动保存；自定义存储可覆写 `getControlValue`/`setControlValue`；`getSettingDefinitions()` 每次刷新都会调用，必须廉价。**传统命令式 `display()` 仍长期支持**，`minAppVersion < 1.13.0` 时必须用它（官方另有双支持迁移指南）。
- **DeferredView（1.7.2+）**：view 在首次可见前是 `DeferredView`，必须 `leaf.view instanceof MyView` 判断；`await leaf.loadIfDeferred()` 仅作最后手段。
- **SecretStorage**：设置里存的是 secret **名字**不是值；UI 用 `new SecretComponent(this.app, el)` 经 `Setting.addComponent()` 接入；读取 `app.secretStorage.getSecret(name)`（可能为 `null`）；secret 存在按 vault 隔离的 local storage。
- **Vault 写入纪律**：`process(file, cb)` 是首选原子改写；`cachedRead()` 只用于展示、读改写用 `read()`；`modify()` 会丢编辑器状态（活动文件改用 `Editor` API）；`trash()` 尊重用户回收站设置，`delete()` 不尊重；用户输入路径一律 `normalizePath()`；优先 Vault API 而非 `adapter`（移动端是 `CapacitorAdapter`）。
- **命令**：`checkCallback(checking)` 会被调用两次（checking=true 预检、false 执行）；`editorCallback` 只在有活动编辑器时出现；命令 id 自动加插件 id 前缀；官方不建议设默认快捷键。
- **网络与渲染**：发请求用 `requestUrl()`（不是 fetch/axios）；`moment` 从 `obsidian` 导入；`MarkdownRenderer.render(app, md, el, sourcePath, component)` 必须传长生命周期的真实 Component。
- **官方 `AGENTS.md`**：`obsidianmd/obsidian-sample-plugin` 仓库自带 Obsidian 自己的 agent 指令文件（文件布局、构建命令、manifest 规则、发布资产、安全与 UX 文案、排错表），可直接作为 devkit skill 的内容基底；注意它引用的旧 validator URL 已 404，复用时要删。
- **API 参考结构**：`Reference/TypeScript API/` 是按类、按成员生成的页面（如 `Vault/process.md`），适合按需检索；不必把 ~200KB 的 `obsidian.d.ts` 全量塞进上下文。
- **调试与启动性能**：DevTools 在桌面 Ctrl+Shift+I；移动端可用 `this.app.emulateMobile(true)`、Android `chrome://inspect`、iOS 16.4+ Safari Web Inspector（且 Node/Electron API 在移动端不存在）；启动耗时可在 Settings → General → Advanced 看；`onload` 只做注册，重活放 `workspace.onLayoutReady()`，不要在 layout ready 前监听 `vault.on('create')`（初始化时会为每个文件触发）。

---

## 2. 发布与合规（官方硬规则）

### 2.1 提交到社区目录（流程已变更，二次核对修正）

**旧流程（PR 到 obsidian-releases）已废弃**：参考实现里引用的 `obsidian-releases/.github/workflows/validate-plugin-entry.yml` 现在 **404**，该仓库只剩 `mirror-community-json.yml` 与 `plugin-stat.yml`。当前流程：

- 仓库根目录必须有 `README.md`、`LICENSE`、`manifest.json`；**`main.js` 不提交进 git**，只作为 release assets
- 发版：bump `version`（严格 `x.y.z`）→ 打**同名 tag（无前导 `v`）**→ GitHub Release 附二进制资产 `main.js`、`manifest.json`、`styles.css`（可选）；Obsidian 只从 tag 与 `manifest.version` 匹配的 release 里下载这三件
- 提交：在 **community.obsidian.md** 用 Obsidian 账号登录 → 关联 GitHub → "Add your plugin"；目录读取**默认分支 HEAD** 的 `manifest.json`；审核是**自动化的**，有错误时给出指引、修复前插件不可安装；之后更新只需发新 GitHub release（无需重新提交）
- Beta 分发：社区插件 **BRAT**（`TfTHacker/obsidian42-brat`）；官方明确不为 beta 提供支持
- 官方 GitHub Actions 模板（`Releasing/Release your plugin with GitHub Actions.md`）：`push: tags: ['*']` → permissions `contents/id-token/attestations: write` → checkout + setup-node（Node 24）→ `npm ci && npm run build` → `actions/attest@v4` → `gh release create "$tag" --draft main.js manifest.json [styles.css]`；仓库 Settings → Actions 权限需设为 Read and write

### 2.2 自动化审核会拦的项（validate 工具的直接依据）

| 项 | 硬规则 |
|---|---|
| `id` | `^[a-z0-9-]+$`；不能含 "obsidian"（不区分大小写）、不能以 "plugin" 结尾；全局唯一；**必须等于本地插件目录名** |
| `name` | 不能含 "Obsidian"；不能以 "Plugin" 结尾；不能占核心功能名；仅 Basic Latin、无 emoji |
| `version` | 严格 `x.y.z`；tag 与 manifest.version 完全一致（无 `v`）；`versions.json` 覆盖每个已发布版本 |
| `description` | ≤250 字符、以 `.` 结尾、无 emoji |
| `isDesktopOnly` | 必须存在；用 Node/Electron（或 `FileSystemAdapter` 专有特性）必须 true |
| `fundingUrl` | 只能用于打赏服务，否则删除 |
| 其他 | 命令 id 里不要重复插件 id；示例代码必须删干净；`minAppVersion` 必须真实；README 披露收费/账号/网络/遥测/外部文件访问/闭源 |

### 2.3 Developer policies 与审查要点（`Plugin guidelines` + October checklist）

开发者政策（违反会下架）：禁止混淆代码、禁止动态广告/插件外静态广告、**禁止客户端遥测**、插件不得自我更新或安装依赖、主题不得加载网络资产。LICENSE 必须存在并尊重上游；未经原作者书面许可或「6 个月无维护 + 30 天通知」的 fork 会被拒。

审查高频扣分点（可编码成 lint 规则）：用 `this.app` 而非全局 `app`；禁用 `innerHTML/outerHTML/insertAdjacentHTML`（用 `createEl`、`el.empty()`）；不要 `console.log` 噪音；把 `MyPlugin`/`SampleSettingTab` 占位名改掉；统一 sentence case；不要顶层标题、标题不带 "settings" 字样（用 `setHeading()`）；不用内联样式（CSS 类 + CSS 变量）；不设默认快捷键；用 `getActiveViewOfType()` 而非 `activeLeaf`；`activeEditor?.editor` 取编辑器；不缓存 view 实例；后台写文件用 `Vault.process()`，活动文件用 `Editor` API，frontmatter 用 `FileManager.processFrontMatter()`；删除用 `trashFile()`；路径用 `normalizePath()`；配置用 `loadData/saveData`；cast 前先 `instanceof`；不用 `var`/`as any`；提交 lockfile；`onunload` 里不要 detach leaves。

> `eslint-plugin-obsidianmd` 的 `configs.recommended` 是上述规范的可执行化版本，官方模板已内置。

### 2.4 发布前自检清单

`Obsidian October plugin self-critique checklist`（7.2 KB）是官方发布前自查清单，与 `Plugin guidelines` 一起构成 validate 工具的规则来源。

---

## 3. 官方自动化能力（对 devkit 最关键的新事实）

### 3.1 Obsidian CLI（官方，2026 年起）

来源：官方帮助页 `Obsidian CLI & Headless`（help.obsidian.md/cli → obsidian.md/help/cli）

- **前置条件：Obsidian 安装器版本 ≥ 1.12.4**
- 启用：Settings → General → 打开 **Command line interface**，按提示注册，会把 `obsidian` 加入系统 PATH
- 语义：CLI 通过 IPC 控制**正在运行的**桌面 App；App 没运行时第一条命令会自动拉起 App
- 可用命令（对插件开发有价值的）：
  - `obsidian version` / `obsidian help` / `obsidian vaults`
  - `plugin:reload`、`plugin:enable`、`plugin:disable`、`plugins:enabled`、`plugins:restrict`
  - `dev:errors`、`dev:console`、`dev:dom`、`dev:css`、`dev:screenshot`、`dev:debug`、`dev:cdp`
  - `eval code='...'`（在 App 里执行 JS）、`command`、`reload`/`restart`
- 已知坑（来自参考实现实测，与官方文档互补）：
  - **退出码不可信**：CLI 打印 `Error: …` 仍然 exit 0 → 必须按输出分类
  - **空输出 = hang**，不是成功；必须自带超时并按输出分类
  - 插件类/dev 类命令按「当前活动窗口的 vault」解析；`vault=<name>` 并不可靠
  - Obsidian 只在 vault 加载时扫描一次插件目录 → 刚部署的插件需要 `rescan`（`app.plugins.loadManifests()`）或重载
  - 受限模式（Restricted mode）按 vault 存储，开启时社区插件不加载；信任弹窗不能代确认
- 另有 **Obsidian Headless**：独立于桌面 App 的同步/发布客户端（面向 CI/服务器），与插件开发关系不大

### 3.2 本机实测（2026-10-18）

- 已安装 Obsidian：`C:\Users\ink14\AppData\Local\Programs\Obsidian\Obsidian.exe`，**版本 1.14.4**（用户于 2026-10-18 升级，已满足 CLI 的 1.12.4+ 前置条件）
- 但 `obsidian` 仍不在 PATH（`command -v obsidian` 无结果）→ **CLI 尚未在 Settings → General → Command line interface 中启用**；启用后才会注册命令
- → 真机通道能力探测：1.14.4 版本条件已满足，剩余变量是「用户是否启用 CLI」；devkit 仍按「探测存在则增强、不存在则降级」设计

---

## 4. 参考实现分析：LeeLee592/dsh-obsidian-plugin

- 仓库：https://github.com/LeeLee592/dsh-obsidian-plugin （MIT，TypeScript，v0.9.2，89 files，518 KB unpacked）
- 定位：**不是笔记操作插件**，而是给 DSH agent 的 Obsidian 插件开发工具箱（scaffold / build / smoke test / deploy / reload / inspect / e2e / validate / version + 一个 `obsidian-plugin` skill）
- 形态：Host-only Cordis bundle，`cordis.patch.yml` 只 insert 一行；`src/index.ts` 是唯一组合根；无任何 Client/UI
- 工具（11 个，前缀 `obsidian_plugin_`）：`scaffold`、`build`、`deploy`、`inspect`、`vault`、`reload`、`test`、`e2e`、`eval`、`validate`、`version`
- 三条通道：
  1. **官方 Obsidian CLI**（`obsidian` 命令）负责真机 `plugin:reload` / `dev:*` / `eval` / `vaults`，`cli.ts` 统一做错误分类（ok/error/unavailable/hang/missing）
  2. **直接写 vault 文件** 负责 deploy：拷三件套 + 合并 `community-plugins.json` + 写 `dsh.obsidian.json` 绑定文件；明确区分 written/enabled/active 三态
  3. **WebdriverIO + wdio-obsidian-service** 负责沙箱 E2E：独立配置目录 + vault 副本 + 隐藏窗口，不打扰用户
- 验证分级（值得照搬的方法论）：

| 档 | 内容 | 依赖 |
|---|---|---|
| L1 静态 | 构建 + 产物格式/manifest 自检 | 无 |
| L2 离线冒烟 | 用桩化 Obsidian API 在 Node 里加载 bundle，跑 onload/onunload | 无 Obsidian |
| L3 用户真机 | CLI：reload / inspect / eval | CLI（1.12.4+） |
| L4 沙箱 E2E | wdio 启动独立 Obsidian | Node + wdio |

- 硬性纪律：`build` 通过 ≠ 插件可用；`test` PASS ≠ UI 已验证；涉及 UI 必须真正看到
- 值得借鉴的实现细节：命名规则单一事实源（`naming.ts`）；入口/产物按项目真实配置解析（不执行配置，只做文本解析）；bundle 是 ES module 时明确报错（要求 CJS）；构建三级降级（项目 build 脚本 → 本地 esbuild → 报错）；沙箱诚实（写不进去就拒绝并说明）；技能文档里记录大量 CLI 隐知识
- 缺口（相对于「devkit」）：① 依赖安装未自动化（只打印命令）② 无常驻 watch/热重载循环（工具都是一次性调用）③ 无项目接管/迁移 ④ 无发布自动化（tag/release/community 提交）⑤ 无测试生成 ⑥ 无 API/目录检索 ⑦ 无 UI ⑧ 无 monorepo/多 vault 配置 ⑨ skill 面向「使用工具」而非「扩展 devkit」

---

## 5. 本机环境约束（方案必须适配）

| 约束 | 事实 | 影响 |
|---|---|---|
| 沙箱写入边界 | DSH `workspace-write`：只能写 `D:\Projects\dsh-obsidian-devkit` 内文件 | 测试 vault 必须建在 workspace 内；写用户现有 vault（如 `D:\Obsidian\all-in-one`）会被拒绝，除非放宽策略 |
| Obsidian 版本 | 1.8.10（CLI 需 1.12.4+） | 真机联调（L3）当前不可用 |
| 现有 vault | `D:\Blog\myblog\quartz`、`D:\Obsidian\万年历`、`D:\Obsidian\all-in-one`（当前打开）、`D:\Obsidian\临时`、`D:\Projects\Maze-garden\content` | 均可作为「用户真实库」，但都在 workspace 外 |
| 已装社区插件 | all-in-one 有 15 个（dataview/templater/kanban/excalidraw/git 等），**无 hot-reload 插件** | 需要自建 watch/reload 体验 |
| Node 工具链 | Node v24.19.0 / npm 11.17.0 / pnpm 9.15.9 | 可跑 esbuild/tsc/node:test |
| 网络 | npm registry 可用但需 `--cache` 指到 workspace 内；`git clone` 在沙箱内失败；GitHub REST API 可访问 | 依赖安装要能指定 cache；不能依赖 git clone |
| DSH 插件机制 | bundle + `cordis.patch.yml` + `plugin_manager install_bundle`；`ctx.tools.register` 注册工具；`skills` 服务可动态注册技能；`systemPrompt` 可注入上下文 | 与参考实现同构，方案可行 |

---

## 6. 对 devkit 的启示

1. **官方模板就是脚手架的正确形态**：不要自创结构，直接以 obsidian-sample-plugin 为基底，内置 CJS 外部化清单
2. **验证分级要保留**：L1+L2 能离线跑，是 agent 迭代的主力；L3/L4 作为增强档
3. **真机通道要做能力探测**：本机没有 CLI，强行依赖会让一半工具不可用；文件层部署 + 手动 reload 是可用下限
4. **沙箱边界要显式建模**：测试 vault 放 workspace 内；对外部 vault 的写入要么拒绝并解释，要么走显式授权
5. **命名/提交规则要做成单一事实源**：validate、scaffold、build 都复用它，避免规则漂移
6. **常驻 watch 是最大体验缺口**：一次 build→deploy→reload 的循环需要长驻进程，工具设计上要预留「后台任务 + 日志快照」而非只做一次性调用
7. **skill 与工具要配对**：skill 负责「何时用、按什么纪律用」，工具负责确定性动作
8. **参考实现的 MIT 许可允许复用**，但独立重写更利于长期维护与对齐官方文档
9. **官方 `AGENTS.md` 是现成的 skill 骨架**：它是 Obsidian 写给 coding agent 的指令文件，覆盖布局/命令/manifest/发布/安全/UX 文案/排错，可直接改造进 `obsidian-plugin-dev` skill（删掉已 404 的 validator 引用）
10. **代码生成要做版本门控**：声明式设置只在 1.13.0+ 可用、DeferredView 相关 API 需 1.7.2+、SecretStorage 较新；scaffold 需要按目标 `minAppVersion` 选择生成「声明式」还是「命令式」设置模板，并在 validate 里检查 API 用法与 minAppVersion 是否匹配
11. **官方流程没有「构建→复制到 vault」**：产物就地写在插件目录。devkit 若要支持「源码在 workspace 项目目录、测试库在别处」，deploy 复制就是必要环节（差异点）；若允许源码直接放测试库内，则可省掉复制、直接 watch
12. **validate 规则的权威来源已更新**：`community.obsidian.md` 的自动化审核 + `Plugin guidelines` + October checklist + `eslint-plugin-obsidianmd`，旧 `obsidian-releases` 校验工作流已失效

---

## 7. 来源

- 官方文档源仓库：https://github.com/obsidianmd/obsidian-developer-docs （docs.obsidian.md）
- API 类型定义：https://github.com/obsidianmd/obsidian-api
- 官方脚手架模板：https://github.com/obsidianmd/obsidian-sample-plugin
- 官方 ESLint 插件：https://github.com/obsidianmd/eslint-plugin （npm: `eslint-plugin-obsidianmd`）
- Obsidian CLI 帮助页：https://obsidian.md/help/cli （镜像：https://mintlify.wiki/obsidianmd/obsidian-help/extending/obsidian-cli）
- Windows 安装后的实测：`Obsidian.exe` ProductVersion 1.8.10.0
- 参考实现：https://github.com/LeeLee592/dsh-obsidian-plugin · npm `@leelee592/dsh-obsidian-plugin@0.9.2`
- 参考实现所用的 skill 源头：https://github.com/gapmiss/obsidian-plugin-skill （MIT）
- 官方 agent 指令文件：https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/AGENTS.md
- 社区目录（当前提交通道）：https://community.obsidian.md
- 官方开发者政策与提交要求：https://docs.obsidian.md/Community+directory/Download+and+install+plugins 同目录下的 `Developer policies` / `Submission requirements for plugins`
- 二次调研英文笔记：`research/scratch/obsidian-plugin-docs-brief.md`（本仓库内）
