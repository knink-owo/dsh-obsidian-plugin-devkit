/**
 * L2 smoke test: load a built `main.js` in an isolated Node VM with a stubbed
 * `obsidian` module, then optionally instantiate the plugin and call
 * `onload()` / `onunload()`.
 *
 * This layer catches the failures that a green build hides: ES-module output,
 * missing default export, a wrong prototype chain, import-time crashes and
 * obvious `onload` exceptions. It proves nothing about real Obsidian API
 * compatibility — that is L3/L4. The bundle code does run, with Node builtins
 * available, so treat it like installing the plugin: only smoke-test code you
 * would actually load.
 */
import { createRequire } from "node:module";
import { dirname, isAbsolute } from "node:path";
import vm from "node:vm";

import type { Fs } from "./fs.js";
import { inspectProject, joinPath } from "./manifest.js";
import { codeBlock, formatReport, verdict } from "./report.js";
import type { FsCall } from "./types.js";

export const SMOKE_SCENARIOS = ["load", "onload", "unload"] as const;
export type SmokeScenario = (typeof SMOKE_SCENARIOS)[number];

export interface SmokeOptions {
  projectDir: string;
  /** Bundle path override, workspace-relative or absolute; defaults to the project's main.js. */
  bundle?: string;
  scenario?: SmokeScenario;
  timeoutMs?: number;
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeResult {
  report: string;
  ok: boolean;
  checks: SmokeCheck[];
  bundle: string | null;
  scenario: SmokeScenario;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "module",
  "net", "os", "path", "process", "querystring", "readline", "stream", "string_decoder",
  "timers", "tty", "url", "util", "vm", "worker_threads", "zlib",
]);

const hostRequire = createRequire(import.meta.url);

/** A minimal `obsidian` module: enough for a plugin to register itself. */
function createObsidianStub(): Record<string, unknown> {
  class ComponentBase {
    registerEvent(): { unsubscribe(): void } {
      return { unsubscribe() {} };
    }
    registerDomEvent(): void {}
    registerInterval(): number {
      return 0;
    }
    addChild(): void {}
    removeChild(): void {}
  }

  class PluginBase extends ComponentBase {
    app: unknown;
    manifest: unknown;
    constructor(app?: unknown, manifest?: unknown) {
      super();
      this.app = app ?? createAppStub();
      this.manifest = manifest ?? {};
    }
    async loadData(): Promise<unknown> {
      return null;
    }
    async saveData(_data: unknown): Promise<void> {}
    addCommand(command: unknown): unknown {
      return command;
    }
    addRibbonIcon(): unknown {
      return {};
    }
    addSettingTab(): void {}
    registerView(): void {}
    registerMarkdownPostProcessor(): void {}
    registerObsidianProtocolHandler(): void {}
    addStatusBarItem(): { setText(): void; remove(): void } {
      return { setText() {}, remove() {} };
    }
    onload(): Promise<void> | void {}
    onunload(): void {}
  }

  class PluginSettingTabBase {
    app: unknown;
    plugin: unknown;
    containerEl: unknown;
    constructor(app?: unknown, plugin?: unknown) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = {};
    }
    display(): void {}
  }

  class SettingBase {
    constructor(_containerEl: unknown) {}
    setName(): this {
      return this;
    }
    setDesc(): this {
      return this;
    }
    setHeading(): this {
      return this;
    }
    addText(): this {
      return this;
    }
    addTextArea(): this {
      return this;
    }
    addToggle(): this {
      return this;
    }
    addDropdown(): this {
      return this;
    }
    addButton(): this {
      return this;
    }
    setClass(): this {
      return this;
    }
  }

  class NoticeBase {
    constructor(_message?: unknown) {}
    setMessage(): this {
      return this;
    }
    hide(): void {}
  }

  class ModalBase {
    constructor(_app?: unknown) {}
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
  }

  class FileBase {
    path = "";
    name = "";
    constructor(path?: string) {
      this.path = path ?? "";
      this.name = (path ?? "").split("/").pop() ?? "";
    }
  }

  const noopSubscription = { unsubscribe() {} };

  return {
    Plugin: PluginBase,
    PluginSettingTab: PluginSettingTabBase,
    Setting: SettingBase,
    Notice: NoticeBase,
    Modal: ModalBase,
    Component: ComponentBase,
    TFile: FileBase,
    TFolder: FileBase,
    MarkdownRenderer: { render: async () => {} },
    MarkdownView: class {},
    Editor: class {},
    normalizePath: (path: string) => String(path).replace(/\\/g, "/").replace(/\/{2,}/g, "/"),
    moment: () => ({ format: () => "" }),
    requestUrl: async () => {
      throw new Error("requestUrl is stubbed in the smoke sandbox (no network)");
    },
    getLanguage: () => "en",
    apiVersion: "1.14.4",
    Platform: { isDesktop: true, isMobile: false, isDesktopApp: true, isMobileApp: false },
    debounce: (fn: (...args: unknown[]) => unknown) => fn,
    arrayBufferToBase64: () => "",
    base64ToArrayBuffer: () => new ArrayBuffer(0),
    on: () => noopSubscription,
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
}

/** Curated `app` stub (only what a plugin touches during registration). */
function createAppStub(): unknown {
  const subscription = { unsubscribe() {} };
  const vault = {
    getName: () => "smoke-vault",
    read: async () => "",
    cachedRead: async () => "",
    readBinary: async () => new ArrayBuffer(0),
    create: async () => ({ path: "", name: "" }),
    createFolder: async () => ({ path: "", name: "" }),
    modify: async () => {},
    process: async (_file: unknown, fn: (data: string) => string) => (typeof fn === "function" ? fn("") : ""),
    trash: async () => {},
    delete: async () => {},
    getAbstractFileByPath: () => null,
    getFileByPath: () => null,
    getRoot: () => ({ path: "/", children: [] }),
    on: () => subscription,
    adapter: {
      exists: async () => false,
      read: async () => "",
      write: async () => {},
      stat: async () => null,
    },
  };
  const workspace = {
    on: () => subscription,
    onLayoutReady: (callback: () => void) => {
      if (typeof callback === "function") callback();
    },
    getActiveView: () => null,
    getActiveFile: () => null,
    getLeavesOfType: () => [],
    getLeaf: () => ({ setViewState: async () => {} }),
    getRightLeaf: () => ({ setViewState: async () => {} }),
    revealLeaf: () => {},
    detachLeavesOfType: () => {},
    activeLeaf: null,
    layoutReady: true,
  };
  return {
    vault,
    workspace,
    metadataCache: { on: () => subscription, getFileCache: () => null, getFirstLinkpathDest: () => null },
    fileManager: {
      processFrontMatter: async (_file: unknown, fn: (frontmatter: Record<string, unknown>) => void) => {
        if (typeof fn === "function") fn({});
      },
      generateMarkdownLink: () => "",
      renameFile: async () => {},
    },
    plugins: { plugins: {}, enabledPlugins: new Set<string>(), loadManifests: async () => {} },
    commands: { commands: {}, addCommand: () => ({}), removeCommand: () => {} },
    keymap: {},
    scope: {},
    secretStorage: { getSecret: () => null, setSecret: () => {} },
    setting: { open: () => {}, openTabById: () => {} },
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    lastEvent: null,
  };
}

function createRequireStub(
  obsidian: Record<string, unknown>,
  required: string[],
): (id: string) => unknown {
  return (id: string): unknown => {
    required.push(id);
    if (id === "obsidian") return obsidian;
    if (id === "electron") {
      return {
        remote: {},
        ipcRenderer: { sendSync: () => undefined, send: () => {}, invoke: async () => undefined },
        shell: { openExternal: async () => {} },
        clipboard: { writeText: () => {} },
      };
    }
    if (id.startsWith("@codemirror/") || id.startsWith("@lezer/")) return {};
    const clean = id.startsWith("node:") ? id.slice(5) : id;
    if (id.startsWith("node:") || NODE_BUILTINS.has(clean)) {
      return hostRequire(id);
    }
    if (id.startsWith(".") || id.startsWith("/") || /^[A-Za-z]:[\\/]/.test(id)) {
      throw new Error(`Cannot require relative module "${id}" from main.js: the bundle must be self-contained`);
    }
    throw new Error(`Cannot find module "${id}" in the smoke sandbox (only obsidian, electron, codemirror/lezer and Node builtins are provided)`);
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ?? error.message;
    return stack.length > 900 ? `${stack.slice(0, 900)}…` : stack;
  }
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms (the plugin may hang in onload)`));
      }, timeoutMs);
      if (typeof timer === "object" && timer !== null && typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref(): void }).unref();
      }
    }),
  ]);
}

interface LoadedBundle {
  moduleExports: Record<string, unknown>;
  required: string[];
}

function executeBundle(
  bundlePath: string,
  text: string,
  obsidian: Record<string, unknown>,
): LoadedBundle {
  const required: string[] = [];
  const requireStub = createRequireStub(obsidian, required);
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const sandbox: Record<string, unknown> = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: requireStub,
    __filename: bundlePath,
    __dirname: dirname(bundlePath),
    console,
    process,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    document: {
      createElement: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { appendChild() {}, addEventListener() {}, removeEventListener() {} },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);
  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${text}\n});`;
  const script = new vm.Script(wrapped, { filename: bundlePath });
  const factory = script.runInContext(context, { timeout: 5_000 }) as (
    exports: unknown,
    require: unknown,
    module: unknown,
    filename: string,
    dir: string,
  ) => void;
  factory(moduleRecord.exports, requireStub, moduleRecord, bundlePath, dirname(bundlePath));
  return { moduleExports: moduleRecord.exports, required };
}

function hasCommonJsShape(text: string, moduleExports: Record<string, unknown>): boolean {
  if (Object.keys(moduleExports).length > 0) return true;
  return /\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(text);
}

export async function runSmoke(
  fs: Fs,
  options: SmokeOptions,
  call: FsCall,
): Promise<SmokeResult> {
  const scenario: SmokeScenario = SMOKE_SCENARIOS.includes(options.scenario ?? "load")
    ? (options.scenario ?? "load")
    : "load";
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const checks: SmokeCheck[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  const inspection = await inspectProject(fs, options.projectDir, call);
  const bundleRelative = options.bundle ?? inspection.bundle ?? "main.js";
  let bundlePath: string;
  if (options.bundle === undefined) {
    bundlePath = joinPath(options.projectDir, bundleRelative);
  } else {
    bundlePath = isAbsolute(options.bundle) ? options.bundle : joinPath(options.projectDir, options.bundle);
  }

  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
    if (!ok) problems.push(`${name}: ${detail}`);
  };

  if (inspection.problems.length > 0) {
    warnings.push(...inspection.problems.map((problem) => `项目检查：${problem}`));
  }

  let text: string | null = null;
  try {
    text = await fs.readText(bundlePath, call.workspaceRoot);
  } catch {
    text = null;
  }
  const obsidianStub = createObsidianStub();
  check(
    "构建产物",
    text !== null && text.length > 0,
    text === null || text.length === 0
      ? `${bundlePath} 不存在或为空；先运行 obsidian-devkit build`
      : `${bundlePath}（${Buffer.byteLength(text, "utf8")} 字节）`,
  );

  let loaded: LoadedBundle | null = null;
  let defaultExport: unknown = null;
  let instance: { onload?: unknown; onunload?: unknown } | null = null;

  if (text !== null && text.length > 0) {
    try {
      loaded = executeBundle(bundlePath, text, obsidianStub);
      check("模块执行", true, "CommonJS 包装器执行成功");
    } catch (error) {
      check("模块执行", false, errorText(error));
    }
  }

  if (loaded !== null) {
    check(
      "CommonJS 形态",
      hasCommonJsShape(text ?? "", loaded.moduleExports),
      hasCommonJsShape(text ?? "", loaded.moduleExports)
        ? "bundle 通过 module.exports 导出"
        : "未发现 module.exports/exports.* —— 可能被构建成 ES module，Obsidian 无法加载",
    );
    defaultExport = loaded.moduleExports.default ?? loaded.moduleExports;
    const isClass = typeof defaultExport === "function";
    check(
      "默认导出",
      isClass,
      isClass ? `导出类型 ${(defaultExport as { name?: string }).name || "anonymous"}` : `期望一个插件类，实际是 ${typeof defaultExport}`,
    );

    const PluginBase = (obsidianStub.Plugin as unknown) as { prototype: object };
    if (isClass) {
      const prototype = (defaultExport as { prototype?: object }).prototype;
      const extendsPlugin = prototype !== undefined && PluginBase.prototype.isPrototypeOf(prototype);
      check(
        "继承 Plugin",
        extendsPlugin,
        extendsPlugin ? "构造函数继承桩 Plugin" : "构造函数不继承 obsidian.Plugin（或使用了 ESM 导出）",
      );
      if (extendsPlugin) {
        try {
          instance = new (defaultExport as new (app: unknown, manifest: unknown) => { onload?: unknown; onunload?: unknown })(
            createAppStub(),
            inspection.manifest ?? { id: "smoke", name: "smoke" },
          );
          check("实例化", true, "插件实例创建成功");
        } catch (error) {
          check("实例化", false, errorText(error));
        }
      }
    }

    if (instance !== null && scenario !== "load") {
      const onload = instance.onload;
      if (typeof onload !== "function") {
        check("onload()", false, "插件没有 onload 方法");
      } else {
        try {
          await withTimeout(
            Promise.resolve().then(() => (onload as () => unknown).call(instance)),
            timeoutMs,
            "onload()",
          );
          check("onload()", true, "onload 执行未抛错");
        } catch (error) {
          check("onload()", false, errorText(error));
        }
      }
    }

    if (instance !== null && scenario === "unload") {
      const onunload = instance.onunload;
      if (typeof onunload !== "function") {
        check("onunload()", false, "插件没有 onunload 方法");
      } else {
        try {
          await withTimeout(
            Promise.resolve().then(() => (onunload as () => void).call(instance)),
            timeoutMs,
            "onunload()",
          );
          check("onunload()", true, "onunload 执行未抛错；注册项由 Obsidian 回收");
        } catch (error) {
          check("onunload()", false, errorText(error));
        }
      }
    }

    if (loaded.required.length > 0) {
      notes.push(`bundle 运行时 require 了：${[...new Set(loaded.required)].join("、")}`);
    }
  }

  notes.push("L2 只证明 bundle 能加载且 onload/onunload 不抛错；真实 Obsidian API 兼容性需要 L3 部署验证与 L4 人眼确认。");
  notes.push("沙箱执行的是真实 bundle 代码（Node 内建模块可用，网络桩会抛错）；只对准备安装的代码运行本工具。");
  notes.push(`场景：${scenario}；超时：${timeoutMs}ms。`);

  const report = formatReport({
    title: "Obsidian 插件 L2 冒烟（隔离加载）",
    summary: verdict(problems, warnings, `bundle=${bundlePath}`),
    problems,
    warnings,
    sections: [
      {
        title: "检查清单",
        lines: checks.map((item) => `- ${item.ok ? "✅" : "❌"} ${item.name} — ${item.detail}`),
      },
      {
        title: "沙箱环境",
        lines: [
          "- 模块：`obsidian`、`electron`、`@codemirror/*`、`@lezer/*` 为桩；Node 内建模块透传。",
          "- `app`：workspace/vault/metadataCache/fileManager/plugins 的最小桩，只覆盖注册期调用。",
          ...(text !== null && text.length > 0 ? ["- 执行方式：`node:vm` 包装为 CommonJS (`module`/`exports`/`require`)。"] : []),
        ],
      },
    ],
    nextSteps:
      problems.length === 0
        ? ["部署到真实 vault（obsidian-devkit deploy），再按 L3/L4 验证真实行为。"]
        : ["先修复上面的阻塞问题；这是隔离加载的最底层证据，不再往下验证。"],
  });

  return { report, ok: problems.length === 0, checks, bundle: bundlePath, scenario };
}
