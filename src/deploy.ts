/**
 * Deploy a built plugin into a real vault's `.obsidian/plugins/<id>/` folder.
 *
 * This is the non-CLI channel: it needs no running Obsidian, no developer mode
 * and no trust prompt. It writes only the files Obsidian loads (main.js,
 * manifest.json, styles.css), keeps `community-plugins.json` merged rather than
 * replaced, and records what it did in `<vault>/.dsh/devkit.json`.
 *
 * Two honesty rules:
 *
 *  - `enable` only means "the plugin id is listed for loading"; Obsidian decides
 *    whether the vault is in Restricted mode, whether the user trusts the vault,
 *    and whether a restart is needed. The report says "unknown" instead of
 *    claiming the plugin is running.
 *  - the active-vault probe is optional and read-only; it never focuses or
 *    opens a window. Probing a hidden window would otherwise report a lie.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  activeVaultName,
  discoverCli,
  enabledPluginIds,
  type CliDiscovery,
} from "./cli.js";
import type { Fs } from "./fs.js";
import { inspectProject, joinPath, readJsonFile } from "./manifest.js";
import { formatReport, verdict } from "./report.js";
import type { FsCall } from "./types.js";
import { resolveVault, vaultName } from "./vault.js";

export interface DeployDeps {
  discover?: (options?: { command?: string }) => CliDiscovery;
  activeVault?: (discovery: CliDiscovery) => string | null;
  enabledPlugins?: (discovery: CliDiscovery) => string[] | null;
}

export interface DeployOptions {
  projectDir: string;
  vault?: string;
  pluginId?: string;
  /** Add the plugin id to community-plugins.json (does not call any enable API). */
  enable: boolean;
  /** Allow creating the default development vault inside the workspace. */
  createVault: boolean;
  dryRun: boolean;
  /** Workspace-relative development vault used when `vault` is omitted. */
  testVault: string;
  /** Probe the live app for what is actually loaded (read-only). */
  probeActive: boolean;
  cliCommand?: string;
  deps?: DeployDeps;
}

export interface DeployedFile {
  name: string;
  action: "written" | "overwritten" | "unchanged" | "would-write";
  bytes: number;
  sha256: string;
}

export interface DeployResult {
  report: string;
  ok: boolean;
  pluginId: string | null;
  vaultPath: string | null;
  files: DeployedFile[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function tryRead(fs: Fs, path: string, call: FsCall): Promise<string | null> {
  try {
    return await fs.readText(path, call.workspaceRoot);
  } catch {
    return null;
  }
}

function describeVaultSource(source: "registry" | "explicit" | "default", entryName: string | null): string {
  if (source === "registry") return `Obsidian 注册表${entryName === null ? "" : `（vault=${entryName}）`}`;
  if (source === "explicit") return "显式路径";
  return "工作区默认开发 vault";
}

export async function deployPlugin(
  fs: Fs,
  options: DeployOptions,
  call: FsCall,
): Promise<DeployResult> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  const nextSteps: string[] = [];

  const finish = (id: string | null, vaultPath: string | null, files: DeployedFile[]): DeployResult => {
    const summary =
      problems.length > 0
        ? verdict(problems, warnings)
        : options.dryRun
          ? `dryRun — 未写入任何文件；以下为将要发生的操作。`
          : `PASS — ${id ?? "插件"} 已部署到 ${vaultPath ?? "(未知 vault)"}（${files.filter((file) => file.action === "written" || file.action === "overwritten").length} 个文件写入）。`;
    const report = formatReport({
      title: "Obsidian 插件部署",
      summary,
      problems,
      warnings,
      notes,
      sections,
      nextSteps,
    });
    return { report, ok: problems.length === 0, pluginId: id, vaultPath, files };
  };

  const inspection = await inspectProject(fs, options.projectDir, call);
  const manifest = inspection.manifest;
  if (manifest === null || inspection.bundleText === null) {
    if (manifest === null) problems.push("manifest.json 无法读取，无法确定插件 id / 版本，已停止部署。");
    if (inspection.bundleText === null) {
      problems.push(
        "没有可部署的 main.js：先运行 obsidian-devkit build（生产构建），部署只复制构建产物。",
      );
    }
    return finish(manifest?.id ?? null, null, []);
  }

  const id = (options.pluginId?.trim() ?? "") || manifest.id;
  if (!/^[a-z0-9_-]+$/.test(id)) {
    problems.push(`插件 id "${id}" 不是合法的 Obsidian 插件 id（小写字母/数字/下划线/连字符）。`);
    return finish(id, null, []);
  }
  if (options.pluginId !== undefined && options.pluginId.trim() !== manifest.id) {
    problems.push(
      `pluginId "${options.pluginId}" 与 manifest.json 的 id "${manifest.id}" 不一致；部署目录名必须等于 manifest id。`,
    );
    return finish(id, null, []);
  }
  if (inspection.problems.length > 0) {
    const preview = inspection.problems.slice(0, 3).map((item) => `- ${item}`).join("\n");
    warnings.push(
      `项目自检仍有 ${inspection.problems.length} 个阻塞问题，部署产物可能无法加载（先运行 obsidian-devkit validate）：\n${preview}`,
    );
  }

  const vault = await resolveVault(
    fs,
    {
      vault: options.vault,
      workspaceRoot: call.workspaceRoot,
      defaultVault: options.testVault,
      create: options.createVault,
    },
    call,
  );
  if (vault.problem !== null) {
    problems.push(vault.problem);
    return finish(id, null, []);
  }
  if (vault.warning !== null) warnings.push(vault.warning);
  const targetVault = vault.path;
  const targetName = vaultName(targetVault);
  const pluginDir = joinPath(joinPath(targetVault, ".obsidian"), joinPath("plugins", id));
  const communityPath = joinPath(joinPath(targetVault, ".obsidian"), "community-plugins.json");

  // Read the enabled list before any write, so an invalid file aborts the deploy
  // instead of leaving a half-deployed plugin behind.
  let enabledList: string[] = [];
  if (options.enable) {
    const communityExists = await fs.exists(communityPath, call.workspaceRoot);
    if (!communityExists) {
      enabledList = [];
      notes.push(`community-plugins.json 尚不存在；将创建并写入 ["${id}"]。`);
    } else {
      const community = await readJsonFile(fs, communityPath, call);
      if (!Array.isArray(community.value)) {
        problems.push(
          `community-plugins.json 存在但不是 JSON 数组；拒绝覆盖（${community.error ?? "内容格式不正确"}），请先备份并在 Obsidian 中修复。`,
        );
        return finish(id, targetVault, []);
      }
      enabledList = community.value.filter((entry: unknown): entry is string => typeof entry === "string");
    }
  }

  const artifacts: { name: string; content: string }[] = [
    { name: "manifest.json", content: await fs.readText(joinPath(options.projectDir, "manifest.json"), call.workspaceRoot) },
    { name: "main.js", content: inspection.bundleText },
  ];
  const styles = await tryRead(fs, joinPath(options.projectDir, "styles.css"), call);
  if (styles !== null) artifacts.push({ name: "styles.css", content: styles });

  const fileReports: DeployedFile[] = [];
  for (const artifact of artifacts) {
    const target = joinPath(pluginDir, artifact.name);
    const bytes = Buffer.byteLength(artifact.content, "utf8");
    const digest = sha256(artifact.content);
    const existing = await tryRead(fs, target, call);
    if (existing === artifact.content) {
      fileReports.push({ name: artifact.name, action: "unchanged", bytes, sha256: digest });
      continue;
    }
    if (options.dryRun) {
      fileReports.push({ name: artifact.name, action: "would-write", bytes, sha256: digest });
      continue;
    }
    await fs.writeText(target, artifact.content, call.policy, call.signal, call.workspaceRoot);
    fileReports.push({
      name: artifact.name,
      action: existing === null ? "written" : "overwritten",
      bytes,
      sha256: digest,
    });
  }

  const alreadyListed = enabledList.includes(id);
  let communityChanged = false;
  if (options.enable) {
    if (!alreadyListed) {
      enabledList.push(id);
      if (!options.dryRun) {
        await fs.writeText(
          communityPath,
          `${JSON.stringify(enabledList, null, 2)}\n`,
          call.policy,
          call.signal,
          call.workspaceRoot,
        );
      }
      communityChanged = true;
    }
  } else {
    notes.push("enable=false：未修改 community-plugins.json，插件不会出现在已启用列表。");
  }

  const bindingPath = joinPath(joinPath(targetVault, ".dsh"), "devkit.json");
  const binding = {
    schemaVersion: 1,
    tool: "@knink-owo/dsh-obsidian-plugin-devkit",
    pluginId: id,
    version: manifest.version,
    sourceDir: inspection.absoluteDir,
    vault: targetVault,
    deployedAt: new Date().toISOString(),
    enableRequested: options.enable,
    files: fileReports
      .filter((file) => file.action !== "unchanged" && file.action !== "would-write")
      .map((file) => ({ name: file.name, bytes: file.bytes, sha256: file.sha256 })),
  };
  if (!options.dryRun) {
    await fs.writeText(
      bindingPath,
      `${JSON.stringify(binding, null, 2)}\n`,
      call.policy,
      call.signal,
      call.workspaceRoot,
    );
  }

  // Live probe (read-only). Never focus the window; a hidden window answers
  // "unknown" rather than a confident "active".
  let activeState: string;
  if (!options.probeActive) {
    activeState = "unknown（probeActive=false，未探测运行中的 Obsidian）";
  } else {
    const discover = options.deps?.discover ?? ((input?: { command?: string }) => discoverCli({ command: input?.command }));
    const discovery = discover({ command: options.cliCommand });
    if (!discovery.appRunning) {
      activeState = "unknown（Obsidian 未运行；文件已就位，下次打开 vault 时加载）";
    } else if (!discovery.available) {
      activeState = `unknown（CLI 不可用：${discovery.detail}）`;
    } else {
      const readActive = options.deps?.activeVault ?? ((target: CliDiscovery) => activeVaultName(target));
      const activeName = readActive(discovery);
      if (activeName === null) {
        activeState = "unknown（CLI 可用但无法读取当前前台 vault 名）";
      } else if (activeName !== targetName) {
        activeState = `unknown（目标 vault "${targetName}" 不是当前前台 vault "${activeName}"；Obsidian 只加载前台窗口的插件）`;
      } else {
        const readEnabled = options.deps?.enabledPlugins ?? ((target: CliDiscovery) => enabledPluginIds(target));
        const enabled = readEnabled(discovery);
        if (enabled === null) {
          activeState = "unknown（CLI 可用但无法读取已启用插件列表）";
        } else if (enabled.includes(id)) {
          activeState = "enabled（CLI 确认该 id 在已启用插件列表中）";
        } else {
          activeState = "not loaded（vault 已打开但该插件未出现在已启用列表；检查受限模式，或执行 reload/rescan）";
        }
      }
    }
  }

  sections.push({
    title: "目标 vault",
    lines: [
      `- 路径：${targetVault}`,
      `- 来源：${describeVaultSource(vault.source, vault.entry?.name ?? null)}`,
      `- 状态：${vault.isVault ? "已存在（含 .obsidian/）" : vault.exists ? "目录存在，缺少 .obsidian/（将补建）" : "不存在（将创建）"}`,
      `- 插件目录：${pluginDir}`,
    ],
  });
  sections.push({
    title: "文件",
    lines: fileReports.map(
      (file) => `- ${file.name}: ${file.action} (${file.bytes} B, sha256 ${file.sha256.slice(0, 12)}…)`,
    ),
  });
  sections.push({
    title: "启用状态",
    lines: [
      `- community-plugins.json：${communityPath}`,
      options.enable
        ? `- ${
            communityChanged
              ? options.dryRun
                ? `dryRun：将把 "${id}" 追加到列表（当前${alreadyListed ? "已" : "未"}在列表中）`
                : `已将 "${id}" ${alreadyListed ? "保留" : "追加"}到列表`
              : `"${id}" 已在列表中，无需修改`
          }`
        : `- 未修改（enable=false）`,
      "- 说明：写入列表只代表“允许加载”；受限模式、vault 信任与重启时机由 Obsidian 决定。",
    ],
  });
  sections.push({
    title: "active 状态（运行中的 Obsidian）",
    lines: [
      `- ${activeState}`,
      "- 本工具不切换窗口、不抢焦点：探测只读；目标 vault 不在前台时无法确认真实加载状态。",
    ],
  });
  if (!options.dryRun) {
    sections.push({ title: "绑定文件", lines: [`- ${bindingPath}`] });
  }
  if (options.dryRun) notes.push("这是 dryRun：没有写任何文件，也没有修改 community-plugins.json。");

  if (problems.length > 0) {
    nextSteps.push("先修复上面的阻塞问题，再重新运行 deploy。");
  } else {
    if (options.dryRun) {
      nextSteps.push("确认无误后去掉 dryRun 重新运行 deploy。");
    } else {
      nextSteps.push(
        `在 Obsidian 中打开 vault "${targetName}"，在 设置 → 第三方插件 中确认插件已启用（受限模式会阻止加载）。`,
      );
      if (options.enable && communityChanged) {
        nextSteps.push(
          discoveryHint(),
        );
      }
      nextSteps.push("运行 obsidian-devkit status 复查部署状态与漂移。");
    }
  }

  return finish(id, targetVault, fileReports);
}

function discoveryHint(): string {
  return "若 Obsidian 正在运行：用 obsidian-devkit reload --action reload（或 --action rescan 让新插件被发现），无需手动重启。";
}
