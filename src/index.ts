/**
 * Cordis plugin entry.
 *
 * A host-only bundle: it registers model-facing tools through `ctx.tools`
 * and nothing else. No UI half, no RPC, no background process. Build and CLI
 * steps are one-shot subprocesses; nothing keeps running after a tool returns.
 */
import { readAsset } from "./fs.js";
import { Fs } from "./fs.js";
import { buildPlugin } from "./build.js";
import { registerDevContext } from "./context.js";
import { deployPlugin } from "./deploy.js";
import { reloadActionValues, reloadLive, type ReloadAction } from "./reload.js";
import { scaffold } from "./scaffold.js";
import { registerSkill } from "./skill.js";
import { runSmoke, SMOKE_SCENARIOS, type SmokeScenario } from "./smoke.js";
import { statusReport } from "./status.js";
import { validateProject } from "./validate.js";
import { bumpVersion } from "./version.js";
import { compareSemver } from "./naming.js";
import { objectSchema } from "./types.js";
import type {
  DevkitContext,
  FsCall,
  RenderedBlock,
  SandboxPolicy,
  ToolDefinition,
  ToolOutput,
  ToolRunContext,
} from "./types.js";

export const name = "obsidian-plugin-devkit";
export const inject = ["tools", "fs"];

export interface DevkitConfig {
  /** minAppVersion used when the model does not pass one. */
  defaultMinAppVersion: string;
  /** Workspace-relative directory reserved for a development vault (deploy target). */
  testVault: string;
  /** Package manager used to run project build scripts when no lockfile decides. */
  packageManager: string;
  /** Obsidian CLI invocation; `"obsidian"` means "resolve through PATH". */
  obsidianCli: string;
  /** Probe the running app after deploy (read-only) to report what is actually loaded. */
  probeActive: boolean;
}

export const DEFAULT_CONFIG: DevkitConfig = {
  defaultMinAppVersion: "1.13.0",
  testVault: "dev-vault",
  packageManager: "pnpm",
  obsidianCli: "obsidian",
  probeActive: true,
};

export const textOutput: ToolOutput = {
  schema: { type: "string" },
  render: (_args: unknown, value: string): RenderedBlock[] => [
    { type: "text", text: value },
  ],
};

const SCAFFOLD_DESCRIPTION =
  "Generate a buildable, submission-ready Obsidian plugin project: manifest.json, package.json, " +
  "esbuild + TypeScript + ESLint configs, versions.json, LICENSE, README, AGENTS.md, styles.css and " +
  "src/main.ts with a command, ribbon icon, modal and settings tab (declarative on Obsidian 1.13+, " +
  "legacy display() otherwise). Validates id/name/description/version against the official " +
  "submission rules before writing anything. Refuses to write into a non-empty directory unless " +
  "overwrite is true. Does not run installs; the next step is `pnpm install` (or npm/bun) in the target.";

const BUILD_DESCRIPTION =
  "Build an Obsidian plugin project into a loadable main.js (CommonJS, `obsidian` externalized) and " +
  "immediately run static self-checks: artifact presence, CommonJS module shape, manifest/package/" +
  "versions.json consistency, and the declarative-settings version gate. Uses the project's own " +
  "`build` script when present, otherwise the local esbuild binary. One-shot only, never a watcher. " +
  "A zero exit code alone is not proof of a usable plugin: read the reported problems.";

const VALIDATE_DESCRIPTION =
  "Run the pre-delivery audit for an Obsidian plugin project: submission-safe naming, manifest field " +
  "constraints, semver, version sync across manifest.json/package.json/versions.json, TypeScript entry, " +
  "CommonJS bundle emitted by the build, settings-generation compatibility with minAppVersion, and " +
  "release checklist reminders. Read-only. Use it after every build and before tagging a release.";

const VERSION_DESCRIPTION =
  "Synchronize the release version across manifest.json (source of truth Obsidian loads), package.json " +
  "and versions.json, optionally setting minAppVersion. Rejects non-semver input. Reports exactly which " +
  "files changed. It does not commit or tag; remind the user to git add the changed files.";

const DEPLOY_DESCRIPTION =
  "Deploy a built Obsidian plugin into a real vault: copies main.js, manifest.json and styles.css into " +
  "`<vault>/.obsidian/plugins/<id>/`, merges (never replaces) the id in community-plugins.json when enable " +
  "is true, and records the deployment in `<vault>/.dsh/devkit.json`. Needs no running Obsidian and no " +
  "developer mode. By default targets a workspace-relative dev vault (created on demand); pass vault to " +
  "deploy into a registered vault by name or path. dryRun=true lists the writes without touching anything. " +
  "The 'active' line is only a read-only probe: it never opens or focuses an Obsidian window and reports " +
  "'unknown' when it cannot know.";

const STATUS_DESCRIPTION =
  "Audit the Obsidian plugin development environment without changing anything: whether Obsidian is " +
  "running, whether the official CLI is available (and its version), the registered vaults, the project's " +
  "build state and dependencies, where the plugin is currently deployed across vaults, deploy drift " +
  "between the local build and deployed main.js, and what the running app actually sees. Every section " +
  "degrades to 'unknown' with a reason instead of guessing. Use it when a plugin does not load.";

const RELOAD_DESCRIPTION =
  "Act on a running Obsidian through the official CLI: reload a plugin after a build (plugin:reload), " +
  "rescan the plugins folder so newly deployed plugins are discovered (eval app.plugins.loadManifests()), " +
  "or enable/disable the plugin id. Verifies the result with a read-only query and reports CLI quirks " +
  "honestly (the CLI exits 0 on errors and prints nothing when it hangs, so a timeout is reported as such). " +
  "Requires Obsidian >= 1.12.4 with the CLI enabled in Settings -> General and the app already running; " +
  "it never cold-starts the app, never steals focus, and never falls back to non-official window tricks. " +
  "Commands act on the frontmost vault; switch Obsidian to the target vault first.";

const TEST_DESCRIPTION =
  "L2 smoke test: load the built main.js in an isolated Node VM with a stubbed `obsidian` module, then " +
  "optionally instantiate the plugin and call onload()/onunload(). Catches what a green build hides: " +
  "ES-module output, missing default export, wrong prototype chain, import-time crashes, obvious onload " +
  "hangs. Never a substitute for L3 (real vault) and L4 (human eyes): a pass only proves the bundle loads " +
  "against stubs. The bundle code does execute with Node builtins available, so only smoke-test code you " +
  "would actually install.";

function readCall(exec: ToolRunContext | undefined, ctx: DevkitContext): FsCall {
  const session = exec?.agent?.session;
  let policy: SandboxPolicy | undefined;
  try {
    const sandboxPolicy = ctx.get?.("sandboxPolicy") as
      | { resolve?: (input: { session?: unknown }) => SandboxPolicy | undefined }
      | undefined;
    policy = sandboxPolicy?.resolve?.(session === undefined ? {} : { session });
  } catch {
    policy = undefined;
  }
  return {
    workspaceRoot: policy?.workspaceRoot ?? session?.header?.cwd,
    policy,
    signal: exec?.signal,
  };
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function tools(ctx: DevkitContext, fs: Fs, config: DevkitConfig): ToolDefinition[] {
  const scaffoldTool: ToolDefinition = {
    name: "obsidian_devkit_scaffold",
    description: SCAFFOLD_DESCRIPTION,
    parameters: objectSchema({
      targetDir: {
        type: "string",
        required: true,
        description: "Directory to create the project in (workspace-relative or absolute).",
      },
      id: {
        type: "string",
        required: true,
        description:
          "Plugin id: lowercase letters/digits/underscores/dashes, must not contain 'obsidian', must not end with 'plugin'.",
      },
      name: {
        type: "string",
        required: true,
        description: "Plugin name shown in Obsidian: Basic Latin, no emoji, must not contain 'Obsidian' or end with 'Plugin'.",
      },
      description: {
        type: "string",
        description: "One-line description ending with a period and at most 250 characters (warned otherwise).",
      },
      author: {
        type: "string",
        description: "Author name; defaults to the git user name or 'Unknown'.",
      },
      authorUrl: {
        type: "string",
        description: "Optional author website or GitHub profile URL.",
      },
      version: {
        type: "string",
        description: "Initial semver version, e.g. 0.1.0 (default 0.1.0).",
      },
      minAppVersion: {
        type: "string",
        description: `Minimum Obsidian app version (default ${config.defaultMinAppVersion}).`,
      },
      desktopOnly: {
        type: "boolean",
        description: "Set isDesktopOnly: true for plugins using Node/Electron APIs (default false).",
      },
      settingsStyle: {
        type: "string",
        enum: ["auto", "declarative", "legacy"],
        description:
          "Settings API generation: auto picks declarative when minAppVersion >= 1.13.0, legacy emits display().",
      },
      overwrite: {
        type: "boolean",
        description: "Write into a non-empty target directory (default false).",
      },
      packageManager: {
        type: "string",
        enum: ["pnpm", "npm", "yarn", "bun"],
        description: `Package manager used in the generated README/AGENTS instructions (default ${config.packageManager}).`,
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const id = stringArg(args, "id");
      const displayName = stringArg(args, "name");
      if (id === undefined || displayName === undefined) {
        return "Scaffold requires non-empty id and name parameters.";
      }
      const result = await scaffold(
        fs,
        {
          targetDir: stringArg(args, "targetDir") ?? "",
          id,
          name: displayName,
          description: stringArg(args, "description") ?? `${displayName} — an Obsidian plugin.`,
          author: stringArg(args, "author") ?? "Unknown",
          authorUrl: stringArg(args, "authorUrl"),
          version: stringArg(args, "version") ?? "0.1.0",
          minAppVersion: stringArg(args, "minAppVersion") ?? config.defaultMinAppVersion,
          desktopOnly: booleanArg(args, "desktopOnly") ?? false,
          settingsStyle:
            (stringArg(args, "settingsStyle") as "auto" | "declarative" | "legacy" | undefined) ??
            "auto",
          overwrite: booleanArg(args, "overwrite") ?? false,
          packageManager: stringArg(args, "packageManager") ?? config.packageManager,
        },
        readCall(exec, ctx),
      );
      return result.report;
    },
  };

  const buildTool: ToolDefinition = {
    name: "obsidian_devkit_build",
    description: BUILD_DESCRIPTION,
    parameters: objectSchema({
      projectDir: {
        type: "string",
        required: true,
        description: "Plugin project directory (workspace-relative or absolute).",
      },
      production: {
        type: "boolean",
        description: "Production build (minified, no source map). Default true; development builds are reported as not deployable.",
      },
      entry: {
        type: "string",
        description: "Explicit entry file (e.g. src/main.ts). Omit to auto-detect from the project layout and esbuild config.",
      },
      outDir: {
        type: "string",
        description: "Explicit output directory. Omit to use the esbuild outfile's directory (default project root).",
      },
      timeoutMs: {
        type: "number",
        description: "Build timeout in milliseconds (default 300000).",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const projectDir = stringArg(args, "projectDir");
      if (projectDir === undefined) return "Build requires a non-empty projectDir parameter.";
      const timeout = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : 300_000;
      const result = await buildPlugin(
        fs,
        {
          projectDir,
          production: booleanArg(args, "production") ?? true,
          entry: stringArg(args, "entry"),
          outDir: stringArg(args, "outDir"),
          timeoutMs: timeout,
          packageManager: config.packageManager,
        },
        readCall(exec, ctx),
      );
      return result.report;
    },
  };

  const validateTool: ToolDefinition = {
    name: "obsidian_devkit_validate",
    description: VALIDATE_DESCRIPTION,
    parameters: objectSchema({
      projectDir: {
        type: "string",
        required: true,
        description: "Plugin project directory (workspace-relative or absolute).",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const projectDir = stringArg(args, "projectDir");
      if (projectDir === undefined) return "Validate requires a non-empty projectDir parameter.";
      const result = await validateProject(fs, projectDir, readCall(exec, ctx));
      return result.report;
    },
  };

  const versionTool: ToolDefinition = {
    name: "obsidian_devkit_version",
    description: VERSION_DESCRIPTION,
    parameters: objectSchema({
      projectDir: {
        type: "string",
        required: true,
        description: "Plugin project directory (workspace-relative or absolute).",
      },
      version: {
        type: "string",
        required: true,
        description: "New semver version, e.g. 0.2.0.",
      },
      minAppVersion: {
        type: "string",
        description: "Optional new minAppVersion (semver). Omit to keep the current one.",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const projectDir = stringArg(args, "projectDir");
      const version = stringArg(args, "version");
      if (projectDir === undefined || version === undefined) {
        return "Version requires non-empty projectDir and version parameters.";
      }
      try {
        const result = await bumpVersion(
          fs,
          {
            projectDir,
            version,
            minAppVersion: stringArg(args, "minAppVersion"),
          },
          readCall(exec, ctx),
        );
        const gate =
          compareSemver(result.minAppVersion, "1.13.0") >= 0
            ? "minAppVersion 允许声明式设置（getSettingDefinitions）。"
            : "minAppVersion < 1.13.0，设置页必须使用 legacy display()。";
        return [
          `Version bumped to ${result.version} (minAppVersion ${result.minAppVersion}).`,
          ...result.changed.map((line) => `- ${line}`),
          gate,
          "Commit manifest.json, package.json and versions.json together; the GitHub release tag must equal the manifest version.",
        ].join("\n");
      } catch (error) {
        return `Version bump failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };

  const deployTool: ToolDefinition = {
    name: "obsidian_devkit_deploy",
    description: DEPLOY_DESCRIPTION,
    parameters: objectSchema({
      projectDir: {
        type: "string",
        required: true,
        description: "Built plugin project directory (workspace-relative or absolute). Run build first.",
      },
      vault: {
        type: "string",
        description:
          "Target vault: a registered vault name, a vault path, or a path to a vault folder. Omit to use the workspace development vault.",
      },
      pluginId: {
        type: "string",
        description: "Plugin id override; defaults to manifest.json id. Must match the manifest when given.",
      },
      enable: {
        type: "boolean",
        description:
          "Add the plugin id to community-plugins.json so Obsidian loads it (default true). This does not bypass Restricted mode or vault trust.",
      },
      createVault: {
        type: "boolean",
        description:
          "Allow creating the workspace development vault (and its .obsidian/ folder) when vault is omitted. Never applies to explicit external paths (default true).",
      },
      dryRun: {
        type: "boolean",
        description: "Report what would be written without writing anything (default false).",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const projectDir = stringArg(args, "projectDir");
      if (projectDir === undefined) return "Deploy requires a non-empty projectDir parameter.";
      const result = await deployPlugin(
        fs,
        {
          projectDir,
          vault: stringArg(args, "vault"),
          pluginId: stringArg(args, "pluginId"),
          enable: booleanArg(args, "enable") ?? true,
          createVault: booleanArg(args, "createVault") ?? true,
          dryRun: booleanArg(args, "dryRun") ?? false,
          testVault: config.testVault,
          probeActive: config.probeActive,
          cliCommand: config.obsidianCli,
        },
        readCall(exec, ctx),
      );
      return result.report;
    },
  };

  const statusTool: ToolDefinition = {
    name: "obsidian_devkit_status",
    description: STATUS_DESCRIPTION,
    parameters: objectSchema({
      projectDir: {
        type: "string",
        description: "Optional plugin project directory to include project, build and deployment state for.",
      },
      vault: {
        type: "string",
        description: "Optional vault name or path to check first (in addition to all registered vaults).",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await statusReport(
        fs,
        {
          projectDir: stringArg(args, "projectDir"),
          vault: stringArg(args, "vault"),
          testVault: config.testVault,
          cliCommand: config.obsidianCli,
        },
        readCall(exec, ctx),
      );
      return result.report;
    },
  };

  const reloadTool: ToolDefinition = {
    name: "obsidian_devkit_reload",
    description: RELOAD_DESCRIPTION,
    parameters: objectSchema({
      action: {
        type: "string",
        enum: reloadActionValues(),
        required: true,
        description:
          "reload (plugin:reload after a build/deploy), rescan (make Obsidian discover newly deployed plugin folders), enable, or disable.",
      },
      projectDir: {
        type: "string",
        description: "Plugin project directory; used to read the plugin id from manifest.json when pluginId is omitted.",
      },
      pluginId: {
        type: "string",
        description: "Plugin id to act on. Required when projectDir does not resolve a manifest id.",
      },
      vault: {
        type: "string",
        description:
          "Target vault name to pass as vault=<name>. Window-level commands act on the frontmost vault, so switch Obsidian manually when in doubt.",
      },
      timeoutMs: {
        type: "number",
        description: "CLI timeout in milliseconds (default 30000). A timeout is reported, not retried blindly.",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const rawAction = stringArg(args, "action") ?? "reload";
      const actions = reloadActionValues();
      if (!actions.includes(rawAction as ReloadAction)) {
        return `action must be one of: ${actions.join(", ")}.`;
      }
      const timeout = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : 30_000;
      const result = await reloadLive(
        fs,
        {
          projectDir: stringArg(args, "projectDir"),
          pluginId: stringArg(args, "pluginId"),
          vault: stringArg(args, "vault"),
          action: rawAction as ReloadAction,
          timeoutMs: timeout,
          cliCommand: config.obsidianCli,
        },
        readCall(exec, ctx),
      );
      return result.report;
    },
  };

  const testTool: ToolDefinition = {
    name: "obsidian_devkit_test",
    description: TEST_DESCRIPTION,
    parameters: objectSchema({
      projectDir: {
        type: "string",
        required: true,
        description: "Built plugin project directory (workspace-relative or absolute).",
      },
      bundle: {
        type: "string",
        description: "Bundle path override (workspace-relative or absolute); defaults to the project's main.js.",
      },
      scenario: {
        type: "string",
        enum: [...SMOKE_SCENARIOS],
        description:
          "load (execute the bundle), onload (also instantiate and await onload), or unload (also onload + onunload). Default load.",
      },
      timeoutMs: {
        type: "number",
        description: "onload/onunload timeout in milliseconds (default 15000).",
      },
    }),
    output: textOutput,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const projectDir = stringArg(args, "projectDir");
      if (projectDir === undefined) return "Test requires a non-empty projectDir parameter.";
      const rawScenario = stringArg(args, "scenario") ?? "load";
      if (!SMOKE_SCENARIOS.includes(rawScenario as SmokeScenario)) {
        return `scenario must be one of: ${SMOKE_SCENARIOS.join(", ")}.`;
      }
      const timeout = typeof args.timeoutMs === "number" && args.timeoutMs > 0 ? args.timeoutMs : 15_000;
      const result = await runSmoke(
        fs,
        {
          projectDir,
          bundle: stringArg(args, "bundle"),
          scenario: rawScenario as SmokeScenario,
          timeoutMs: timeout,
        },
        readCall(exec, ctx),
      );
      return result.report;
    },
  };

  return [
    scaffoldTool,
    buildTool,
    validateTool,
    versionTool,
    deployTool,
    statusTool,
    reloadTool,
    testTool,
  ];
}

export function apply(ctx: DevkitContext, config?: Partial<DevkitConfig>): void {
  const fs = new Fs(ctx.fs);
  const resolved: DevkitConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  for (const tool of tools(ctx, fs, resolved)) {
    ctx.tools.register(tool);
  }
  registerSkill(ctx);
  registerDevContext(ctx);
}

/** Kept for tests and for future M2 tooling: bundle assets are read from `assets/`. */
export { readAsset, registerDevContext, registerSkill };
