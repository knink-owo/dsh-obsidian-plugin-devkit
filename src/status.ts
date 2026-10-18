/**
 * Read-only environment and deployment audit.
 *
 * Status answers "why does the plugin not load?" without mutating anything:
 * Obsidian process / CLI availability, the vault registry, where this project
 * is deployed, whether the deployed copy drifts from the build, and whether the
 * running app actually sees it. Every section degrades to "unknown" with the
 * reason instead of guessing.
 */
import {
  activeVaultName,
  cliVersionProblems,
  discoverCli,
  enabledPluginIds,
  pluginDetails,
  type CliDiscovery,
} from "./cli.js";
import type { Fs } from "./fs.js";
import { inspectProject, joinPath, readJsonFile } from "./manifest.js";
import { run } from "./proc.js";
import { formatReport } from "./report.js";
import type { FsCall } from "./types.js";
import { resolveVault, readVaultRegistry, vaultName } from "./vault.js";

export interface StatusDeps {
  discovery?: CliDiscovery;
  /** Reads a toolchain version (`<command> --version`); injectable for tests. */
  toolVersion?: (command: string, cwd?: string) => string | null;
  activeVault?: (discovery: CliDiscovery) => string | null;
  enabledPlugins?: (discovery: CliDiscovery) => string[] | null;
  details?: (discovery: CliDiscovery, id: string) => {
    details: { id: string; enabled: boolean | null; version: string | null; name: string | null } | null;
    error: string | null;
  };
}

export interface StatusOptions {
  projectDir?: string;
  vault?: string;
  testVault: string;
  cliCommand?: string;
  deps?: StatusDeps;
}

function defaultToolVersion(command: string, cwd?: string): string | null {
  const result = run({ command, args: ["--version"], cwd: cwd ?? process.cwd(), timeoutMs: 20_000 });
  if (result.status !== "ok") return null;
  const line = result.stdout.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 0 ? line : null;
}

async function readBinding(
  fs: Fs,
  vaultPath: string,
  call: FsCall,
): Promise<Record<string, unknown> | null> {
  const read = await readJsonFile(fs, joinPath(joinPath(vaultPath, ".dsh"), "devkit.json"), call);
  return read.value !== null && typeof read.value === "object" && !Array.isArray(read.value)
    ? (read.value as Record<string, unknown>)
    : null;
}

interface Deployment {
  vaultPath: string;
  vaultName: string;
  pluginDir: string;
  installed: boolean;
  installedVersion: string | null;
  communityEnabled: boolean | null;
  binding: Record<string, unknown> | null;
  bindingMatchesProject: boolean;
  drift: string | null;
}

async function inspectDeployment(
  fs: Fs,
  vaultPath: string,
  pluginId: string,
  projectBundleText: string | null,
  projectDir: string,
  call: FsCall,
): Promise<Deployment> {
  const pluginDir = joinPath(joinPath(vaultPath, ".obsidian"), joinPath("plugins", pluginId));
  const installed = await fs.isDirectory(pluginDir, call.workspaceRoot);
  let installedVersion: string | null = null;
  let drift: string | null = null;
  if (installed) {
    const installedManifest = await readJsonFile(fs, joinPath(pluginDir, "manifest.json"), call);
    const version = installedManifest.value?.version;
    if (typeof version === "string") installedVersion = version;
    if (projectBundleText !== null) {
      try {
        const deployed = await fs.readText(joinPath(pluginDir, "main.js"), call.workspaceRoot);
        drift = deployed === projectBundleText ? null : "部署的 main.js 与本地构建产物不一致";
      } catch {
        drift = "插件目录存在，但缺少 main.js";
      }
    }
  }
  let communityEnabled: boolean | null = null;
  const community = await readJsonFile(fs, joinPath(joinPath(vaultPath, ".obsidian"), "community-plugins.json"), call);
  if (Array.isArray(community.value)) {
    communityEnabled = community.value.includes(pluginId);
  }
  const binding = await readBinding(fs, vaultPath, call);
  const sourceDir = binding?.sourceDir;
  const bindingMatchesProject = typeof sourceDir === "string" && sourceDir.replace(/\\/g, "/") === projectDir.replace(/\\/g, "/");
  return {
    vaultPath,
    vaultName: vaultName(vaultPath),
    pluginDir,
    installed,
    installedVersion,
    communityEnabled,
    binding,
    bindingMatchesProject,
    drift,
  };
}

export async function statusReport(
  fs: Fs,
  options: StatusOptions,
  call: FsCall,
): Promise<{ report: string }> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  const nextSteps: string[] = [];

  sections.push({
    title: "运行环境",
    lines: [
      `- 会话工作区：${call.workspaceRoot ?? "(未知)"}`,
      `- 平台：${process.platform} ${process.arch}，Node ${process.version}`,
      `- 时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    ],
  });

  const registry = await readVaultRegistry(fs, call);
  const discovery =
    options.deps?.discovery ??
    discoverCli({ command: options.cliCommand });
  const cliVersionIssues = cliVersionProblems(discovery);

  const cliLines = [
    `- Obsidian 进程：${discovery.appRunning ? "运行中" : "未运行"}`,
    `- CLI：${discovery.available ? `可用（${discovery.command}，版本 ${discovery.version ?? "未知"}）` : "不可用"}`,
    `- 探测详情：${discovery.detail}`,
  ];
  for (const issue of cliVersionIssues) warnings.push(issue);
  if (!discovery.appRunning) {
    cliLines.push("- 说明：应用未运行时工具不会冷启动 Obsidian，因此不探测 CLI；需要实时操作时请手动打开 Obsidian。");
  } else if (!discovery.available) {
    cliLines.push("- 启用方式：设置 → 通用 → 命令行界面（Obsidian ≥ 1.12.4），重启应用后确认 obsidian 在 PATH 中。");
    notes.push("CLI 不可用只影响实时重载/启用；文件级部署（obsidian-devkit deploy）不需要 CLI。");
  } else {
    const readActive =
      options.deps?.activeVault ?? ((target: CliDiscovery) => activeVaultName(target));
    const active = readActive(discovery);
    cliLines.push(`- 当前前台 vault：${active ?? "unknown"}`);
  }
  sections.push({ title: "Obsidian CLI", lines: cliLines });

  const registryLines = [
    `- 注册表：${registry.path ?? "(无法定位 Obsidian 配置目录)"}`,
    `- vault 数量：${registry.entries.length}`,
  ];
  if (registry.error !== null) {
    warnings.push(`读取 vault 注册表失败：${registry.error}`);
    registryLines.push(`- 读取失败：${registry.error}`);
  } else if (registry.entries.length === 0) {
    registryLines.push("- 没有已注册的 vault（尚未在 Obsidian 中打开过任何 vault）。");
  } else {
    for (const entry of registry.entries) {
      registryLines.push(`- ${entry.name} → ${entry.path}${entry.open ? "（当前打开）" : ""}`);
    }
  }
  sections.push({ title: "已注册 vault", lines: registryLines });

  // Project inspection (optional).
  let projectId: string | null = null;
  let projectBundleText: string | null = null;
  let absoluteProjectDir: string | null = null;
  if (options.projectDir !== undefined) {
    const inspection = await inspectProject(fs, options.projectDir, call);
    projectId = inspection.manifest?.id ?? null;
    projectBundleText = inspection.bundleText;
    absoluteProjectDir = inspection.absoluteDir;
    const projectVersions = inspection.manifest?.version ?? "?";
    const projectLines = [
      `- 目录：${inspection.absoluteDir}`,
      `- manifest：${inspection.manifest === null ? "不可读" : `${inspection.manifest.id} / ${inspection.manifest.name} @ ${projectVersions}（minAppVersion ${inspection.manifest.minAppVersion}）`}`,
      `- 入口：${inspection.entry ?? "未找到"}`,
      `- 构建产物：${inspection.bundle === null ? "未构建" : `${inspection.bundle}（${inspection.bundleSize ?? 0} B）`}`,
      `- 设置实现：${inspection.settingsStyle}`,
      `- 依赖目录 node_modules：${(await fs.isDirectory(joinPath(options.projectDir, "node_modules"), call.workspaceRoot)) ? "存在" : "不存在（先安装依赖）"}`,
      `- 自检：${inspection.problems.length} 个阻塞问题 / ${inspection.warnings.length} 条警告`,
    ];
    sections.push({ title: "项目", lines: projectLines });
    if (inspection.problems.length > 0) {
      warnings.push(
        `项目有 ${inspection.problems.length} 个阻塞问题（运行 obsidian-devkit validate 查看详情与修复建议）。`,
      );
    }
    const readVersion = options.deps?.toolVersion ?? defaultToolVersion;
    const cwd = call.workspaceRoot;
    const pnpmVersion = readVersion("pnpm", cwd);
    const npmVersion = readVersion("npm", cwd);
    sections.push({
      title: "工具链",
      lines: [
        `- pnpm：${pnpmVersion ?? "不可用"}`,
        `- npm：${npmVersion ?? "不可用"}`,
        `- Node：${process.version}`,
      ],
    });
    if (pnpmVersion === null && npmVersion === null) {
      warnings.push("pnpm 与 npm 都不可用；构建项目脚本前需要先安装包管理器。");
    }
  }

  // Deployment locations, discovered rather than assumed.
  if (projectId !== null) {
    const deployments: Deployment[] = [];
    const seen = new Set<string>();
    const addCandidate = async (vaultPath: string): Promise<void> => {
      const key = vaultPath.replace(/\\/g, "/").toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      deployments.push(
        await inspectDeployment(
          fs,
          vaultPath,
          projectId,
          projectBundleText,
          absoluteProjectDir ?? options.projectDir ?? "",
          call,
        ),
      );
    };

    if (options.vault !== undefined && options.vault.trim().length > 0) {
      const resolution = await resolveVault(
        fs,
        {
          vault: options.vault,
          workspaceRoot: call.workspaceRoot,
          defaultVault: options.testVault,
          create: false,
        },
        call,
      );
      if (resolution.problem === null) await addCandidate(resolution.path);
      else warnings.push(`目标 vault 无法解析：${resolution.problem}`);
    } else {
      const resolution = await resolveVault(
        fs,
        {
          workspaceRoot: call.workspaceRoot,
          defaultVault: options.testVault,
          create: false,
        },
        call,
      );
      if (resolution.problem === null) await addCandidate(resolution.path);
    }
    for (const entry of registry.entries) {
      const exists = await fs.isDirectory(entry.path, call.workspaceRoot);
      if (exists) await addCandidate(entry.path);
    }

    const deploymentLines: string[] = [];
    for (const deployment of deployments) {
      if (!deployment.installed) {
        deploymentLines.push(`- ${deployment.vaultName}（${deployment.vaultPath}）：未安装该插件`);
        continue;
      }
      const bindingText =
        deployment.binding === null
          ? "无 devkit 绑定文件"
          : deployment.bindingMatchesProject
            ? `由本工具部署于 ${String(deployment.binding.deployedAt ?? "未知时间")}`
            : `绑定文件来自其他项目（${String(deployment.binding.sourceDir ?? "未知")}）`;
      deploymentLines.push(
        `- ${deployment.vaultName}（${deployment.vaultPath}）：已安装 v${deployment.installedVersion ?? "?"}；${
          deployment.communityEnabled === null
            ? "community-plugins.json 不可读"
            : deployment.communityEnabled
              ? "在启用列表中"
              : "不在启用列表中"
        }；${bindingText}${deployment.drift === null ? "" : `；${deployment.drift}`}`,
      );
      if (deployment.drift !== null) {
        warnings.push(`部署漂移：${deployment.vaultName} / ${deployment.pluginDir} — ${deployment.drift}。重新运行 obsidian-devkit deploy。`);
      }
    }
    if (deployments.length === 0) {
      deploymentLines.push("- 未找到可检查的 vault（注册表为空或不可读）。");
    }
    if (!deployments.some((deployment) => deployment.installed)) {
      notes.push(
        "该插件尚未出现在任何已检查的 vault 中；下一步运行 obsidian-devkit deploy 部署，或检查 vault 注册表。",
      );
    }
    sections.push({ title: "部署位置", lines: deploymentLines });

    // Live state (read-only).
    if (discovery.available) {
      const readDetails =
        options.deps?.details ??
        ((target: CliDiscovery, plugin: string) => pluginDetails(target, plugin));
      const verification = readDetails(discovery, projectId);
      const detailLines: string[] = [];
      if (verification.details === null) {
        detailLines.push(`- 插件信息不可读：${verification.error ?? "未知原因"}`);
      } else {
        detailLines.push(
          `- ${verification.details.id}：${verification.details.name ?? "(无名)"} @ ${verification.details.version ?? "?"}，${
            verification.details.enabled === true ? "已启用" : verification.details.enabled === false ? "未启用" : "启用状态未知"
          }`,
        );
      }
      const readEnabled =
        options.deps?.enabledPlugins ?? ((target: CliDiscovery) => enabledPluginIds(target));
      const activeVault = (options.deps?.activeVault ?? ((target: CliDiscovery) => activeVaultName(target)))(discovery);
      const enabled = readEnabled(discovery);
      detailLines.push(`- 前台 vault：${activeVault ?? "unknown"}`);
      detailLines.push(
        `- 前台 vault 的已启用插件：${enabled === null ? "不可读" : enabled.includes(projectId) ? "包含该插件" : "不包含该插件"}`,
      );
      sections.push({ title: "运行中状态（只读）", lines: detailLines });
    } else {
      notes.push("Obsidian CLI 不可用：运行中状态未知（文件级部署不依赖 CLI）。");
    }
  }

  if (options.projectDir !== undefined) {
    nextSteps.push("运行 obsidian-devkit validate 检查项目是否满足提交规则。");
    nextSteps.push("运行 obsidian-devkit deploy 部署到开发 vault，然后用 obsidian-devkit reload 让运行中的 Obsidian 加载新代码。");
  } else {
    nextSteps.push("传入 projectDir 可进一步检查项目构建产物、部署位置与漂移。");
  }

  const summaryParts = [
    `CLI ${discovery.available ? `可用（${discovery.version ?? "版本未知"}）` : "不可用"}`,
    `${registry.entries.length} 个已注册 vault`,
  ];
  if (projectId !== null) summaryParts.push(`项目 ${projectId}`);
  const report = formatReport({
    title: "Obsidian 插件开发环境体检",
    summary: `${problems.length === 0 ? "PASS" : "FAIL"} — ${summaryParts.join("；")}。`,
    problems,
    warnings,
    notes,
    sections,
    nextSteps,
  });
  return { report };
}
